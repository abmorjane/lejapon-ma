
-- Document checklist by category
CREATE TABLE IF NOT EXISTS public.visa_document_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.visa_document_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read active checklists"
  ON public.visa_document_checklists FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_active OR is_staff(auth.uid())));

CREATE POLICY "staff manage checklists"
  ON public.visa_document_checklists FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]));

CREATE TRIGGER trg_visa_checklists_updated_at
  BEFORE UPDATE ON public.visa_document_checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Link applications to a checklist category
ALTER TABLE public.visa_applications
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'tourism';

-- Seed default categories
INSERT INTO public.visa_document_checklists (category, label, description, items, sort_order) VALUES
  ('tourism', 'Visa Touristique', 'Documents requis pour un séjour touristique au Japon',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm récente fond blanc","Justificatif d''emploi (attestation de travail)","Relevés bancaires des 3 derniers mois","Réservation d''hôtel pour toute la durée du séjour","Réservation de vol aller-retour","Programme de voyage détaillé","Attestation d''assurance voyage"]'::jsonb, 1),
  ('business', 'Visa Affaires', 'Documents requis pour un voyage professionnel',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm récente fond blanc","Lettre d''invitation de l''entreprise au Japon","Lettre de mission de votre employeur","Attestation de travail","Réservation d''hôtel et de vol","Programme professionnel détaillé"]'::jsonb, 2),
  ('family_visit', 'Visite Familiale / Amis', 'Documents requis pour visiter un proche au Japon',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm fond blanc","Lettre d''invitation du garant au Japon","Copie passeport / titre de séjour du garant","Justificatif de lien (acte, photos, échanges)","Justificatifs financiers (vous ou garant)","Réservation de vol aller-retour"]'::jsonb, 3),
  ('student', 'Visa Étudiant / Court terme', 'Documents pour un séjour d''études court',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm fond blanc","Lettre d''admission de l''établissement","Justificatifs financiers","Programme d''études","Réservation hôtel / logement"]'::jsonb, 4)
ON CONFLICT (category) DO NOTHING;
