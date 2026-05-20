-- Add personal administrative fields used by the CRM, visa workflows and linked travelers.
-- Safe migration: only adds missing nullable columns and indexes.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS profession text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS profession text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS passport_file_path text;

CREATE INDEX IF NOT EXISTS idx_clients_profession ON public.clients (profession);
CREATE INDEX IF NOT EXISTS idx_clients_marital_status ON public.clients (marital_status);
CREATE INDEX IF NOT EXISTS idx_booking_participants_profession ON public.booking_participants (profession);
CREATE INDEX IF NOT EXISTS idx_booking_participants_marital_status ON public.booking_participants (marital_status);

-- Keep the participant-to-client helper compatible with the new optional fields.
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
