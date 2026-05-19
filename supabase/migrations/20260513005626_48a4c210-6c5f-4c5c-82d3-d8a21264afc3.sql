
-- 1) RPC upsert client (anti-doublon par email puis téléphone)
CREATE OR REPLACE FUNCTION public.upsert_client_from_booking(
  _name text, _email text, _phone text, _city text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid; _email_clean text; _phone_clean text;
BEGIN
  _email_clean := NULLIF(lower(trim(_email)), '');
  _phone_clean := NULLIF(trim(_phone), '');

  IF _email_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE lower(email) = _email_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _phone_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE phone = _phone_clean LIMIT 1;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.clients (full_name, email, phone, city, country, source)
    VALUES (COALESCE(NULLIF(trim(_name), ''), _email_clean, 'Client'),
            _email_clean, _phone_clean, NULLIF(trim(_city), ''), 'Maroc', 'booking_form')
    RETURNING id INTO _id;
  ELSE
    UPDATE public.clients SET
      full_name = COALESCE(NULLIF(trim(_name), ''), full_name),
      email     = COALESCE(_email_clean, email),
      phone     = COALESCE(_phone_clean, phone),
      city      = COALESCE(NULLIF(trim(_city), ''), city),
      updated_at = now()
    WHERE id = _id;
  END IF;

  RETURN _id;
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_client_from_booking(text,text,text,text) TO anon, authenticated;

-- 2) Trigger AFTER pour synchroniser stats client à chaque insert/update de booking
CREATE OR REPLACE FUNCTION public.bookings_sync_client_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _title text; _season text; _start date; _label text; _trip_id uuid;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Last trip = booking le plus récent du client
  SELECT b.trip_id INTO _trip_id
  FROM public.bookings b
  WHERE b.client_id = NEW.client_id
  ORDER BY b.created_at DESC LIMIT 1;

  IF _trip_id IS NOT NULL THEN
    SELECT title, season, start_date INTO _title, _season, _start
    FROM public.trips WHERE id = _trip_id;
    _label := COALESCE(NULLIF(_season, ''), _title);
    IF _start IS NOT NULL THEN
      _label := _label || ' — ' || to_char(_start, 'DD/MM/YYYY');
    END IF;
  END IF;

  UPDATE public.clients SET
    last_trip_id    = _trip_id,
    last_trip_label = _label,
    last_trip_at    = now(),
    trips_completed = (SELECT count(*) FROM public.bookings WHERE client_id = NEW.client_id),
    is_returning    = ((SELECT count(*) FROM public.bookings WHERE client_id = NEW.client_id) >= 2),
    updated_at      = now()
  WHERE id = NEW.client_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_sync_client_stats_trg ON public.bookings;
CREATE TRIGGER bookings_sync_client_stats_trg
AFTER INSERT OR UPDATE OF client_id, trip_id, total_amount_mad, paid_amount_mad, status
ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_sync_client_stats();

-- 3) Backfill: créer fiches client manquantes à partir des bookings existants
INSERT INTO public.clients (full_name, email, phone, city, country, source, created_at)
SELECT DISTINCT ON (lower(b.contact_email))
  COALESCE(NULLIF(trim(b.contact_name), ''), b.contact_email),
  lower(trim(b.contact_email)),
  NULLIF(trim(b.contact_phone), ''),
  NULLIF(trim(b.contact_city), ''),
  'Maroc',
  'backfill_booking',
  b.created_at
FROM public.bookings b
WHERE b.contact_email IS NOT NULL
  AND length(trim(b.contact_email)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE lower(c.email) = lower(trim(b.contact_email))
  )
ORDER BY lower(b.contact_email), b.created_at ASC;

-- 4) Lier les bookings orphelins à leur client (par email)
UPDATE public.bookings b
SET client_id = c.id
FROM public.clients c
WHERE b.client_id IS NULL
  AND b.contact_email IS NOT NULL
  AND lower(c.email) = lower(trim(b.contact_email));

-- 5) Recalcul stats pour tous les clients (one-shot)
UPDATE public.clients c SET
  trips_completed = sub.cnt,
  is_returning    = (sub.cnt >= 2),
  last_trip_id    = sub.last_trip_id,
  last_trip_label = sub.last_label,
  last_trip_at    = sub.last_at,
  updated_at      = now()
FROM (
  SELECT
    b.client_id,
    count(*) AS cnt,
    (array_agg(b.trip_id ORDER BY b.created_at DESC))[1] AS last_trip_id,
    max(b.created_at) AS last_at,
    (
      SELECT COALESCE(NULLIF(t.season, ''), t.title)
             || COALESCE(' — ' || to_char(t.start_date, 'DD/MM/YYYY'), '')
      FROM public.bookings b2
      LEFT JOIN public.trips t ON t.id = b2.trip_id
      WHERE b2.client_id = b.client_id
      ORDER BY b2.created_at DESC LIMIT 1
    ) AS last_label
  FROM public.bookings b
  WHERE b.client_id IS NOT NULL
  GROUP BY b.client_id
) sub
WHERE c.id = sub.client_id;
