
-- Enums
CREATE TYPE public.visa_status AS ENUM ('draft','submitted','in_review','approved','rejected','completed');
CREATE TYPE public.visa_document_type AS ENUM ('passport','photo','employment','flight','hotel','other');

-- Settings (singleton)
CREATE TABLE public.visa_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guarantor_name text NOT NULL DEFAULT 'TAPIS VOLANT LLC',
  guarantor_tel text NOT NULL DEFAULT '080-9980-3986',
  guarantor_address text NOT NULL DEFAULT '37-4 Saiinshuneicho, Ukyo-ku, Kyoto city 615-0005',
  guarantor_dob text,
  guarantor_sex text,
  guarantor_relationship text DEFAULT 'Travel agency / Tour operator',
  guarantor_profession text DEFAULT 'Travel agency',
  guarantor_nationality text DEFAULT 'Japanese',
  inviter_same_as_guarantor boolean NOT NULL DEFAULT true,
  inviter_name text,
  inviter_tel text,
  inviter_address text,
  inviter_dob text,
  inviter_sex text,
  inviter_relationship text,
  inviter_profession text,
  inviter_nationality text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visa_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated read visa_settings"
  ON public.visa_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "super_admin manage visa_settings"
  ON public.visa_settings FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER trg_visa_settings_updated
  BEFORE UPDATE ON public.visa_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.visa_settings (id) VALUES (gen_random_uuid());

-- Applications
CREATE TABLE public.visa_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  booking_id uuid,
  status public.visa_status NOT NULL DEFAULT 'draft',
  reference text NOT NULL DEFAULT ('VISA-' || upper(substring(gen_random_uuid()::text from 1 for 6))),

  -- Identity
  surname text,
  given_names text,
  other_names text,
  date_of_birth date,
  place_of_birth_city text,
  place_of_birth_state text,
  place_of_birth_country text,
  sex text,
  marital_status text,
  nationality text,
  former_nationality text,
  national_id_no text,

  -- Passport
  passport_type text DEFAULT 'ordinary',
  passport_no text,
  passport_place_of_issue text,
  passport_date_of_issue date,
  passport_issuing_authority text,
  passport_date_of_expiry date,
  certificate_of_eligibility_no text,

  -- Travel
  purpose_of_visit text,
  intended_length_of_stay text,
  date_of_arrival date,
  port_of_entry text,
  airline_or_ship text,

  -- Stay
  hotel_name text,
  hotel_tel text,
  hotel_address text,
  previous_stays text,

  -- Residence
  residential_address text,
  residential_tel text,
  residential_mobile text,
  residential_email text,

  -- Profession
  profession text,
  employer_name text,
  employer_tel text,
  employer_address text,
  partner_profession text,

  -- Declarations (questions)
  q_convicted_crime boolean NOT NULL DEFAULT false,
  q_imprisoned_1y boolean NOT NULL DEFAULT false,
  q_deported boolean NOT NULL DEFAULT false,
  q_drug_offence boolean NOT NULL DEFAULT false,
  q_prostitution boolean NOT NULL DEFAULT false,
  q_trafficking boolean NOT NULL DEFAULT false,
  declarations_details text,
  remarks text,

  consent_truthful boolean NOT NULL DEFAULT false,
  consent_data boolean NOT NULL DEFAULT false,
  date_of_application date,

  admin_notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visa_applications_user ON public.visa_applications(user_id);
CREATE INDEX idx_visa_applications_status ON public.visa_applications(status);

ALTER TABLE public.visa_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own visa_applications"
  ON public.visa_applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users read own visa_applications"
  ON public.visa_applications FOR SELECT
  USING (auth.uid() = user_id OR is_staff(auth.uid()));

CREATE POLICY "users update own draft visa_applications"
  ON public.visa_applications FOR UPDATE
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own draft visa_applications"
  ON public.visa_applications FOR DELETE
  USING (auth.uid() = user_id AND status = 'draft');

CREATE POLICY "staff manage visa_applications"
  ON public.visa_applications FOR ALL
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER trg_visa_applications_updated
  BEFORE UPDATE ON public.visa_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Documents
CREATE TABLE public.visa_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.visa_applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  doc_type public.visa_document_type NOT NULL DEFAULT 'passport',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visa_documents_application ON public.visa_documents(application_id);

ALTER TABLE public.visa_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own visa_documents"
  ON public.visa_documents FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.visa_applications a WHERE a.id = application_id AND a.user_id = auth.uid())
  );

CREATE POLICY "users read own visa_documents"
  ON public.visa_documents FOR SELECT
  USING (auth.uid() = user_id OR is_staff(auth.uid()));

CREATE POLICY "users delete own draft visa_documents"
  ON public.visa_documents FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.visa_applications a WHERE a.id = application_id AND a.user_id = auth.uid() AND a.status = 'draft')
  );

CREATE POLICY "staff manage visa_documents"
  ON public.visa_documents FOR ALL
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('visa-docs', 'visa-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies — users access only their own folder (named after their auth uid)
CREATE POLICY "users upload own visa-docs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'visa-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "users read own visa-docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'visa-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid()))
  );

CREATE POLICY "users delete own visa-docs"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'visa-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid()))
  );
