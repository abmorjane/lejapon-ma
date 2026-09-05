-- Grouped Japan visa submission batches.
-- Official lists contain only the selected visa applications for a given
-- embassy submission. Internal full-trip lists are generated separately.

create table if not exists public.visa_group_submission_batches (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete restrict,
  reference text not null,
  submission_date date not null,
  actual_submission_date date,
  status text not null default 'draft',
  file_path text,
  file_name text,
  version integer not null default 1,
  generated_at timestamptz,
  submitted_at timestamptz,
  prepared_by uuid references auth.users(id) on delete set null,
  generated_by uuid references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visa_group_submission_reference_unique unique (reference),
  constraint visa_group_submission_status_check
    check (status in ('draft', 'generated', 'submitted', 'needs_completion', 'cancelled')),
  constraint visa_group_submission_version_positive check (version > 0)
);

create table if not exists public.visa_group_submission_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.visa_group_submission_batches(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete restrict,
  visa_application_id uuid not null references public.visa_applications(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  booking_participant_id uuid references public.booking_participants(id) on delete set null,
  official_name text not null,
  passport_no text not null,
  visa_status text,
  warnings jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visa_group_submission_item_unique unique (batch_id, visa_application_id)
);

create index if not exists idx_visa_group_submission_batches_trip
  on public.visa_group_submission_batches(trip_id, submission_date desc);

create index if not exists idx_visa_group_submission_batches_status
  on public.visa_group_submission_batches(status, submission_date desc);

create index if not exists idx_visa_group_submission_items_batch
  on public.visa_group_submission_items(batch_id, sort_order);

create index if not exists idx_visa_group_submission_items_application
  on public.visa_group_submission_items(visa_application_id);

create index if not exists idx_visa_group_submission_items_participant
  on public.visa_group_submission_items(booking_participant_id);

create or replace function public.validate_visa_group_submission_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_trip_id uuid;
  v_app_booking_id uuid;
  v_app_participant_id uuid;
  v_booking_trip_id uuid;
  v_participant_booking_id uuid;
begin
  select b.trip_id
  into v_batch_trip_id
  from public.visa_group_submission_batches b
  where b.id = new.batch_id;

  if v_batch_trip_id is null then
    raise exception 'visa_group_submission_batch_not_found'
      using errcode = '23503';
  end if;

  select a.booking_id, a.booking_participant_id
  into v_app_booking_id, v_app_participant_id
  from public.visa_applications a
  where a.id = new.visa_application_id;

  if v_app_booking_id is null then
    raise exception 'visa_group_submission_application_not_linked_to_booking'
      using errcode = '23514';
  end if;

  if v_app_participant_id is null then
    raise exception 'visa_group_submission_application_not_linked_to_participant'
      using errcode = '23514';
  end if;

  select b.trip_id
  into v_booking_trip_id
  from public.bookings b
  where b.id = coalesce(new.booking_id, v_app_booking_id);

  if v_booking_trip_id is null then
    raise exception 'visa_group_submission_booking_not_found'
      using errcode = '23503';
  end if;

  if v_booking_trip_id is distinct from v_batch_trip_id then
    raise exception 'visa_group_submission_trip_mismatch'
      using errcode = '23514';
  end if;

  if new.trip_id is distinct from v_batch_trip_id then
    raise exception 'visa_group_submission_item_trip_mismatch'
      using errcode = '23514';
  end if;

  if new.booking_participant_id is not null
     and new.booking_participant_id is distinct from v_app_participant_id then
    raise exception 'visa_group_submission_participant_mismatch'
      using errcode = '23514';
  end if;

  select p.booking_id
  into v_participant_booking_id
  from public.booking_participants p
  where p.id = v_app_participant_id;

  if v_participant_booking_id is distinct from v_app_booking_id then
    raise exception 'visa_group_submission_participant_booking_mismatch'
      using errcode = '23514';
  end if;

  new.booking_participant_id := v_app_participant_id;
  new.booking_id := v_app_booking_id;
  return new;
end;
$$;

create or replace function public.prevent_submitted_visa_group_submission_item_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_batch_id uuid;
begin
  if tg_op = 'DELETE' then
    v_batch_id := old.batch_id;
  else
    v_batch_id := new.batch_id;
  end if;

  select b.status
  into v_status
  from public.visa_group_submission_batches b
  where b.id = v_batch_id;

  if v_status in ('submitted', 'cancelled') then
    raise exception 'visa_group_submission_batch_locked'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_visa_group_submission_item
  on public.visa_group_submission_items;

create trigger validate_visa_group_submission_item
before insert or update of batch_id, trip_id, visa_application_id, booking_id, booking_participant_id
on public.visa_group_submission_items
for each row
execute function public.validate_visa_group_submission_item();

drop trigger if exists prevent_submitted_visa_group_submission_item_changes
  on public.visa_group_submission_items;

create trigger prevent_submitted_visa_group_submission_item_changes
before insert or update or delete
on public.visa_group_submission_items
for each row
execute function public.prevent_submitted_visa_group_submission_item_changes();

drop trigger if exists visa_group_submission_batches_updated_at
  on public.visa_group_submission_batches;

create trigger visa_group_submission_batches_updated_at
before update on public.visa_group_submission_batches
for each row execute function public.set_updated_at();

drop trigger if exists visa_group_submission_items_updated_at
  on public.visa_group_submission_items;

create trigger visa_group_submission_items_updated_at
before update on public.visa_group_submission_items
for each row execute function public.set_updated_at();

alter table public.visa_group_submission_batches enable row level security;
alter table public.visa_group_submission_items enable row level security;

drop policy if exists "staff manage visa group submission batches"
  on public.visa_group_submission_batches;

create policy "staff manage visa group submission batches"
on public.visa_group_submission_batches
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage visa group submission items"
  on public.visa_group_submission_items;

create policy "staff manage visa group submission items"
on public.visa_group_submission_items
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff upload visa group submission PDFs"
  on storage.objects;

create policy "staff upload visa group submission PDFs"
on storage.objects
for insert
with check (
  bucket_id = 'visa-docs'
  and (storage.foldername(name))[1] = 'visa-group-submissions'
  and public.v2_is_staff(auth.uid())
);

drop policy if exists "staff update visa group submission PDFs"
  on storage.objects;

create policy "staff update visa group submission PDFs"
on storage.objects
for update
using (
  bucket_id = 'visa-docs'
  and (storage.foldername(name))[1] = 'visa-group-submissions'
  and public.v2_is_staff(auth.uid())
)
with check (
  bucket_id = 'visa-docs'
  and (storage.foldername(name))[1] = 'visa-group-submissions'
  and public.v2_is_staff(auth.uid())
);

notify pgrst, 'reload schema';
