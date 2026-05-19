
-- Extend clients table
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_subscribed boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_clients_tags ON public.clients USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients (lower(email));

-- Enums
DO $$ BEGIN
  CREATE TYPE public.campaign_status AS ENUM ('draft','scheduled','sending','sent','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.recipient_status AS ENUM ('pending','sent','failed','bounced','opened','clicked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.email_event_type AS ENUM ('open','click');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.segment_type AS ENUM ('past_travelers','leads','tag','all_subscribed','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Templates
CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  subject text NOT NULL,
  html_body text NOT NULL DEFAULT '',
  preheader text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage templates" ON public.email_templates FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_email_templates_updated BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Campaigns
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  html_body text NOT NULL DEFAULT '',
  preheader text,
  from_name text,
  from_email text,
  reply_to text,
  template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  segment_type public.segment_type NOT NULL DEFAULT 'all_subscribed',
  segment_tag text,
  status public.campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  total_recipients int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  open_count int NOT NULL DEFAULT 0,
  click_count int NOT NULL DEFAULT 0,
  unique_open_count int NOT NULL DEFAULT 0,
  unique_click_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage campaigns" ON public.email_campaigns FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_email_campaigns_updated BEFORE UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Recipients
CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  status public.recipient_status NOT NULL DEFAULT 'pending',
  tracking_token text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-',''),
  sent_at timestamptz,
  first_opened_at timestamptz,
  first_clicked_at timestamptz,
  open_count int NOT NULL DEFAULT 0,
  click_count int NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON public.email_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recipients_token ON public.email_campaign_recipients(tracking_token);
CREATE INDEX IF NOT EXISTS idx_recipients_status ON public.email_campaign_recipients(campaign_id, status);

ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage recipients" ON public.email_campaign_recipients FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Events (open/click tracking)
CREATE TABLE IF NOT EXISTS public.email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.email_campaign_recipients(id) ON DELETE SET NULL,
  event_type public.email_event_type NOT NULL,
  url text,
  user_agent text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON public.email_events(campaign_id, event_type);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read events" ON public.email_events FOR SELECT
  USING (public.is_staff(auth.uid()));
CREATE POLICY "anyone insert events" ON public.email_events FOR INSERT
  WITH CHECK (true);

-- Seed default templates
INSERT INTO public.email_templates (name, category, subject, preheader, html_body) VALUES
('Nouveau départ', 'departure', 'Nouveau départ pour le Japon ✈️',
 'Découvrez notre prochain voyage exclusif',
 '<h1>Un nouveau voyage vous attend</h1><p>Bonjour {{first_name}},</p><p>Nous avons le plaisir de vous annoncer un nouveau départ pour le Japon. Places limitées.</p><p><a href="https://lejapon.ma/voyages">Découvrir le voyage</a></p>'),
('Promotion', 'promo', 'Offre exclusive — {{discount}}% de réduction',
 'Profitez d''un tarif préférentiel sur votre prochain voyage',
 '<h1>Offre spéciale</h1><p>Bonjour {{first_name}},</p><p>Bénéficiez de <strong>{{discount}}%</strong> sur votre prochain voyage au Japon, valable jusqu''au {{expiry}}.</p><p><a href="https://lejapon.ma/voyages">En profiter</a></p>'),
('Offre saisonnière', 'seasonal', 'Le Japon en {{season}} — départs ouverts',
 'Sakura, momiji, neige : choisissez votre saison',
 '<h1>Le Japon en {{season}}</h1><p>Bonjour {{first_name}},</p><p>Nos départs pour la saison {{season}} sont ouverts. Réservez tôt pour garantir votre place.</p><p><a href="https://lejapon.ma/voyages">Voir les départs</a></p>')
ON CONFLICT DO NOTHING;
