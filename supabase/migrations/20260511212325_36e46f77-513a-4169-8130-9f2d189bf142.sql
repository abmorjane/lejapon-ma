
CREATE TABLE public.route_slugs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key text NOT NULL UNIQUE,
  label text NOT NULL,
  slug text NOT NULL UNIQUE,
  default_slug text NOT NULL,
  is_editable boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.route_slugs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read route_slugs" ON public.route_slugs
  FOR SELECT USING (true);

CREATE POLICY "staff manage route_slugs" ON public.route_slugs
  FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER route_slugs_updated_at
  BEFORE UPDATE ON public.route_slugs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.route_slugs (route_key, label, slug, default_slug, sort_order) VALUES
  ('trips',       'Voyages',        'voyages',     'voyages',     1),
  ('experiences', 'Expériences',    'experiences', 'experiences', 2),
  ('about',       'À propos',       'a-propos',    'a-propos',    3),
  ('journal',     'Journal',        'journal',     'journal',     4),
  ('blog',        'Blog',           'blog',        'blog',        5),
  ('contact',     'Contact',        'contact',     'contact',     6),
  ('booking',     'Réservation',    'reserver',    'reserver',    7),
  ('programme',   'Programme',      'programme',   'programme',   8),
  ('visa',        'Visa Japon',     'visa',        'visa',        9);
