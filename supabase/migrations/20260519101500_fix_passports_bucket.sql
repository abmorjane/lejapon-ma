INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'passports',
  'passports',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[];

DROP POLICY IF EXISTS "admins read passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins read passports" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passports" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passports" ON storage.objects;

CREATE POLICY "admins read passports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "admins upload passports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "admins delete passports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);
