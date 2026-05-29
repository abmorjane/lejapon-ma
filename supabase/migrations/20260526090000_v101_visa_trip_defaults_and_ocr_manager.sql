-- V1.0.1 stabilization: allow Sales Manager (app_role = manager) to use passport OCR
-- and add optional trip-level visa defaults. Additive only; no business statuses changed.

DROP POLICY IF EXISTS "admins read passports" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passports" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passports" ON storage.objects;
DROP POLICY IF EXISTS "admins and sales managers read passports" ON storage.objects;
DROP POLICY IF EXISTS "admins and sales managers upload passports" ON storage.objects;
DROP POLICY IF EXISTS "admins and sales managers delete passports" ON storage.objects;

CREATE POLICY "admins and sales managers read passports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'passports'
  AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin','manager']::public.app_role[])
);

CREATE POLICY "admins and sales managers upload passports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'passports'
  AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin','manager']::public.app_role[])
);

CREATE POLICY "admins and sales managers delete passports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'passports'
  AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin','manager']::public.app_role[])
);

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS visa_japan_arrival_date date,
  ADD COLUMN IF NOT EXISTS visa_japan_departure_date date,
  ADD COLUMN IF NOT EXISTS visa_arrival_port text,
  ADD COLUMN IF NOT EXISTS visa_arrival_flight_number text,
  ADD COLUMN IF NOT EXISTS visa_hotel_name text,
  ADD COLUMN IF NOT EXISTS visa_hotel_address text,
  ADD COLUMN IF NOT EXISTS visa_hotel_phone text,
  ADD COLUMN IF NOT EXISTS programme_id uuid REFERENCES public.programmes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trips_programme_id ON public.trips(programme_id);

CREATE OR REPLACE FUNCTION public.apply_visa_trip_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trip_row public.trips%ROWTYPE;
BEGIN
  IF NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.*
    INTO trip_row
  FROM public.bookings b
  JOIN public.trips t ON t.id = b.trip_id
  WHERE b.id = NEW.booking_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.date_of_arrival := COALESCE(NEW.date_of_arrival, trip_row.visa_japan_arrival_date);
  NEW.port_of_entry := COALESCE(NULLIF(NEW.port_of_entry, ''), trip_row.visa_arrival_port);
  NEW.airline_or_ship := COALESCE(NULLIF(NEW.airline_or_ship, ''), trip_row.visa_arrival_flight_number);
  NEW.hotel_name := COALESCE(NULLIF(NEW.hotel_name, ''), trip_row.visa_hotel_name);
  NEW.hotel_address := COALESCE(NULLIF(NEW.hotel_address, ''), trip_row.visa_hotel_address);
  NEW.hotel_tel := COALESCE(NULLIF(NEW.hotel_tel, ''), trip_row.visa_hotel_phone);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_visa_trip_defaults ON public.visa_applications;
CREATE TRIGGER trg_apply_visa_trip_defaults
BEFORE INSERT OR UPDATE OF booking_id ON public.visa_applications
FOR EACH ROW
EXECUTE FUNCTION public.apply_visa_trip_defaults();
