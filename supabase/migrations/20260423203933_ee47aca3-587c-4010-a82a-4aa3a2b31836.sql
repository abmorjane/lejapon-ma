-- Programmes table
CREATE TABLE public.programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  duration text NOT NULL DEFAULT '',
  cities text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  days jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_url text,
  pdf_path text,
  is_published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.programmes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read published programmes"
  ON public.programmes FOR SELECT
  USING (is_published = true OR public.is_staff(auth.uid()));

CREATE POLICY "staff manage programmes"
  ON public.programmes FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER programmes_set_updated_at
  BEFORE UPDATE ON public.programmes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket for PDFs (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('programme-pdfs', 'programme-pdfs', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read programme pdfs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'programme-pdfs');

CREATE POLICY "staff upload programme pdfs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'programme-pdfs' AND public.is_staff(auth.uid()));

CREATE POLICY "staff update programme pdfs"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'programme-pdfs' AND public.is_staff(auth.uid()));

CREATE POLICY "staff delete programme pdfs"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'programme-pdfs' AND public.is_staff(auth.uid()));

-- Seed both programmes
INSERT INTO public.programmes (slug, title, duration, cities, description, days, sort_order)
VALUES
  (
    'programme-1',
    'Programme 1 (17 jours)',
    '17 jours',
    ARRAY['Tokyo','Kamakura','Hakone','Kyoto','Hiroshima','Osaka','Tokyo'],
    'Une immersion complète au Japon en 17 jours, de Tokyo aux temples de Kyoto, en passant par Hakone, Hiroshima et Osaka, avant un retour à Tokyo.',
    '[]'::jsonb,
    1
  ),
  (
    'programme-2',
    'Programme 2 (13 jours)',
    '13 jours',
    ARRAY['Tokyo','Kamakura','Hakone','Kyoto','Hiroshima','Osaka'],
    'Un itinéraire condensé de 13 jours pour découvrir l''essentiel du Japon, de Tokyo à Osaka.',
    '[]'::jsonb,
    2
  );