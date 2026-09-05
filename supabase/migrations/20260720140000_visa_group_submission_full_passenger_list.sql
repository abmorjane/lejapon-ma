-- Store complete passenger snapshots for Japan visa group submissions.
-- A row may represent a trip participant even when no digital visa application exists yet.

alter table public.visa_group_submission_items
  alter column visa_application_id drop not null;

alter table public.visa_group_submission_items
  add column if not exists is_selected_for_submission boolean not null default true,
  add column if not exists submission_status text not null default 'submitted_today';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'visa_group_submission_items_submission_status_check'
      and conrelid = 'public.visa_group_submission_items'::regclass
  ) then
    alter table public.visa_group_submission_items
      add constraint visa_group_submission_items_submission_status_check
      check (
        submission_status in (
          'submitted_today',
          'to_be_submitted_later',
          'already_submitted',
          'visa_issued',
          'visa_not_required',
          'not_started',
          'incomplete',
          'not_included'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from public.visa_group_submission_items
    where booking_participant_id is not null
    group by batch_id, booking_participant_id
    having count(*) > 1
  ) then
    execute '
      create unique index if not exists visa_group_submission_items_batch_participant_unique
      on public.visa_group_submission_items(batch_id, booking_participant_id)
      where booking_participant_id is not null
    ';
  else
    raise notice 'visa_group_submission_items contains historical duplicate participants; unique index skipped, trigger still blocks new duplicates.';
  end if;
end $$;

create index if not exists idx_visa_group_submission_items_selected
  on public.visa_group_submission_items(batch_id, is_selected_for_submission);

drop trigger if exists validate_visa_group_submission_item
  on public.visa_group_submission_items;

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

  if new.booking_participant_id is null then
    raise exception 'visa_group_submission_participant_required'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.visa_group_submission_items i
    where i.batch_id = new.batch_id
      and i.booking_participant_id = new.booking_participant_id
      and i.id is distinct from new.id
  ) then
    raise exception 'visa_group_submission_duplicate_participant'
      using errcode = '23505';
  end if;

  select p.booking_id
  into v_participant_booking_id
  from public.booking_participants p
  where p.id = new.booking_participant_id;

  if v_participant_booking_id is null then
    raise exception 'visa_group_submission_participant_not_found'
      using errcode = '23503';
  end if;

  if new.booking_id is not null and new.booking_id is distinct from v_participant_booking_id then
    raise exception 'visa_group_submission_participant_booking_mismatch'
      using errcode = '23514';
  end if;

  new.booking_id := v_participant_booking_id;

  select b.trip_id
  into v_booking_trip_id
  from public.bookings b
  where b.id = new.booking_id;

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

  if new.visa_application_id is not null then
    select a.booking_id, a.booking_participant_id
    into v_app_booking_id, v_app_participant_id
    from public.visa_applications a
    where a.id = new.visa_application_id;

    if not found then
      raise exception 'visa_group_submission_application_not_found'
        using errcode = '23503';
    end if;

    if v_app_booking_id is not null and v_app_booking_id is distinct from new.booking_id then
      raise exception 'visa_group_submission_application_booking_mismatch'
        using errcode = '23514';
    end if;

    if v_app_participant_id is not null and v_app_participant_id is distinct from new.booking_participant_id then
      raise exception 'visa_group_submission_application_participant_mismatch'
        using errcode = '23514';
    end if;
  end if;

  new.trip_id := v_batch_trip_id;
  return new;
end;
$$;

create trigger validate_visa_group_submission_item
before insert or update of batch_id, trip_id, visa_application_id, booking_id, booking_participant_id
on public.visa_group_submission_items
for each row
execute function public.validate_visa_group_submission_item();

comment on column public.visa_group_submission_items.is_selected_for_submission is
  'True when this passenger was included in the present embassy submission.';

comment on column public.visa_group_submission_items.submission_status is
  'Passenger status printed on the full official passenger list.';

notify pgrst, 'reload schema';
