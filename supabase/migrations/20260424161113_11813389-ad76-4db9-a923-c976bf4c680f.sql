
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS badge_type text,
  ADD COLUMN IF NOT EXISTS badge_text text,
  ADD COLUMN IF NOT EXISTS destinations text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS program_link text,
  ADD COLUMN IF NOT EXISTS promo_percent integer,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_trips_sort_order ON public.trips(sort_order);
CREATE INDEX IF NOT EXISTS idx_trips_is_featured ON public.trips(is_featured);
