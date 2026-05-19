
-- ============================================================
-- 1. New role: marketing_manager
-- ============================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing_manager';

-- ============================================================
-- 2. Clients: marketing fields
-- ============================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS marketing_status text NOT NULL DEFAULT 'subscribed'
    CHECK (marketing_status IN ('subscribed','unsubscribed','bounced','complained')),
  ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_bounce_reason text,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS clients_unsubscribe_token_idx ON public.clients(unsubscribe_token);
CREATE INDEX IF NOT EXISTS clients_marketing_status_idx ON public.clients(marketing_status);
CREATE INDEX IF NOT EXISTS clients_language_idx ON public.clients(language);

-- ============================================================
-- 3. Segments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.marketing_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage marketing_segments" ON public.marketing_segments;
CREATE POLICY "staff manage marketing_segments"
  ON public.marketing_segments FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_marketing_segments_updated
  BEFORE UPDATE ON public.marketing_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. Email campaigns: marketing fields
-- ============================================================
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS cta_url text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES public.marketing_segments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unsubscribed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounced_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_address text;

-- ============================================================
-- 5. Email templates: marketing fields
-- ============================================================
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS cta_url text,
  ADD COLUMN IF NOT EXISTS hero_image_url text;

-- ============================================================
-- 6. Marketing settings: company info on email_settings
-- ============================================================
ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS company_name text NOT NULL DEFAULT 'lejapon.ma',
  ADD COLUMN IF NOT EXISTS company_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'smtp'
    CHECK (provider IN ('smtp','brevo','resend','mailgun','lovable'));

-- ============================================================
-- 7. Unified marketing contacts view (CRM + newsletter + visa)
-- ============================================================
CREATE OR REPLACE VIEW public.marketing_contacts_view AS
SELECT
  c.id                                            AS client_id,
  lower(c.email)                                  AS email,
  c.full_name                                     AS full_name,
  c.phone                                         AS phone,
  c.city                                          AS city,
  c.country                                       AS country,
  c.language                                      AS language,
  c.source                                        AS source,
  c.marketing_status                              AS marketing_status,
  c.unsubscribe_token                             AS unsubscribe_token,
  c.tags                                          AS tags,
  c.loyalty_tier                                  AS loyalty_tier,
  c.is_returning                                  AS is_returning,
  c.trips_completed                               AS trips_completed,
  c.last_trip_label                               AS last_trip_label,
  c.last_trip_at                                  AS last_trip_at,
  c.created_at                                    AS created_at
FROM public.clients c
WHERE c.email IS NOT NULL

UNION ALL

SELECT
  NULL::uuid                                      AS client_id,
  lower(n.email)                                  AS email,
  NULL::text                                      AS full_name,
  NULL::text                                      AS phone,
  NULL::text                                      AS city,
  'Maroc'::text                                   AS country,
  'fr'::text                                      AS language,
  COALESCE(n.source, 'newsletter')                AS source,
  CASE WHEN n.is_active THEN 'subscribed' ELSE 'unsubscribed' END AS marketing_status,
  NULL::uuid                                      AS unsubscribe_token,
  '{}'::text[]                                    AS tags,
  'none'::text                                    AS loyalty_tier,
  false                                           AS is_returning,
  0                                               AS trips_completed,
  NULL::text                                      AS last_trip_label,
  NULL::timestamptz                               AS last_trip_at,
  n.created_at                                    AS created_at
FROM public.newsletter_subscribers n
WHERE n.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.clients c2
    WHERE lower(c2.email) = lower(n.email)
  );

GRANT SELECT ON public.marketing_contacts_view TO authenticated;

