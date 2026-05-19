
-- 1. Add columns to booking_participants
ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS relation text;

CREATE INDEX IF NOT EXISTS idx_booking_participants_booking_id ON public.booking_participants(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_participants_client_id ON public.booking_participants(client_id);

-- 2. find_or_create_client function (anti-doublon)
CREATE OR REPLACE FUNCTION public.find_or_create_client_for_participant(
  _full_name text,
  _email text,
  _phone text,
  _passport_no text
)
RETURNS TABLE(client_id uuid, was_existing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _email_clean text := NULLIF(lower(trim(_email)), '');
  _phone_clean text := NULLIF(trim(_phone), '');
  _passport_clean text := NULLIF(trim(_passport_no), '');
BEGIN
  IF _email_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE lower(email) = _email_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _phone_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE phone = _phone_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _passport_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE passport_number = _passport_clean LIMIT 1;
  END IF;

  IF _id IS NOT NULL THEN
    UPDATE public.clients SET
      full_name = COALESCE(NULLIF(trim(_full_name), ''), full_name),
      email = COALESCE(_email_clean, email),
      phone = COALESCE(_phone_clean, phone),
      passport_number = COALESCE(_passport_clean, passport_number),
      updated_at = now()
    WHERE id = _id;
    RETURN QUERY SELECT _id, true;
    RETURN;
  END IF;

  INSERT INTO public.clients (full_name, email, phone, passport_number, country, source)
  VALUES (
    COALESCE(NULLIF(trim(_full_name), ''), _email_clean, 'Voyageur'),
    _email_clean,
    _phone_clean,
    _passport_clean,
    'Maroc',
    'booking_participant'
  )
  RETURNING id INTO _id;

  RETURN QUERY SELECT _id, false;
END
$$;

-- 3. Trigger : create lead participant on new booking
CREATE OR REPLACE FUNCTION public.bookings_create_lead_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _first text;
  _last text;
  _parts text[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_participants WHERE booking_id = NEW.id AND is_lead = true) THEN
    RETURN NEW;
  END IF;

  _parts := regexp_split_to_array(coalesce(trim(NEW.contact_name),''), '\s+');
  _first := COALESCE(_parts[1], '');
  IF array_length(_parts, 1) > 1 THEN
    _last := array_to_string(_parts[2:array_length(_parts,1)], ' ');
  ELSE
    _last := '';
  END IF;

  INSERT INTO public.booking_participants
    (booking_id, trip_id, first_name, last_name, email, phone, is_lead, client_id, relation)
  VALUES
    (NEW.id, NEW.trip_id, _first, _last, NEW.contact_email, NEW.contact_phone, true, NEW.client_id, 'self');

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bookings_create_lead_participant ON public.bookings;
CREATE TRIGGER trg_bookings_create_lead_participant
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.bookings_create_lead_participant();

-- 4. Backfill existing bookings without lead participant
INSERT INTO public.booking_participants
  (booking_id, trip_id, first_name, last_name, email, phone, is_lead, client_id, relation)
SELECT
  b.id,
  b.trip_id,
  COALESCE(split_part(trim(b.contact_name), ' ', 1), ''),
  CASE
    WHEN position(' ' in trim(b.contact_name)) > 0
    THEN trim(substring(trim(b.contact_name) from position(' ' in trim(b.contact_name)) + 1))
    ELSE ''
  END,
  b.contact_email,
  b.contact_phone,
  true,
  b.client_id,
  'self'
FROM public.bookings b
WHERE NOT EXISTS (
  SELECT 1 FROM public.booking_participants p
  WHERE p.booking_id = b.id AND p.is_lead = true
);
