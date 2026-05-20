ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS passport_issue_date date,
  ADD COLUMN IF NOT EXISTS passport_file_path text;

ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS passport_file_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('passports', 'passports', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "admins read passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins read passports" ON storage.objects;
CREATE POLICY "admins read passports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "admins upload passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passports" ON storage.objects;
CREATE POLICY "admins upload passports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "admins delete passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passports" ON storage.objects;
CREATE POLICY "admins delete passports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);