-- ============================================================
-- 8. Function: resolve a segment to a list of recipients
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_marketing_segment(_segment_id uuid)
RETURNS TABLE(
  client_id uuid,
  email text,
  full_name text,
  language text,
  unsubscribe_token uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _filters jsonb;
BEGIN
  SELECT filters INTO _filters FROM public.marketing_segments WHERE id = _segment_id;
  IF _filters IS NULL THEN _filters := '{}'::jsonb; END IF;

  RETURN QUERY
  SELECT c.id, lower(c.email), c.full_name, c.language, c.unsubscribe_token
  FROM public.clients c
  WHERE c.email IS NOT NULL
    AND c.marketing_status = 'subscribed'
    AND (NOT (_filters ? 'language')   OR c.language = (_filters->>'language'))
    AND (NOT (_filters ? 'cities')     OR c.city = ANY (
          ARRAY(SELECT jsonb_array_elements_text(_filters->'cities'))))
    AND (NOT (_filters ? 'min_trips')  OR c.trips_completed >= (_filters->>'min_trips')::int)
    AND (NOT (_filters ? 'max_trips')  OR c.trips_completed <= (_filters->>'max_trips')::int)
    AND (NOT (_filters ? 'loyalty_tiers') OR c.loyalty_tier = ANY (
          ARRAY(SELECT jsonb_array_elements_text(_filters->'loyalty_tiers'))))
    AND (NOT (_filters ? 'sources')    OR c.source = ANY (
          ARRAY(SELECT jsonb_array_elements_text(_filters->'sources'))))
    AND (NOT (_filters ? 'tag')        OR (_filters->>'tag') = ANY(c.tags))
    AND (NOT (_filters ? 'returning_only') OR c.is_returning = true)
    AND (NOT (_filters ? 'has_unpaid_balance') OR EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.client_id = c.id
            AND b.paid_amount_mad < b.total_amount_mad
            AND b.status NOT IN ('cancelled')
        ))
    AND (NOT (_filters ? 'season') OR EXISTS (
          SELECT 1 FROM public.bookings b
          JOIN public.trips t ON t.id = b.trip_id
          WHERE b.client_id = c.id
            AND lower(coalesce(t.season,'')) LIKE '%' || lower(_filters->>'season') || '%'
        ))
    AND (NOT (_filters ? 'has_visa_request') OR EXISTS (
          SELECT 1 FROM public.visa_applications v
          WHERE v.user_id = c.id
        ));
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_marketing_segment(uuid) TO authenticated, anon;

-- ============================================================
-- 9. Function: unsubscribe by token (public, security definer)
-- ============================================================
CREATE OR REPLACE FUNCTION public.unsubscribe_marketing_by_token(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _email text; _name text;
BEGIN
  UPDATE public.clients
     SET marketing_status = 'unsubscribed',
         marketing_unsubscribed_at = now(),
         updated_at = now()
   WHERE unsubscribe_token = _token
   RETURNING email, full_name INTO _email, _name;

  IF _email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'email', _email, 'full_name', _name);
END $$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_marketing_by_token(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resubscribe_marketing_by_token(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _email text;
BEGIN
  UPDATE public.clients
     SET marketing_status = 'subscribed',
         marketing_unsubscribed_at = NULL,
         updated_at = now()
   WHERE unsubscribe_token = _token
   RETURNING email INTO _email;

  IF _email IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'email', _email);
END $$;

GRANT EXECUTE ON FUNCTION public.resubscribe_marketing_by_token(uuid) TO anon, authenticated;

-- ============================================================
-- 10. Helper: bulk recompute campaign stats from recipients
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_campaign_stats(_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_campaigns c
     SET total_recipients   = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id),
         sent_count         = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND status = 'sent'),
         failed_count       = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND status = 'failed'),
         open_count         = (SELECT coalesce(sum(open_count),0) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id),
         click_count        = (SELECT coalesce(sum(click_count),0) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id),
         unique_open_count  = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND first_opened_at IS NOT NULL),
         unique_click_count = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND first_clicked_at IS NOT NULL),
         unsubscribed_count = (SELECT count(*) FROM public.email_events WHERE campaign_id = _campaign_id AND event_type = 'unsubscribed'),
         bounced_count      = (SELECT count(*) FROM public.email_events WHERE campaign_id = _campaign_id AND event_type = 'bounced'),
         updated_at = now()
   WHERE c.id = _campaign_id;
END $$;

GRANT EXECUTE ON FUNCTION public.recompute_campaign_stats(uuid) TO authenticated;

-- ============================================================
-- 11. Backfill: ensure all clients have unsubscribe_token
-- ============================================================
UPDATE public.clients SET unsubscribe_token = gen_random_uuid() WHERE unsubscribe_token IS NULL;
