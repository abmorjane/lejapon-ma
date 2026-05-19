
CREATE TABLE IF NOT EXISTS public.content_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id text NOT NULL,
  field text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','ar')),
  value_text text,
  status text NOT NULL DEFAULT 'auto' CHECK (status IN ('auto','verified','manual')),
  source_text_hash text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, row_id, field, language)
);

CREATE INDEX IF NOT EXISTS idx_content_translations_lookup
  ON public.content_translations (table_name, language, row_id);

ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read content_translations"
  ON public.content_translations FOR SELECT
  USING (true);

CREATE POLICY "staff manage content_translations"
  ON public.content_translations FOR ALL
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER content_translations_set_updated_at
  BEFORE UPDATE ON public.content_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
