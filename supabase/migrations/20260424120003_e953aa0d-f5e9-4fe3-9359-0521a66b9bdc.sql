-- Extend programmes with hero/intro fields
ALTER TABLE public.programmes
  ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS introduction text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS cta_label text NOT NULL DEFAULT 'Demander un devis',
  ADD COLUMN IF NOT EXISTS cta_url text NOT NULL DEFAULT '/contact',
  ADD COLUMN IF NOT EXISTS meta_description text;

-- Rich per-day table
CREATE TABLE IF NOT EXISTS public.programme_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  day_number integer NOT NULL,
  city text NOT NULL DEFAULT '',
  badge text,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  main_image_url text,
  gallery_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  included_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  icons jsonb NOT NULL DEFAULT '[]'::jsonb,
  special_note text,
  is_optional boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_programme_days_prog ON public.programme_days(programme_id, sort_order);

ALTER TABLE public.programme_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read active programme_days"
  ON public.programme_days FOR SELECT
  USING (
    is_active = true
    AND EXISTS (SELECT 1 FROM public.programmes p WHERE p.id = programme_id AND (p.is_published = true OR public.is_staff(auth.uid())))
    OR public.is_staff(auth.uid())
  );

CREATE POLICY "staff manage programme_days"
  ON public.programme_days FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER programme_days_set_updated
  BEFORE UPDATE ON public.programme_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket for programme images (hero + day photos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('programme-images', 'programme-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read programme-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'programme-images');

CREATE POLICY "staff write programme-images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'programme-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff update programme-images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'programme-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff delete programme-images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'programme-images' AND public.is_staff(auth.uid()));