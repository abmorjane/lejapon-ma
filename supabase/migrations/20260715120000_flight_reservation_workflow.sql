-- Flight Reservation Workflow V1.
-- Creates a booking-level flight reservation record and an operational task
-- automatically when a payment is confirmed.

create table if not exists public.operation_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'waiting', 'completed', 'cancelled')),
  assigned_to uuid references auth.users(id) on delete set null,
  reservation_id uuid references public.bookings(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  visa_application_id uuid references public.visa_applications(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  customer_id uuid references public.clients(id) on delete set null,
  category text not null default 'general',
  deadline timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_task_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.operation_tasks(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete set null,
  notification_type text not null default 'reminder',
  title text not null,
  message text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_flight_reservations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status text not null default 'not_booked'
    check (status in ('not_booked', 'booked', 'ticket_sent')),
  pnr text,
  e_ticket_number text,
  fare_mad numeric(12,2),
  booking_class text,
  baggage text,
  airline text,
  flight_number text,
  departure_at timestamptz,
  return_at timestamptz,
  segments jsonb not null default '[]'::jsonb,
  ticket_document_id uuid references public.booking_documents(id) on delete set null,
  ticket_storage_path text,
  ticket_uploaded_at timestamptz,
  ticket_sent_to_customer boolean not null default false,
  ticket_sent_at timestamptz,
  email_sent boolean not null default false,
  email_sent_at timestamptz,
  flight_completed_at timestamptz,
  flight_completed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_flight_reservations_one_per_booking unique (booking_id),
  constraint booking_flight_reservations_amounts_non_negative
    check (fare_mad is null or fare_mad >= 0)
);

create index if not exists idx_operation_tasks_booking_category_status
  on public.operation_tasks(booking_id, category, status);

create index if not exists idx_operation_tasks_deadline
  on public.operation_tasks(deadline)
  where status not in ('completed', 'cancelled');

create index if not exists idx_operation_tasks_status_priority
  on public.operation_tasks(status, priority, deadline);

create index if not exists idx_operation_task_notifications_task_scheduled
  on public.operation_task_notifications(task_id, scheduled_for);

create index if not exists idx_booking_flight_reservations_booking
  on public.booking_flight_reservations(booking_id);

create index if not exists idx_booking_flight_reservations_status
  on public.booking_flight_reservations(status, updated_at desc);

create index if not exists idx_booking_flight_reservations_missing
  on public.booking_flight_reservations(booking_id)
  where status <> 'ticket_sent';

drop trigger if exists operation_tasks_updated_at on public.operation_tasks;
create trigger operation_tasks_updated_at
before update on public.operation_tasks
for each row execute function public.set_updated_at();

drop trigger if exists booking_flight_reservations_updated_at on public.booking_flight_reservations;
create trigger booking_flight_reservations_updated_at
before update on public.booking_flight_reservations
for each row execute function public.set_updated_at();

create or replace function public.validate_booking_flight_reservation()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('booked', 'ticket_sent')
     and (
       nullif(trim(coalesce(new.pnr, '')), '') is null
       or nullif(trim(coalesce(new.airline, '')), '') is null
       or nullif(trim(coalesce(new.flight_number, '')), '') is null
       or new.departure_at is null
       or new.return_at is null
     ) then
    raise exception 'flight_required_fields_missing'
      using detail = 'PNR, airline, flight number, departure and return are required before booking a flight.';
  end if;

  if new.status = 'ticket_sent'
     and (
       (new.ticket_document_id is null and nullif(trim(coalesce(new.ticket_storage_path, '')), '') is null)
       or new.ticket_sent_to_customer is distinct from true
     ) then
    raise exception 'flight_ticket_required'
      using detail = 'Ticket PDF and customer send confirmation are required before marking ticket sent.';
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

drop trigger if exists validate_booking_flight_reservation on public.booking_flight_reservations;
create trigger validate_booking_flight_reservation
before insert or update on public.booking_flight_reservations
for each row execute function public.validate_booking_flight_reservation();

create or replace function public.ensure_flight_reservation_task(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_task_id uuid;
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
    updated_by
  )
  values (
    p_booking_id,
    'not_booked',
    auth.uid(),
    auth.uid()
  )
  on conflict (booking_id) do nothing;

  select id into v_task_id
  from public.operation_tasks
  where booking_id = p_booking_id
    and category = 'flight_reservation'
    and status not in ('completed', 'cancelled')
  order by created_at asc
  limit 1;

  if v_task_id is null then
    insert into public.operation_tasks (
      title,
      description,
      priority,
      status,
      reservation_id,
      booking_id,
      trip_id,
      customer_id,
      category,
      deadline,
      created_by,
      metadata
    )
    values (
      'Reserve customer''s flight',
      'Réserver le vol client après confirmation du paiement.',
      'high',
      'todo',
      p_booking_id,
      p_booking_id,
      v_booking.trip_id,
      v_booking.client_id,
      'flight_reservation',
      now() + interval '24 hours',
      auth.uid(),
      jsonb_build_object(
        'source', 'payment_confirmation',
        'workflow', 'reserve_customer_flight',
        'booking_reference', v_booking.reference
      )
    )
    returning id into v_task_id;

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
      'Vol à réserver',
      'Réserver le vol client sous 24h.',
      now() + interval '24 hours',
      jsonb_build_object('booking_id', p_booking_id, 'category', 'flight_reservation')
    );
  end if;

  return v_task_id;
end;
$$;

create or replace function public.create_flight_task_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_id is not null
     and lower(coalesce(new.status::text, '')) in ('received', 'paid', 'completed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.ensure_flight_reservation_task(new.booking_id);
  end if;

  return new;
end;
$$;

drop trigger if exists payments_create_flight_task on public.payments;
create trigger payments_create_flight_task
after insert or update of status on public.payments
for each row execute function public.create_flight_task_after_payment();

create or replace function public.complete_flight_task_after_ticket_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ticket_sent' then
    update public.operation_tasks
    set
      status = 'completed',
      completed_at = coalesce(completed_at, now()),
      completed_by = coalesce(completed_by, auth.uid()),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('flight_completed_at', coalesce(new.flight_completed_at, now()))
    where booking_id = new.booking_id
      and category = 'flight_reservation'
      and status not in ('completed', 'cancelled');
  end if;

  return new;
end;
$$;

drop trigger if exists booking_flight_complete_task on public.booking_flight_reservations;
create trigger booking_flight_complete_task
after update of status on public.booking_flight_reservations
for each row execute function public.complete_flight_task_after_ticket_sent();

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
    'Vol toujours à réserver',
    'La réservation du vol client est en retard.',
    now(),
    jsonb_build_object('booking_id', t.booking_id, 'category', 'flight_reservation')
  from public.operation_tasks t
  left join lateral (
    select n.id
    from public.operation_task_notifications n
    where n.task_id = t.id
      and n.notification_type = 'late_task_reminder'
      and n.created_at > now() - interval '24 hours'
    limit 1
  ) recent on true
  where t.category = 'flight_reservation'
    and t.status not in ('completed', 'cancelled')
    and coalesce(t.deadline, t.created_at + interval '24 hours') <= now()
    and recent.id is null;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function public.ensure_flight_reservation_task(uuid) to authenticated;
grant execute on function public.schedule_flight_reservation_reminders() to authenticated;

alter table public.operation_tasks enable row level security;
alter table public.operation_task_notifications enable row level security;
alter table public.booking_flight_reservations enable row level security;

drop policy if exists "staff manage operation tasks" on public.operation_tasks;
create policy "staff manage operation tasks"
on public.operation_tasks
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage operation task notifications" on public.operation_task_notifications;
create policy "staff manage operation task notifications"
on public.operation_task_notifications
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage booking flight reservations" on public.booking_flight_reservations;
create policy "staff manage booking flight reservations"
on public.booking_flight_reservations
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

notify pgrst, 'reload schema';
