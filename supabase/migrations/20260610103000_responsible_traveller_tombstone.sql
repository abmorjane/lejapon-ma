alter table public.bookings
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public.bookings_create_lead_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _first text;
  _last text;
  _parts text[];
  _contact_name text;
  _contact_email text;
  _contact_phone text;
begin
  if coalesce(NEW.metadata->>'responsible_traveller_deleted', 'false') = 'true' then
    return NEW;
  end if;

  if exists (
    select 1
    from public.booking_participants
    where booking_id = NEW.id
      and is_lead = true
  ) then
    return NEW;
  end if;

  _contact_name := lower(regexp_replace(coalesce(trim(NEW.contact_name), ''), '\s+', ' ', 'g'));
  _contact_email := lower(coalesce(trim(NEW.contact_email), ''));
  _contact_phone := regexp_replace(coalesce(NEW.contact_phone, ''), '[^0-9+]', '', 'g');

  if exists (
    select 1
    from public.booking_participants p
    where p.booking_id = NEW.id
      and (
        (NEW.client_id is not null and p.client_id = NEW.client_id)
        or (_contact_email <> '' and lower(coalesce(trim(p.email), '')) = _contact_email)
        or (_contact_phone <> '' and regexp_replace(coalesce(p.phone, ''), '[^0-9+]', '', 'g') = _contact_phone)
        or (
          _contact_name <> ''
          and lower(regexp_replace(coalesce(trim(p.first_name || ' ' || p.last_name), ''), '\s+', ' ', 'g')) = _contact_name
        )
      )
  ) then
    return NEW;
  end if;

  _parts := regexp_split_to_array(coalesce(trim(NEW.contact_name),''), '\s+');
  _first := coalesce(_parts[1], '');
  if array_length(_parts, 1) > 1 then
    _last := array_to_string(_parts[2:array_length(_parts,1)], ' ');
  else
    _last := '';
  end if;

  insert into public.booking_participants
    (booking_id, trip_id, first_name, last_name, email, phone, is_lead, client_id, relation, notes)
  values
    (NEW.id, NEW.trip_id, _first, _last, NEW.contact_email, NEW.contact_phone, true, NEW.client_id, 'self', 'auto_responsible_fallback');

  return NEW;
end
$$;

notify pgrst, 'reload schema';
