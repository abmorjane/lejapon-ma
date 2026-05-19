
ALTER TABLE public.extras ADD COLUMN IF NOT EXISTS alt_text text;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS cover_alt text;
ALTER TABLE public.programmes ADD COLUMN IF NOT EXISTS hero_alt text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cover_alt text;
