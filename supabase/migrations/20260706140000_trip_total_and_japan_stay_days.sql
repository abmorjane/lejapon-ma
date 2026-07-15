-- Add explicit trip duration fields:
-- - total_trip_days: full travel duration including outbound/return flights.
-- - japan_stay_days: actual number of days spent in Japan, used for visa forms.

alter table public.trips
  add column if not exists total_trip_days integer,
  add column if not exists japan_stay_days integer;

alter table public.trips
  drop constraint if exists trips_total_trip_days_positive;

alter table public.trips
  add constraint trips_total_trip_days_positive
  check (total_trip_days is null or total_trip_days > 0);

alter table public.trips
  drop constraint if exists trips_japan_stay_days_positive;

alter table public.trips
  add constraint trips_japan_stay_days_positive
  check (japan_stay_days is null or japan_stay_days > 0);

alter table public.trips
  drop constraint if exists trips_japan_stay_days_lte_total;

alter table public.trips
  add constraint trips_japan_stay_days_lte_total
  check (
    total_trip_days is null
    or japan_stay_days is null
    or japan_stay_days <= total_trip_days
  );

notify pgrst, 'reload schema';
