-- V1.0.1 agency settings public read
-- Legal/contact branding is intentionally public so the site header/footer can
-- reuse the same centrally managed values as generated documents.

DROP POLICY IF EXISTS "public read agency_settings" ON public.agency_settings;
CREATE POLICY "public read agency_settings"
ON public.agency_settings
FOR SELECT
USING (true);
