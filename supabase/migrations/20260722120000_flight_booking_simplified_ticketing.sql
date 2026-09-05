-- Flight booking V2: quick reservation, traveler-level ticketing, and private ticket associations.
-- This migration is additive and keeps legacy flight columns/documents for compatibility.

alter table public.booking_flight_reservations
  add column if not exists booking_platform text,
  add column if not exists booking_platform_other text,
  add column if not exists fare_amount numeric(12,2),
  add column if not exists fare_currency text not null default 'MAD',
  add column if not exists ticketing_notes text;

update public.booking_flight_reservations
set fare_amount = fare_mad
where fare_amount is null
  and fare_mad is not null;

alter table public.booking_flight_reservations
  drop constraint if exists booking_flight_reservations_status_check;

alter table public.booking_flight_reservations
  add constraint booking_flight_reservations_status_check
  check (status in (
    'not_booked',
    'booked',
    'ticket_sent',
    'pending_booking',
    'reserved',
    'partially_ticketed',
    'ticketed',
    'delivered',
    'cancelled'
  ));

alter table public.booking_flight_reservations
  drop constraint if exists booking_flight_reservations_fare_amount_non_negative;

alter table public.booking_flight_reservations
  add constraint booking_flight_reservations_fare_amount_non_negative
  check (fare_amount is null or fare_amount >= 0);

