ALTER TABLE public.visa_applications
ADD COLUMN IF NOT EXISTS requested_documents text,
ADD COLUMN IF NOT EXISTS documents_requested_at timestamptz;