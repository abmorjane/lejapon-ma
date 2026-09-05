-- Visa hotel reservation confirmations for Japan embassy dossiers.
-- Keeps group accommodation references stable and preserves generated PDF history.

create table if not exists public.visa_hotel_group_reservations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_hotel_id uuid not null references public.trip_hotels(id) on delete cascade,
  check_in date not null,
  check_out date not null,
  group_reservation_reference text not null,
  group_reservation_name text not null default '団体LEJAPON',
  supplier_reference text,
  partner_name text,
  reservation_status text not null default 'confirmed',
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visa_hotel_group_check_dates check (check_out > check_in),
  constraint visa_hotel_group_status_check check (reservation_status in ('draft', 'confirmed', 'cancelled', 'replaced'))
);

create unique index if not exists visa_hotel_group_ref_unique
  on public.visa_hotel_group_reservations (group_reservation_reference);

create unique index if not exists visa_hotel_group_active_stay_unique
  on public.visa_hotel_group_reservations (trip_id, trip_hotel_id, check_in, check_out)
  where reservation_status <> 'cancelled';

create index if not exists idx_visa_hotel_group_trip
  on public.visa_hotel_group_reservations (trip_id, check_in);

create index if not exists idx_visa_hotel_group_hotel
  on public.visa_hotel_group_reservations (trip_hotel_id);

create table if not exists public.visa_hotel_confirmation_documents (
  id uuid primary key default gen_random_uuid(),
  visa_application_id uuid not null references public.visa_applications(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_participant_id uuid not null references public.booking_participants(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_hotel_id uuid not null references public.trip_hotels(id) on delete cascade,
  group_reservation_id uuid not null references public.visa_hotel_group_reservations(id) on delete cascade,
  visa_document_id uuid references public.visa_documents(id) on delete set null,
  document_reference text not null,
  file_name text not null,
  storage_path text not null,
  status text not null default 'generated',
  version integer not null default 1,
  is_current boolean not null default true,
  data_hash text,
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visa_hotel_doc_version_positive check (version > 0),
  constraint visa_hotel_doc_status_check check (status in ('generated', 'needs_regeneration', 'hotel_replaced', 'cancelled'))
);

drop index if exists visa_hotel_doc_reference_unique;

create unique index if not exists visa_hotel_doc_reference_version_unique
  on public.visa_hotel_confirmation_documents (document_reference, version);

create unique index if not exists visa_hotel_doc_current_unique
  on public.visa_hotel_confirmation_documents (visa_application_id, trip_hotel_id)
  where is_current = true and status <> 'cancelled';

create index if not exists idx_visa_hotel_doc_application
  on public.visa_hotel_confirmation_documents (visa_application_id, generated_at desc);

create index if not exists idx_visa_hotel_doc_booking_participant
  on public.visa_hotel_confirmation_documents (booking_id, booking_participant_id);

create index if not exists idx_visa_hotel_doc_group
  on public.visa_hotel_confirmation_documents (group_reservation_id);

create or replace function public.validate_visa_hotel_confirmation_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_booking_id uuid;
  v_group_trip_id uuid;
  v_group_hotel_id uuid;
begin
  select p.booking_id
  into v_participant_booking_id
  from public.booking_participants p
  where p.id = new.booking_participant_id;

  if v_participant_booking_id is null then
    raise exception 'visa_hotel_participant_not_found'
      using errcode = '23503';
  end if;

  if v_participant_booking_id is distinct from new.booking_id then
    raise exception 'visa_hotel_participant_booking_mismatch'
      using errcode = '23514';
  end if;

  select g.trip_id, g.trip_hotel_id
  into v_group_trip_id, v_group_hotel_id
  from public.visa_hotel_group_reservations g
  where g.id = new.group_reservation_id;

  if v_group_trip_id is null then
    raise exception 'visa_hotel_group_not_found'
      using errcode = '23503';
  end if;

  if v_group_trip_id is distinct from new.trip_id
     or v_group_hotel_id is distinct from new.trip_hotel_id then
    raise exception 'visa_hotel_group_stay_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_visa_hotel_confirmation_document
  on public.visa_hotel_confirmation_documents;

create trigger validate_visa_hotel_confirmation_document
before insert or update of booking_id, booking_participant_id, trip_id, trip_hotel_id, group_reservation_id
on public.visa_hotel_confirmation_documents
for each row execute function public.validate_visa_hotel_confirmation_document();

create or replace function public.mark_previous_visa_hotel_documents_not_current()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_current then
    update public.visa_hotel_confirmation_documents
    set is_current = false,
        updated_at = now()
    where visa_application_id = new.visa_application_id
      and trip_hotel_id = new.trip_hotel_id
      and id is distinct from new.id
      and is_current = true;
  end if;
  return new;
end;
$$;

drop trigger if exists mark_previous_visa_hotel_documents_not_current
  on public.visa_hotel_confirmation_documents;

create trigger mark_previous_visa_hotel_documents_not_current
before insert or update of is_current
on public.visa_hotel_confirmation_documents
for each row execute function public.mark_previous_visa_hotel_documents_not_current();

drop trigger if exists visa_hotel_group_reservations_updated_at
  on public.visa_hotel_group_reservations;

create trigger visa_hotel_group_reservations_updated_at
before update on public.visa_hotel_group_reservations
for each row execute function public.set_updated_at();

drop trigger if exists visa_hotel_confirmation_documents_updated_at
  on public.visa_hotel_confirmation_documents;

create trigger visa_hotel_confirmation_documents_updated_at
before update on public.visa_hotel_confirmation_documents
for each row execute function public.set_updated_at();

alter table public.visa_hotel_group_reservations enable row level security;
alter table public.visa_hotel_confirmation_documents enable row level security;

drop policy if exists "staff manage visa hotel group reservations"
  on public.visa_hotel_group_reservations;

create policy "staff manage visa hotel group reservations"
on public.visa_hotel_group_reservations
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage visa hotel confirmation documents"
  on public.visa_hotel_confirmation_documents;

create policy "staff manage visa hotel confirmation documents"
on public.visa_hotel_confirmation_documents
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

notify pgrst, 'reload schema';