create table if not exists public.booking_flight_ticket_documents (
  id uuid primary key default gen_random_uuid(),
  flight_reservation_id uuid not null references public.booking_flight_reservations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_document_id uuid references public.booking_documents(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint,
  source text not null default 'manual_upload'
    check (source in ('manual_upload', 'legacy_single_file', 'pdf_import')),
  extraction_status text not null default 'not_started'
    check (extraction_status in ('not_started', 'text_extracted', 'ocr_required', 'failed', 'verified')),
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  replaced_by_id uuid references public.booking_flight_ticket_documents(id) on delete set null,
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_flight_ticket_documents_mime_check
    check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  constraint booking_flight_ticket_documents_size_check
    check (size_bytes is null or (size_bytes > 0 and size_bytes <= 26214400))
);

create index if not exists idx_booking_flight_ticket_documents_flight
  on public.booking_flight_ticket_documents (flight_reservation_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_booking_flight_ticket_documents_booking
  on public.booking_flight_ticket_documents (booking_id, created_at desc)
  where deleted_at is null;

create unique index if not exists booking_flight_ticket_documents_booking_document_unique
  on public.booking_flight_ticket_documents (booking_document_id)
  where booking_document_id is not null and deleted_at is null;

drop trigger if exists booking_flight_ticket_documents_updated_at on public.booking_flight_ticket_documents;
create trigger booking_flight_ticket_documents_updated_at
before update on public.booking_flight_ticket_documents
for each row execute function public.set_updated_at();

create table if not exists public.booking_flight_ticket_document_travelers (
  id uuid primary key default gen_random_uuid(),
  flight_ticket_document_id uuid not null references public.booking_flight_ticket_documents(id) on delete cascade,
  flight_reservation_id uuid not null references public.booking_flight_reservations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  participant_id uuid not null references public.booking_participants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint booking_flight_ticket_doc_travelers_unique unique (flight_ticket_document_id, participant_id)
);

create index if not exists idx_booking_flight_ticket_doc_travelers_flight
  on public.booking_flight_ticket_document_travelers (flight_reservation_id);

create index if not exists idx_booking_flight_ticket_doc_travelers_participant
  on public.booking_flight_ticket_document_travelers (participant_id);

create table if not exists public.booking_flight_traveler_ticket_numbers (
  id uuid primary key default gen_random_uuid(),
  flight_traveler_id uuid references public.booking_flight_travelers(id) on delete cascade,
  flight_reservation_id uuid not null references public.booking_flight_reservations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  participant_id uuid not null references public.booking_participants(id) on delete cascade,
  e_ticket_number text not null,
  source_document_id uuid references public.booking_flight_ticket_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_flight_ticket_number_not_empty
    check (nullif(trim(e_ticket_number), '') is not null)
);

create unique index if not exists booking_flight_traveler_ticket_numbers_unique
  on public.booking_flight_traveler_ticket_numbers (flight_reservation_id, participant_id, e_ticket_number);

create index if not exists idx_booking_flight_traveler_ticket_numbers_participant
  on public.booking_flight_traveler_ticket_numbers (participant_id);

drop trigger if exists booking_flight_traveler_ticket_numbers_updated_at on public.booking_flight_traveler_ticket_numbers;
create trigger booking_flight_traveler_ticket_numbers_updated_at
before update on public.booking_flight_traveler_ticket_numbers
for each row execute function public.set_updated_at();

create or replace function public.validate_booking_flight_ticket_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_document_booking_id uuid;
begin
  select booking_id into v_booking_id
  from public.booking_flight_reservations
  where id = new.flight_reservation_id;

  if v_booking_id is null then
    raise exception 'flight_reservation_not_found';
  end if;

  if new.booking_id is distinct from v_booking_id then
    raise exception 'flight_ticket_document_booking_mismatch';
  end if;

  if new.booking_document_id is not null then
    select booking_id into v_document_booking_id
    from public.booking_documents
    where id = new.booking_document_id;

    if v_document_booking_id is distinct from new.booking_id then
      raise exception 'booking_document_mismatch';
    end if;
  end if;

  if nullif(trim(coalesce(new.storage_path, '')), '') is null then
    raise exception 'flight_ticket_storage_path_required';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_booking_flight_ticket_document on public.booking_flight_ticket_documents;
create trigger validate_booking_flight_ticket_document
before insert or update on public.booking_flight_ticket_documents
for each row execute function public.validate_booking_flight_ticket_document();

create or replace function public.validate_booking_flight_ticket_document_traveler()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc record;
  v_participant_booking_id uuid;
begin
  select flight_reservation_id, booking_id into v_doc
  from public.booking_flight_ticket_documents
  where id = new.flight_ticket_document_id
    and deleted_at is null;

  if not found then
    raise exception 'flight_ticket_document_not_found';
  end if;

  if new.flight_reservation_id is distinct from v_doc.flight_reservation_id
     or new.booking_id is distinct from v_doc.booking_id then
    raise exception 'flight_ticket_document_traveler_scope_mismatch';
  end if;

  select booking_id into v_participant_booking_id
  from public.booking_participants
  where id = new.participant_id;

  if v_participant_booking_id is distinct from new.booking_id then
    raise exception 'flight_ticket_participant_booking_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_booking_flight_ticket_document_traveler on public.booking_flight_ticket_document_travelers;
create trigger validate_booking_flight_ticket_document_traveler
before insert or update on public.booking_flight_ticket_document_travelers
for each row execute function public.validate_booking_flight_ticket_document_traveler();

create or replace function public.validate_booking_flight_traveler_ticket_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flight_booking_id uuid;
  v_participant_booking_id uuid;
  v_traveler record;
  v_document record;
begin
  select booking_id into v_flight_booking_id
  from public.booking_flight_reservations
  where id = new.flight_reservation_id;

  if v_flight_booking_id is null then
    raise exception 'flight_reservation_not_found';
  end if;

  if new.booking_id is distinct from v_flight_booking_id then
    raise exception 'ticket_number_booking_mismatch';
  end if;

  select booking_id into v_participant_booking_id
  from public.booking_participants
  where id = new.participant_id;

  if v_participant_booking_id is distinct from new.booking_id then
    raise exception 'ticket_number_participant_booking_mismatch';
  end if;

  if new.flight_traveler_id is not null then
    select flight_reservation_id, booking_id, participant_id into v_traveler
    from public.booking_flight_travelers
    where id = new.flight_traveler_id;

    if not found then
      raise exception 'ticket_number_traveler_not_found';
    end if;

    if v_traveler.flight_reservation_id is distinct from new.flight_reservation_id
       or v_traveler.booking_id is distinct from new.booking_id
       or v_traveler.participant_id is distinct from new.participant_id then
      raise exception 'ticket_number_traveler_mismatch';
    end if;
  end if;

  if new.source_document_id is not null then
    select flight_reservation_id, booking_id into v_document
    from public.booking_flight_ticket_documents
    where id = new.source_document_id
      and deleted_at is null;

    if not found then
      raise exception 'ticket_number_document_not_found';
    end if;

    if v_document.flight_reservation_id is distinct from new.flight_reservation_id
       or v_document.booking_id is distinct from new.booking_id then
      raise exception 'ticket_number_document_mismatch';
    end if;
  end if;

  new.e_ticket_number := regexp_replace(trim(new.e_ticket_number), '\s+', '', 'g');
  return new;
end;
$$;

drop trigger if exists validate_booking_flight_traveler_ticket_number on public.booking_flight_traveler_ticket_numbers;
create trigger validate_booking_flight_traveler_ticket_number
before insert or update on public.booking_flight_traveler_ticket_numbers
for each row execute function public.validate_booking_flight_traveler_ticket_number();

create or replace function public.booking_flight_ticketed_traveler_count(p_flight_reservation_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.booking_flight_travelers t
  where t.flight_reservation_id = p_flight_reservation_id
    and t.traveler_status <> 'cancelled'
    and (
      nullif(trim(coalesce(t.e_ticket_number, '')), '') is not null
      or exists (
        select 1
        from public.booking_flight_traveler_ticket_numbers n
        where n.flight_reservation_id = t.flight_reservation_id
          and n.participant_id = t.participant_id
      )
      or exists (
        select 1
        from public.booking_flight_ticket_document_travelers dt
        join public.booking_flight_ticket_documents d on d.id = dt.flight_ticket_document_id
        where dt.flight_reservation_id = t.flight_reservation_id
          and dt.participant_id = t.participant_id
          and d.deleted_at is null
      )
      or exists (
        select 1
        from public.booking_flight_reservations f
        where f.id = t.flight_reservation_id
          and (
            f.ticket_document_id is not null
            or nullif(trim(coalesce(f.ticket_storage_path, '')), '') is not null
          )
      )
    );
$$;

create or replace function public.validate_booking_flight_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required integer := 0;
  v_linked integer := 0;
  v_ticketed integer := 0;
  v_amount numeric;
  v_modern_status boolean := false;
begin
  new.pnr_normalized := public.normalize_flight_pnr(new.pnr);
  if new.pnr_normalized is not null then
    new.pnr := new.pnr_normalized;
  end if;

  v_amount := coalesce(new.fare_amount, new.fare_mad);
  v_modern_status := new.status in ('reserved', 'partially_ticketed', 'ticketed', 'delivered');

  select count(*)::integer into v_required
  from public.booking_participants
  where booking_id = new.booking_id;

  if new.id is not null then
    select count(*)::integer into v_linked
    from public.booking_flight_travelers
    where flight_reservation_id = new.id
      and traveler_status <> 'cancelled';

    select public.booking_flight_ticketed_traveler_count(new.id) into v_ticketed;
  end if;

  new.required_traveler_count := v_required;
  new.linked_traveler_count := v_linked;
  new.fare_currency := upper(nullif(trim(coalesce(new.fare_currency, '')), ''));
  if new.fare_currency is null then
    new.fare_currency := 'MAD';
  end if;
  if new.fare_amount is null and new.fare_mad is not null then
    new.fare_amount := new.fare_mad;
  end if;

  if v_modern_status
     and (
       new.pnr_normalized is null
       or nullif(trim(coalesce(new.booking_platform, '')), '') is null
       or v_amount is null
       or v_amount < 0
       or nullif(trim(coalesce(new.fare_currency, '')), '') is null
       or v_linked <= 0
     ) then
    raise exception 'flight_reservation_required_fields_missing'
      using detail = 'Booking platform, PNR, total fare, currency and at least one traveler are required to mark a flight as reserved.';
  end if;

  if new.status in ('ticketed', 'delivered') and (v_linked = 0 or v_ticketed < v_linked) then
    raise exception 'flight_ticket_evidence_required'
      using detail = 'Every linked traveler needs an e-ticket number or an associated ticket document before ticketed/delivered status.';
  end if;

  if new.status = 'delivered' and new.ticket_sent_to_customer is distinct from true then
    raise exception 'flight_ticket_delivery_confirmation_required'
      using detail = 'Ticket delivery must be confirmed before delivered status.';
  end if;

  if new.status in ('delivered', 'ticket_sent') and new.flight_completed_at is null then
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

create or replace function public.recalculate_booking_flight_status(p_flight_reservation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flight public.booking_flight_reservations%rowtype;
  v_linked integer := 0;
  v_ticketed integer := 0;
  v_next_status text;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  select * into v_flight
  from public.booking_flight_reservations
  where id = p_flight_reservation_id;

  if not found or v_flight.status = 'cancelled' then
    return null;
  end if;

  select count(*)::integer into v_linked
  from public.booking_flight_travelers
  where flight_reservation_id = p_flight_reservation_id
    and traveler_status <> 'cancelled';

  select public.booking_flight_ticketed_traveler_count(p_flight_reservation_id) into v_ticketed;

  v_next_status := case
    when public.normalize_flight_pnr(v_flight.pnr) is null then 'pending_booking'
    when nullif(trim(coalesce(v_flight.booking_platform, '')), '') is null then 'pending_booking'
    when coalesce(v_flight.fare_amount, v_flight.fare_mad) is null then 'pending_booking'
    when v_linked <= 0 then 'pending_booking'
    when v_flight.ticket_sent_to_customer = true and v_ticketed >= v_linked then 'delivered'
    when v_ticketed >= v_linked then 'ticketed'
    when v_ticketed > 0 then 'partially_ticketed'
    else 'reserved'
  end;

  if v_next_status is distinct from v_flight.status then
    update public.booking_flight_reservations
    set status = v_next_status,
        linked_traveler_count = v_linked,
        updated_at = now()
    where id = p_flight_reservation_id;
  else
    update public.booking_flight_reservations
    set linked_traveler_count = v_linked,
        updated_at = now()
    where id = p_flight_reservation_id;
  end if;

  return v_next_status;
end;
$$;

create or replace function public.log_booking_flight_ticket_document_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_flight_reservation_history (
      flight_reservation_id,
      booking_id,
      event_type,
      actor_id,
      metadata
    )
    values (
      new.flight_reservation_id,
      new.booking_id,
      'ticket_document_uploaded',
      coalesce(new.created_by, auth.uid()),
      jsonb_build_object('ticket_document_id', new.id, 'booking_document_id', new.booking_document_id, 'file_name', new.file_name)
    );
  elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then
    insert into public.booking_flight_reservation_history (
      flight_reservation_id,
      booking_id,
      event_type,
      actor_id,
      metadata
    )
    values (
      new.flight_reservation_id,
      new.booking_id,
      'ticket_document_removed',
      coalesce(new.updated_by, auth.uid()),
      jsonb_build_object('ticket_document_id', new.id, 'booking_document_id', new.booking_document_id, 'file_name', new.file_name)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists booking_flight_ticket_document_history on public.booking_flight_ticket_documents;
create trigger booking_flight_ticket_document_history
after insert or update on public.booking_flight_ticket_documents
for each row execute function public.log_booking_flight_ticket_document_change();

create or replace function public.log_booking_flight_ticket_document_traveler_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.booking_flight_ticket_document_travelers%rowtype;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
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
    v_row.flight_reservation_id,
    v_row.booking_id,
    v_row.participant_id,
    case when tg_op = 'DELETE' then 'ticket_document_association_removed' else 'ticket_document_association_added' end,
    coalesce(v_row.created_by, auth.uid()),
    jsonb_build_object('ticket_document_id', v_row.flight_ticket_document_id)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_flight_ticket_document_traveler_history on public.booking_flight_ticket_document_travelers;
create trigger booking_flight_ticket_document_traveler_history
after insert or delete on public.booking_flight_ticket_document_travelers
for each row execute function public.log_booking_flight_ticket_document_traveler_change();

create or replace function public.log_booking_flight_ticket_number_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.booking_flight_traveler_ticket_numbers%rowtype;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
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
    v_row.flight_reservation_id,
    v_row.booking_id,
    v_row.participant_id,
    case when tg_op = 'DELETE' then 'traveler_ticket_number_removed' else 'traveler_ticket_number_added' end,
    coalesce(v_row.updated_by, v_row.created_by, auth.uid()),
    jsonb_build_object('ticket_number_last4', right(v_row.e_ticket_number, 4), 'source_document_id', v_row.source_document_id)
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists booking_flight_ticket_number_history on public.booking_flight_traveler_ticket_numbers;
create trigger booking_flight_ticket_number_history
after insert or delete on public.booking_flight_traveler_ticket_numbers
for each row execute function public.log_booking_flight_ticket_number_change();

create or replace function public.recalculate_booking_flight_status_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flight_id uuid;
begin
  if tg_op = 'DELETE' then
    v_flight_id := old.flight_reservation_id;
  else
    v_flight_id := new.flight_reservation_id;
  end if;
  perform public.recalculate_booking_flight_status(v_flight_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists recalculate_booking_flight_status_from_travelers on public.booking_flight_travelers;
create trigger recalculate_booking_flight_status_from_travelers
after insert or update or delete on public.booking_flight_travelers
for each row execute function public.recalculate_booking_flight_status_trigger();

drop trigger if exists recalculate_booking_flight_status_from_ticket_numbers on public.booking_flight_traveler_ticket_numbers;
create trigger recalculate_booking_flight_status_from_ticket_numbers
after insert or update or delete on public.booking_flight_traveler_ticket_numbers
for each row execute function public.recalculate_booking_flight_status_trigger();

drop trigger if exists recalculate_booking_flight_status_from_ticket_docs on public.booking_flight_ticket_document_travelers;
create trigger recalculate_booking_flight_status_from_ticket_docs
after insert or update or delete on public.booking_flight_ticket_document_travelers
for each row execute function public.recalculate_booking_flight_status_trigger();

create or replace function public.handle_booking_flight_status_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send_task_id uuid;
begin
  if new.status in ('booked', 'reserved', 'partially_ticketed', 'ticketed', 'delivered', 'ticket_sent')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.complete_operation_task_by_key(
      'reserve_flight',
      new.booking_id,
      null,
      null,
      jsonb_build_object('flight_reservation_id', new.id, 'pnr', new.pnr_normalized)
    );

    if new.status in ('booked', 'reserved', 'partially_ticketed', 'ticketed') then
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

  if new.status in ('delivered', 'ticket_sent') then
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

create or replace function public.client_portal_can_access_booking_participant(_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_user_email as (
    select nullif(lower(trim(auth.email())), '') as email
  )
  select coalesce(public.v2_is_staff(auth.uid()), false)
    or exists (
      select 1
      from public.booking_participants p
      cross join current_user_email cue
      where p.id = _participant_id
        and cue.email is not null
        and (
          lower(coalesce(p.email, '')) = cue.email
          or (p.is_lead = true and public.client_portal_is_booking_owner(p.booking_id))
        )
    );
$$;

create or replace function public.client_portal_can_access_flight_ticket_document(_booking_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.v2_is_staff(auth.uid()), false)
    or exists (
      select 1
      from public.booking_flight_ticket_documents d
      where d.booking_document_id = _booking_document_id
        and d.deleted_at is null
        and exists (
          select 1
          from public.booking_flight_ticket_document_travelers dt
          where dt.flight_ticket_document_id = d.id
            and public.client_portal_can_access_booking_participant(dt.participant_id)
        )
    )
    or (
      not exists (
        select 1
        from public.booking_flight_ticket_documents d
        where d.booking_document_id = _booking_document_id
          and d.deleted_at is null
      )
      and exists (
        select 1
        from public.booking_documents bd
        where bd.id = _booking_document_id
          and bd.visible_to_client = true
          and public.client_portal_can_access_booking(bd.booking_id)
          and (
            bd.visibility_scope = 'booking_participants'
            or public.client_portal_is_booking_owner(bd.booking_id)
          )
      )
    );
$$;

alter table public.booking_flight_ticket_documents enable row level security;
alter table public.booking_flight_ticket_document_travelers enable row level security;
alter table public.booking_flight_traveler_ticket_numbers enable row level security;

drop policy if exists "staff manage booking flight ticket documents" on public.booking_flight_ticket_documents;
create policy "staff manage booking flight ticket documents"
on public.booking_flight_ticket_documents
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage booking flight ticket document travelers" on public.booking_flight_ticket_document_travelers;
create policy "staff manage booking flight ticket document travelers"
on public.booking_flight_ticket_document_travelers
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage booking flight traveler ticket numbers" on public.booking_flight_traveler_ticket_numbers;
create policy "staff manage booking flight traveler ticket numbers"
on public.booking_flight_traveler_ticket_numbers
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "client portal read own flight ticket documents" on public.booking_flight_ticket_documents;
create policy "client portal read own flight ticket documents"
on public.booking_flight_ticket_documents
for select
using (
  deleted_at is null
  and exists (
    select 1
    from public.booking_flight_ticket_document_travelers dt
    where dt.flight_ticket_document_id = booking_flight_ticket_documents.id
      and public.client_portal_can_access_booking_participant(dt.participant_id)
  )
);

drop policy if exists "client portal read own flight ticket document travelers" on public.booking_flight_ticket_document_travelers;
create policy "client portal read own flight ticket document travelers"
on public.booking_flight_ticket_document_travelers
for select
using (public.client_portal_can_access_booking_participant(participant_id));

drop policy if exists "client portal read own flight ticket numbers" on public.booking_flight_traveler_ticket_numbers;
create policy "client portal read own flight ticket numbers"
on public.booking_flight_traveler_ticket_numbers
for select
using (public.client_portal_can_access_booking_participant(participant_id));

drop policy if exists "client portal read published booking documents" on public.booking_documents;
create policy "client portal read published booking documents"
on public.booking_documents
for select
using (
  visible_to_client = true
  and public.client_portal_can_access_booking(booking_id)
  and (
    (
      lower(coalesce(document_type, kind, '')) not in ('flight_ticket', 'billet_avion')
      and (
        visibility_scope = 'booking_participants'
        or public.client_portal_is_booking_owner(booking_id)
      )
    )
    or (
      lower(coalesce(document_type, kind, '')) in ('flight_ticket', 'billet_avion')
      and public.client_portal_can_access_flight_ticket_document(id)
    )
  )
);

drop policy if exists "client portal read visible booking-docs" on storage.objects;
create policy "client portal read visible booking-docs"
on storage.objects
for select
using (
  bucket_id = 'booking-docs'
  and (
    exists (
      select 1
      from public.booking_documents d
      where d.storage_path = storage.objects.name
        and d.visible_to_client = true
        and public.client_portal_can_access_booking(d.booking_id)
        and (
          (
            lower(coalesce(d.document_type, d.kind, '')) not in ('flight_ticket', 'billet_avion')
            and (
              d.visibility_scope = 'booking_participants'
              or public.client_portal_is_booking_owner(d.booking_id)
            )
          )
          or (
            lower(coalesce(d.document_type, d.kind, '')) in ('flight_ticket', 'billet_avion')
            and public.client_portal_can_access_flight_ticket_document(d.id)
          )
        )
    )
    or exists (
      select 1
      from public.travel_agreements a
      where a.content->'final_pdf'->>'storage_path' = storage.objects.name
        and (
          (a.booking_id is not null and public.client_portal_can_access_booking(a.booking_id))
          or lower(coalesce(a.client_email, '')) = lower(coalesce(auth.email(), ''))
        )
    )
  )
);

grant execute on function public.booking_flight_ticketed_traveler_count(uuid) to authenticated;
grant execute on function public.recalculate_booking_flight_status(uuid) to authenticated;
grant execute on function public.client_portal_can_access_booking_participant(uuid) to authenticated;
grant execute on function public.client_portal_can_access_flight_ticket_document(uuid) to authenticated;

notify pgrst, 'reload schema';
