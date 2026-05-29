ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS outbound_flight_text text,
  ADD COLUMN IF NOT EXISTS return_flight_text text;

ALTER TABLE public.trip_hotels
  ADD COLUMN IF NOT EXISTS check_in date,
  ADD COLUMN IF NOT EXISTS check_out date,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_trip_hotels_trip_dates
  ON public.trip_hotels (trip_id, check_in, check_out);
