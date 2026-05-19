
-- Catégories d'articles
CREATE TABLE IF NOT EXISTS public.article_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read article_categories"
  ON public.article_categories FOR SELECT USING (true);

CREATE POLICY "staff manage article_categories"
  ON public.article_categories FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Seed des catégories par défaut
INSERT INTO public.article_categories (name, slug, sort_order) VALUES
  ('Cuisine', 'cuisine', 10),
  ('Culture', 'culture', 20),
  ('Études', 'etudes', 30),
  ('Histoire', 'histoire', 40),
  ('Kyoto', 'kyoto', 50),
  ('Non classé', 'non-classe', 60),
  ('Osaka', 'osaka', 70),
  ('Osaka Expo', 'osaka-expo', 80),
  ('Tokyo', 'tokyo', 90),
  ('Voyage', 'voyage', 100)
ON CONFLICT (name) DO NOTHING;

-- Colonnes additionnelles pour articles (SEO + galerie)
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS meta_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_description TEXT,
  ADD COLUMN IF NOT EXISTS reading_time_minutes INTEGER;

-- Bucket public pour les images d'articles
INSERT INTO storage.buckets (id, name, public)
VALUES ('article-images', 'article-images', true)
ON CONFLICT (id) DO NOTHING;

-- Policies storage : lecture publique, écriture staff
CREATE POLICY "public read article-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'article-images');

CREATE POLICY "staff upload article-images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'article-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff update article-images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'article-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff delete article-images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'article-images' AND public.is_staff(auth.uid()));
