-- Harden Flight Reservation Workflow for production.
-- Data model:
-- - booking_flight_reservations is the flight header for a booking/PNR.
-- - booking_flight_travelers links each participant to the shared PNR/header.
-- This allows one PNR shared by multiple travelers while keeping traveler-level traceability.

alter table public.operation_tasks
  add column if not exists deduplication_key text;

with ranked_flight_tasks as (
  select
    id,
    booking_id,
    row_number() over (partition by booking_id order by created_at asc, id asc) as rn
  from public.operation_tasks
  where category = 'flight_reservation'
    and booking_id is not null
    and deduplication_key is null
)
update public.operation_tasks t
set deduplication_key = case
  when r.rn = 1 then concat('reserve_flight:', r.booking_id::text, ':no_participant:no_visa')
  else concat('legacy_flight_task:', t.id::text)
end
from ranked_flight_tasks r
where t.id = r.id;

create unique index if not exists operation_tasks_deduplication_key_unique
  on public.operation_tasks (deduplication_key)
  where deduplication_key is not null;

create table if not exists public.operation_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.operation_tasks(id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_operation_task_history_task_created
  on public.operation_task_history (task_id, created_at desc);

alter table public.booking_flight_reservations
  add column if not exists pnr_normalized text,
  add column if not exists required_traveler_count integer,
  add column if not exists linked_traveler_count integer not null default 0,
  add column if not exists last_reminder_at timestamptz;

alter table public.booking_flight_reservations
  drop constraint if exists booking_flight_reservations_status_check;

alter table public.booking_flight_reservations
  add constraint booking_flight_reservations_status_check
  check (status in ('not_booked', 'booked', 'ticket_sent', 'cancelled'));

alter table public.booking_flight_reservations
  drop constraint if exists booking_flight_reservations_one_per_booking;

update public.booking_flight_reservations
set pnr_normalized = nullif(upper(regexp_replace(coalesce(pnr, ''), '\s+', '', 'g')), '')
where pnr_normalized is null
  and nullif(trim(coalesce(pnr, '')), '') is not null;

create unique index if not exists booking_flight_reservations_booking_pnr_active_unique
  on public.booking_flight_reservations (booking_id, pnr_normalized)
  where pnr_normalized is not null and status <> 'cancelled';

create unique index if not exists booking_flight_reservations_booking_empty_active_unique
  on public.booking_flight_reservations (booking_id)
  where pnr_normalized is null and status <> 'cancelled';

create table if not exists public.booking_flight_travelers (
  id uuid primary key default gen_random_uuid(),
  flight_reservation_id uuid not null references public.booking_flight_reservations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  participant_id uuid not null references public.booking_participants(id) on delete cascade,
  e_ticket_number text,
  traveler_status text not null default 'pending'
    check (traveler_status in ('pending', 'linked', 'ticketed', 'cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_flight_travelers_unique_participant_per_flight unique (flight_reservation_id, participant_id)
);

create index if not exists idx_booking_flight_travelers_flight
  on public.booking_flight_travelers (flight_reservation_id);

create index if not exists idx_booking_flight_travelers_booking
  on public.booking_flight_travelers (booking_id);

create index if not exists idx_booking_flight_travelers_participant
  on public.booking_flight_travelers (participant_id);

create table if not exists public.booking_flight_reservation_history (
  id uuid primary key default gen_random_uuid(),
  flight_reservation_id uuid references public.booking_flight_reservations(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  participant_id uuid references public.booking_participants(id) on delete set null,
  event_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_booking_flight_history_booking_created
  on public.booking_flight_reservation_history (booking_id, created_at desc);

create index if not exists idx_booking_flight_history_flight_created
  on public.booking_flight_reservation_history (flight_reservation_id, created_at desc);

create or replace function public.normalize_flight_pnr(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '\s+', '', 'g')), '')
$$;

create or replace function public.log_operation_task_history(
  p_task_id uuid,
  p_event_type text,
  p_old_status text default null,
  p_new_status text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.operation_task_history (
    task_id,
    event_type,
    old_status,
    new_status,
    actor_id,
    metadata
  )
  values (
    p_task_id,
    p_event_type,
    p_old_status,
    p_new_status,
    auth.uid(),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.operation_task_template_defaults(p_template_key text)
returns table(title text, description text, priority text, category text, deadline_interval interval)
language sql
stable
as $$
  select *
  from (values
    ('reserve_flight', 'Réserver le billet d’avion', 'Réserver le vol client après confirmation du paiement.', 'high', 'flight_reservation', interval '24 hours'),
    ('send_flight_ticket', 'Envoyer le billet au client', 'Envoyer le billet PDF au client et confirmer l’envoi.', 'high', 'flight_ticket_delivery', interval '24 hours'),
    ('verify_passport', 'Vérifier la validité du passeport', 'Contrôler la validité du passeport et les informations voyageur.', 'high', 'passport_verification', interval '24 hours'),
    ('visa_approved_next_action', 'Finaliser le dossier visa approuvé', 'Préparer la suite après approbation du visa.', 'medium', 'visa_followup', interval '24 hours'),
    ('prepare_final_documents', 'Préparer les documents finaux du voyage', 'Préparer et publier les documents finaux du voyage.', 'high', 'final_documents', interval '48 hours'),
    ('send_jr_pass', 'Envoyer / remettre le JR Pass', 'Envoyer ou remettre le JR Pass au voyageur.', 'medium', 'jr_pass', interval '24 hours')
  ) as t(template_key, title, description, priority, category, deadline_interval)
  where template_key = p_template_key
$$;

create or replace function public.ensure_operation_task(
  p_template_key text,
  p_booking_id uuid default null,
  p_participant_id uuid default null,
  p_visa_application_id uuid default null,
  p_trip_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_defaults record;
  v_booking public.bookings%rowtype;
  v_task_id uuid;
  v_dedup text;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  select * into v_defaults
  from public.operation_task_template_defaults(p_template_key)
  limit 1;

  if not found then
    raise exception 'unknown_operation_task_template'
      using detail = p_template_key;
  end if;

  if p_booking_id is not null then
    select * into v_booking
    from public.bookings
    where id = p_booking_id;
  end if;

  v_dedup := concat_ws(
    ':',
    p_template_key,
    coalesce(p_booking_id::text, 'no_booking'),
    coalesce(p_participant_id::text, 'no_participant'),
    coalesce(p_visa_application_id::text, 'no_visa')
  );

  select id into v_task_id
  from public.operation_tasks
  where deduplication_key = v_dedup
  limit 1;

  if v_task_id is not null then
    return v_task_id;
  end if;

  insert into public.operation_tasks (
    title,
    description,
    priority,
    status,
    reservation_id,
    booking_id,
    trip_id,
    visa_application_id,
    customer_id,
    category,
    deadline,
    created_by,
    deduplication_key,
    metadata
  )
  values (
    v_defaults.title,
    v_defaults.description,
    v_defaults.priority,
    'todo',
    p_booking_id,
    p_booking_id,
    coalesce(p_trip_id, v_booking.trip_id),
    p_visa_application_id,
    v_booking.client_id,
    v_defaults.category,
    now() + v_defaults.deadline_interval,
    auth.uid(),
    v_dedup,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('template_key', p_template_key, 'deduplication_key', v_dedup)
  )
  returning id into v_task_id;

  perform public.log_operation_task_history(
    v_task_id,
    'created',
    null,
    'todo',
    jsonb_build_object('template_key', p_template_key)
  );

  insert into public.operation_task_notifications (
    task_id,
    notification_type,
    title,
    message,
    scheduled_for,
    metadata
  )
  values (
    v_task_id,
    'deadline_reminder',
    v_defaults.title,
    coalesce(v_defaults.description, v_defaults.title),
    now() + v_defaults.deadline_interval,
    jsonb_build_object('booking_id', p_booking_id, 'category', v_defaults.category, 'template_key', p_template_key)
  );

  return v_task_id;
end;
$$;

create or replace function public.complete_operation_task_by_key(
  p_template_key text,
  p_booking_id uuid default null,
  p_participant_id uuid default null,
  p_visa_application_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dedup text;
  v_count integer := 0;
  v_task record;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  v_dedup := concat_ws(
    ':',
    p_template_key,
    coalesce(p_booking_id::text, 'no_booking'),
    coalesce(p_participant_id::text, 'no_participant'),
    coalesce(p_visa_application_id::text, 'no_visa')
  );

  for v_task in
    update public.operation_tasks
    set
      status = 'completed',
      completed_at = coalesce(completed_at, now()),
      completed_by = coalesce(completed_by, auth.uid()),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    where deduplication_key = v_dedup
      and status not in ('completed', 'cancelled')
    returning id
  loop
    v_count := v_count + 1;
    perform public.log_operation_task_history(v_task.id, 'completed', null, 'completed', coalesce(p_metadata, '{}'::jsonb));

    update public.operation_task_notifications
    set read_at = coalesce(read_at, now())
    where task_id = v_task.id
      and read_at is null;
  end loop;

  return v_count;
end;
$$;

create or replace function public.validate_booking_flight_traveler()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flight_booking_id uuid;
  v_participant_booking_id uuid;
begin
  select booking_id into v_flight_booking_id
  from public.booking_flight_reservations
  where id = new.flight_reservation_id;

  select booking_id into v_participant_booking_id
  from public.booking_participants
  where id = new.participant_id;

  if v_flight_booking_id is null or v_participant_booking_id is null or v_flight_booking_id is distinct from v_participant_booking_id then
    raise exception 'flight_traveler_booking_mismatch'
      using detail = 'The traveler must belong to the same booking as the flight reservation.';
  end if;

  new.booking_id := v_flight_booking_id;
  return new;
end;
$$;

drop trigger if exists validate_booking_flight_traveler on public.booking_flight_travelers;
create trigger validate_booking_flight_traveler
before insert or update on public.booking_flight_travelers
for each row execute function public.validate_booking_flight_traveler();

drop trigger if exists booking_flight_travelers_updated_at on public.booking_flight_travelers;
create trigger booking_flight_travelers_updated_at
before update on public.booking_flight_travelers
for each row execute function public.set_updated_at();

create or replace function public.refresh_booking_flight_traveler_count(p_flight_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.booking_flight_reservations f
  set
    linked_traveler_count = (
      select count(*)::integer
      from public.booking_flight_travelers t
      where t.flight_reservation_id = p_flight_reservation_id
        and t.traveler_status <> 'cancelled'
    ),
    required_traveler_count = (
      select count(*)::integer
      from public.booking_participants p
      where p.booking_id = f.booking_id
    )
  where f.id = p_flight_reservation_id;
end;
$$;

create or replace function public.log_booking_flight_traveler_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
  v_flight_id uuid;
  v_booking_id uuid;
  v_participant_id uuid;
begin
  if tg_op = 'INSERT' then
    v_event := 'traveler_added';
    v_flight_id := new.flight_reservation_id;
    v_booking_id := new.booking_id;
    v_participant_id := new.participant_id;
  elsif tg_op = 'DELETE' then
    v_event := 'traveler_removed';
    v_flight_id := old.flight_reservation_id;
    v_booking_id := old.booking_id;
    v_participant_id := old.participant_id;
  else
    v_event := 'traveler_modified';
    v_flight_id := new.flight_reservation_id;
    v_booking_id := new.booking_id;
    v_participant_id := new.participant_id;
  end if;

  insert into public.booking_flight_reservation_history (
    flight_reservation_id,
    booking_id,
    participant_id,
    event_type,
    actor_id,
    metadata
  )
  values (
    v_flight_id,
    v_booking_id,
    v_participant_id,
    v_event,
    auth.uid(),
    jsonb_build_object('table', 'booking_flight_travelers')
  );

  perform public.refresh_booking_flight_traveler_count(v_flight_id);

  return coalesce(new, old);
end;
$$;

drop trigger if exists booking_flight_traveler_history on public.booking_flight_travelers;
create trigger booking_flight_traveler_history
after insert or update or delete on public.booking_flight_travelers
for each row execute function public.log_booking_flight_traveler_change();

create or replace function public.validate_booking_flight_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required integer := 0;
  v_linked integer := 0;
begin
  new.pnr_normalized := public.normalize_flight_pnr(new.pnr);
  if new.pnr_normalized is not null then
    new.pnr := new.pnr_normalized;
  end if;

  if new.status in ('booked', 'ticket_sent')
     and (
       new.pnr_normalized is null
       or nullif(trim(coalesce(new.airline, '')), '') is null
       or nullif(trim(coalesce(new.flight_number, '')), '') is null
       or new.departure_at is null
       or new.return_at is null
       or jsonb_array_length(coalesce(new.segments, '[]'::jsonb)) = 0
     ) then
    raise exception 'flight_required_fields_missing'
      using detail = 'PNR, airline, flight number, departure, return and at least one segment are required before booking a flight.';
  end if;

  select count(*)::integer into v_required
  from public.booking_participants
  where booking_id = new.booking_id;

  if new.id is not null then
    select count(*)::integer into v_linked
    from public.booking_flight_travelers
    where flight_reservation_id = new.id
      and traveler_status <> 'cancelled';
  end if;

  new.required_traveler_count := v_required;
  new.linked_traveler_count := v_linked;

  if new.status = 'ticket_sent'
     and (
       (new.ticket_document_id is null and nullif(trim(coalesce(new.ticket_storage_path, '')), '') is null)
       or new.ticket_sent_to_customer is distinct from true
       or v_required = 0
       or v_linked < v_required
     ) then
    raise exception 'flight_ticket_required'
      using detail = 'Ticket PDF, customer send confirmation and all booking travelers are required before marking ticket sent.';
  end if;

  if new.status = 'ticket_sent' and new.flight_completed_at is null then
    new.flight_completed_at := now();
  end if;

  if new.ticket_sent_to_customer = true and new.ticket_sent_at is null then
    new.ticket_sent_at := now();
  end if;

  if new.email_sent = true and new.email_sent_at is null then
    new.email_sent_at := now();
  end if;

  return new;
end;
$$;

create or replace function public.log_booking_flight_reservation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'created';
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    v_event := 'cancelled';
  elsif new.ticket_sent_to_customer = true and old.ticket_sent_to_customer is distinct from true then
    v_event := 'ticket_sent';
  elsif (new.ticket_document_id is distinct from old.ticket_document_id or new.ticket_storage_path is distinct from old.ticket_storage_path)
        and (new.ticket_document_id is not null or nullif(trim(coalesce(new.ticket_storage_path, '')), '') is not null) then
    v_event := 'ticket_uploaded';
  elsif old.status is distinct from new.status
        or old.pnr is distinct from new.pnr
        or old.airline is distinct from new.airline
        or old.flight_number is distinct from new.flight_number
        or old.departure_at is distinct from new.departure_at
        or old.return_at is distinct from new.return_at then
    v_event := 'modified';
  else
    return new;
  end if;

  insert into public.booking_flight_reservation_history (
    flight_reservation_id,
    booking_id,
    event_type,
    actor_id,
    old_status,
    new_status,
    metadata
  )
  values (
    new.id,
    new.booking_id,
    v_event,
    coalesce(new.updated_by, auth.uid()),
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    jsonb_build_object(
      'pnr', new.pnr_normalized,
      'airline', new.airline,
      'flight_number', new.flight_number
    )
  );

  return new;
end;
$$;

drop trigger if exists booking_flight_reservation_history on public.booking_flight_reservations;
create trigger booking_flight_reservation_history
after insert or update on public.booking_flight_reservations
for each row execute function public.log_booking_flight_reservation_change();

create or replace function public.ensure_flight_reservation_task(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id;

  if not found then
    return null;
  end if;

  insert into public.booking_flight_reservations (
    booking_id,
    status,
    created_by,
    updated_by,
    required_traveler_count
  )
  values (
    p_booking_id,
    'not_booked',
    auth.uid(),
    auth.uid(),
    (select count(*)::integer from public.booking_participants where booking_id = p_booking_id)
  )
  on conflict do nothing;

  return public.ensure_operation_task(
    'reserve_flight',
    p_booking_id,
    null,
    null,
    v_booking.trip_id,
    jsonb_build_object(
      'source', 'payment_confirmation',
      'workflow', 'reserve_customer_flight',
      'booking_reference', v_booking.reference
    )
  );
end;
$$;

create or replace function public.handle_booking_flight_status_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send_task_id uuid;
begin
  if new.status in ('booked', 'ticket_sent') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.complete_operation_task_by_key(
      'reserve_flight',
      new.booking_id,
      null,
      null,
      jsonb_build_object('flight_reservation_id', new.id, 'pnr', new.pnr_normalized)
    );

    if new.status = 'booked' then
      v_send_task_id := public.ensure_operation_task(
        'send_flight_ticket',
        new.booking_id,
        null,
        null,
        null,
        jsonb_build_object('flight_reservation_id', new.id, 'pnr', new.pnr_normalized)
      );
    end if;
  end if;

  if new.status = 'ticket_sent' then
    perform public.complete_operation_task_by_key(
      'send_flight_ticket',
      new.booking_id,
      null,
      null,
      jsonb_build_object('flight_reservation_id', new.id, 'pnr', new.pnr_normalized, 'ticket_sent_at', coalesce(new.ticket_sent_at, now()))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists booking_flight_complete_task on public.booking_flight_reservations;
drop trigger if exists booking_flight_status_tasks on public.booking_flight_reservations;
create trigger booking_flight_status_tasks
after insert or update of status on public.booking_flight_reservations
for each row execute function public.handle_booking_flight_status_tasks();

create or replace function public.schedule_flight_reservation_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.operation_task_notifications (
    task_id,
    notification_type,
    title,
    message,
    scheduled_for,
    metadata
  )
  select
    t.id,
    'late_task_reminder',
    case
      when t.category = 'flight_ticket_delivery' then 'Billet à envoyer au client'
      else 'Vol toujours à réserver'
    end,
    case
      when t.category = 'flight_ticket_delivery' then 'Le billet est réservé mais n’a pas encore été confirmé comme envoyé au client.'
      else 'La réservation du vol client est en retard.'
    end,
    now(),
    jsonb_build_object('booking_id', t.booking_id, 'category', t.category, 'deduplication_key', t.deduplication_key)
  from public.operation_tasks t
  left join lateral (
    select n.id
    from public.operation_task_notifications n
    where n.task_id = t.id
      and n.notification_type = 'late_task_reminder'
      and n.created_at > now() - interval '24 hours'
    limit 1
  ) recent on true
  where t.category in ('flight_reservation', 'flight_ticket_delivery')
    and t.status not in ('completed', 'cancelled')
    and coalesce(t.deadline, t.created_at + interval '24 hours') <= now()
    and recent.id is null;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.remind_flight_tasks_for_booking(p_booking_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  insert into public.operation_task_notifications (
    task_id,
    notification_type,
    title,
    message,
    scheduled_for,
    metadata
  )
  select
    t.id,
    'manual_reminder',
    'Relance opération vol',
    'Relance manuelle depuis le dossier réservation.',
    now(),
    jsonb_build_object('booking_id', p_booking_id, 'category', t.category, 'manual', true)
  from public.operation_tasks t
  where t.booking_id = p_booking_id
    and t.category in ('flight_reservation', 'flight_ticket_delivery')
    and t.status not in ('completed', 'cancelled');

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

drop policy if exists "staff manage booking flight travelers" on public.booking_flight_travelers;
alter table public.booking_flight_travelers enable row level security;
create policy "staff manage booking flight travelers"
on public.booking_flight_travelers
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage operation task history" on public.operation_task_history;
alter table public.operation_task_history enable row level security;
create policy "staff manage operation task history"
on public.operation_task_history
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage booking flight history" on public.booking_flight_reservation_history;
alter table public.booking_flight_reservation_history enable row level security;
create policy "staff manage booking flight history"
on public.booking_flight_reservation_history
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

grant execute on function public.ensure_operation_task(text, uuid, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.complete_operation_task_by_key(text, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.ensure_flight_reservation_task(uuid) to authenticated;
grant execute on function public.schedule_flight_reservation_reminders() to authenticated;
grant execute on function public.remind_flight_tasks_for_booking(uuid) to authenticated;

comment on function public.schedule_flight_reservation_reminders() is
'Run from Supabase cron once daily or every 12 hours. Example: select public.schedule_flight_reservation_reminders();';

notify pgrst, 'reload schema';
