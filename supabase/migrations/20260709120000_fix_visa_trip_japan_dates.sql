-- Fix visa trip defaults:
-- Visa dates must represent the actual stay in Japan, not the full international
-- travel dates. Preserve existing manually-entered application values.

create or replace function public.apply_visa_trip_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  trip_row public.trips%rowtype;
  japan_arrival_date date;
  japan_departure_date date;
begin
  if new.booking_id is null then
    return new;
  end if;

  select t.*
    into trip_row
  from public.bookings b
  join public.trips t on t.id = b.trip_id
  where b.id = new.booking_id
  limit 1;

  if not found then
    return new;
  end if;

  japan_arrival_date := coalesce(
    case when trip_row.start_date is not null then trip_row.start_date + 1 else null end,
    trip_row.visa_japan_arrival_date
  );

  japan_departure_date := coalesce(
    case when trip_row.end_date is not null then trip_row.end_date - 1 else null end,
    trip_row.visa_japan_departure_date
  );

  new.date_of_arrival := coalesce(new.date_of_arrival, japan_arrival_date);
  new.intended_length_of_stay := coalesce(
    nullif(new.intended_length_of_stay, ''),
    case
      when trip_row.japan_stay_days is not null and trip_row.japan_stay_days > 0
        then trip_row.japan_stay_days::text || ' jours'
      when japan_arrival_date is not null and japan_departure_date is not null and japan_departure_date >= japan_arrival_date
        then ((japan_departure_date - japan_arrival_date + 1)::text || ' jours')
      else null
    end
  );
  new.port_of_entry := coalesce(nullif(new.port_of_entry, ''), trip_row.visa_arrival_port);
  new.airline_or_ship := coalesce(nullif(new.airline_or_ship, ''), trip_row.visa_arrival_flight_number);
  new.hotel_name := coalesce(nullif(new.hotel_name, ''), trip_row.visa_hotel_name);
  new.hotel_address := coalesce(nullif(new.hotel_address, ''), trip_row.visa_hotel_address);
  new.hotel_tel := coalesce(nullif(new.hotel_tel, ''), trip_row.visa_hotel_phone);

  return new;
end;
$$;

drop trigger if exists trg_apply_visa_trip_defaults on public.visa_applications;

create trigger trg_apply_visa_trip_defaults
before insert or update of booking_id on public.visa_applications
for each row
execute function public.apply_visa_trip_defaults();

notify pgrst, 'reload schema';
