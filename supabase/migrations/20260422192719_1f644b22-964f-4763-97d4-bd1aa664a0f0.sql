ALTER TABLE public.visa_applications
ADD COLUMN IF NOT EXISTS consent_disclaimer boolean NOT NULL DEFAULT false;