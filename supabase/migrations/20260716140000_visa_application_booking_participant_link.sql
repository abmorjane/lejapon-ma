-- Explicitly link each visa application to the exact booking participant.
-- This keeps the visa dossier connected to the booking, flight tickets and
-- participant-scoped operational documents without relying on email/name guesses.

alter table public.visa_applications
  add column if not exists booking_participant_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'visa_applications_booking_id_fkey'
      and conrelid = 'public.visa_applications'::regclass
  ) then
    alter table public.visa_applications
      add constraint visa_applications_booking_id_fkey
      foreign key (booking_id)
      references public.bookings(id)
      on delete set null
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'visa_applications_booking_participant_id_fkey'
      and conrelid = 'public.visa_applications'::regclass
  ) then
    alter table public.visa_applications
      add constraint visa_applications_booking_participant_id_fkey
      foreign key (booking_participant_id)
      references public.booking_participants(id)
      on delete set null
      not valid;
  end if;
end $$;

create index if not exists idx_visa_applications_booking_id
  on public.visa_applications(booking_id);

create index if not exists idx_visa_applications_booking_participant_id
  on public.visa_applications(booking_participant_id);

create or replace function public.validate_visa_application_booking_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_booking_id uuid;
begin
  if new.booking_participant_id is null then
    return new;
  end if;

  select p.booking_id
  into v_participant_booking_id
  from public.booking_participants p
  where p.id = new.booking_participant_id;

  if v_participant_booking_id is null then
    raise exception 'visa_booking_participant_not_found'
      using errcode = '23503';
  end if;

  if new.booking_id is null then
    new.booking_id := v_participant_booking_id;
  elsif new.booking_id is distinct from v_participant_booking_id then
    raise exception 'visa_booking_participant_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_visa_application_booking_participant
  on public.visa_applications;

create trigger validate_visa_application_booking_participant
before insert or update of booking_id, booking_participant_id
on public.visa_applications
for each row
execute function public.validate_visa_application_booking_participant();

notify pgrst, 'reload schema';
