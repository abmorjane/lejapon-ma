CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  category text,
  subject text NOT NULL DEFAULT '',
  html_body text NOT NULL DEFAULT '',
  preheader text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS allowed_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS required_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'email_templates' AND column_name = 'html_body'
  ) THEN
    EXECUTE 'UPDATE public.email_templates SET body_html = coalesce(body_html, html_body) WHERE body_html IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'email_templates' AND column_name = 'preheader'
  ) THEN
    EXECUTE 'UPDATE public.email_templates SET body_text = coalesce(body_text, preheader) WHERE body_text IS NULL';
  END IF;
END $$;

UPDATE public.email_templates
SET key = lower(trim(both '_' from regexp_replace(coalesce(nullif(key, ''), metadata->>'key', nullif(name, ''), id::text), '[^a-zA-Z0-9]+', '_', 'g')))
WHERE key IS NULL OR trim(key) = '';

WITH duplicates AS (
  SELECT id, key, language, row_number() OVER (PARTITION BY key, language ORDER BY updated_at DESC NULLS LAST, id) AS rn
  FROM public.email_templates
  WHERE key IS NOT NULL
)
UPDATE public.email_templates t
SET key = t.key || '_' || replace(t.id::text, '-', '')
FROM duplicates d
WHERE t.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS email_templates_key_language_uidx
  ON public.email_templates (key, language);

WITH templates(key, name, category, subject, body_html, body_text, allowed_variables, required_variables) AS (
  VALUES
  ('booking_received_client', 'Réservation reçue — client', 'Réservations', 'Votre demande de réservation LeJapon.ma a bien été reçue', '<p>Bonjour {{client_name}},</p><p>Nous avons bien reçu votre demande pour <strong>{{trip_title}}</strong>.</p><p>Référence : <strong>{{booking_reference}}</strong></p><p>L’équipe LeJapon.ma<br>Moroccan Express Travel and Events</p>', 'Bonjour {{client_name}}, nous avons bien reçu votre demande {{booking_reference}} pour {{trip_title}}. L’équipe LeJapon.ma', '["client_name","booking_reference","trip_title","amount","download_link","date","message"]'::jsonb, '["client_name","booking_reference","trip_title"]'::jsonb),
  ('booking_new_admin', 'Nouvelle réservation — admin', 'Réservations', 'Nouvelle réservation LeJapon.ma — {{client_name}} — {{trip_title}}', '<p>Nouvelle réservation.</p><p>Client : {{client_name}}<br>Voyage : {{trip_title}}<br>Référence : {{booking_reference}}</p><p><a href="{{admin_link}}">Ouvrir la réservation</a></p>', 'Nouvelle réservation {{booking_reference}} - {{client_name}} - {{trip_title}} - {{admin_link}}', '["client_name","booking_reference","trip_title","amount","admin_link","agency_name","status","date","message"]'::jsonb, '["client_name","booking_reference","trip_title","admin_link"]'::jsonb),
  ('booking_status_updated_client', 'Statut réservation mis à jour — client', 'Réservations', 'Mise à jour de votre réservation LeJapon.ma — {{booking_reference}}', '<p>Bonjour {{client_name}},</p><p>Le statut de votre réservation {{booking_reference}} est maintenant : <strong>{{status}}</strong>.</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, statut de votre réservation {{booking_reference}} : {{status}}. L’équipe LeJapon.ma', '["client_name","booking_reference","status","trip_title","message"]'::jsonb, '["client_name","booking_reference","status"]'::jsonb),
  ('booking_payment_reminder_client', 'Rappel paiement réservation — client', 'Réservations', 'Rappel paiement — réservation {{booking_reference}}', '<p>Bonjour {{client_name}},</p><p>Un règlement reste attendu pour votre réservation {{booking_reference}}.</p><p>Montant : {{amount}}</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, règlement attendu pour {{booking_reference}} : {{amount}}. L’équipe LeJapon.ma', '["client_name","booking_reference","amount","payment_method","message"]'::jsonb, '["client_name","booking_reference","amount"]'::jsonb),
  ('payment_received_client', 'Paiement reçu — client', 'Paiements', 'Paiement reçu — LeJapon.ma', '<p>Bonjour {{client_name}},</p><p>Nous confirmons la réception de votre paiement de <strong>{{amount}}</strong>.</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, paiement reçu : {{amount}}. L’équipe LeJapon.ma', '["client_name","amount","payment_method","booking_reference","download_link"]'::jsonb, '["client_name","amount"]'::jsonb),
  ('payment_new_admin', 'Nouveau paiement — admin', 'Paiements', 'Nouveau paiement LeJapon.ma — {{client_name}} — {{amount}}', '<p>Nouveau paiement enregistré.</p><p>Client : {{client_name}}<br>Montant : {{amount}}<br>Méthode : {{payment_method}}</p><p><a href="{{admin_link}}">Ouvrir la réservation</a></p>', 'Nouveau paiement {{client_name}} - {{amount}} - {{payment_method}} - {{admin_link}}', '["client_name","booking_reference","trip_title","amount","payment_method","admin_link","agency_name","status","date"]'::jsonb, '["client_name","amount","admin_link"]'::jsonb),
  ('payment_receipt_client', 'Reçu de paiement — client', 'Paiements', 'Votre reçu de paiement LeJapon.ma', '<p>Bonjour {{client_name}},</p><p>Votre reçu de paiement est disponible.</p><p><a href="{{download_link}}">Télécharger le reçu</a></p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, reçu disponible : {{download_link}}. L’équipe LeJapon.ma', '["client_name","amount","payment_method","download_link","booking_reference"]'::jsonb, '["client_name","download_link"]'::jsonb),
  ('visa_account_created', 'Compte visa créé', 'Visa', 'Bienvenue sur LeJapon.ma — votre espace visa est prêt', '<p>Bonjour {{client_name}},</p><p>Votre espace visa Japon est prêt.</p><p><a href="{{download_link}}">Accéder à mon espace visa</a></p><p>L’équipe LeJapon.ma<br>Moroccan Express Travel and Events</p>', 'Bonjour {{client_name}}, votre espace visa Japon est prêt : {{download_link}}. L’équipe LeJapon.ma', '["client_name","download_link","message"]'::jsonb, '["client_name","download_link"]'::jsonb),
  ('visa_application_submitted_client', 'Demande visa soumise — client', 'Visa', 'Votre demande de visa Japon a bien été soumise — {{visa_reference}}', '<p>Bonjour {{client_name}},</p><p>Votre demande de visa <strong>{{visa_reference}}</strong> a bien été soumise.</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, votre demande visa {{visa_reference}} a bien été soumise. L’équipe LeJapon.ma', '["client_name","visa_reference","download_link","message","date","status"]'::jsonb, '["client_name","visa_reference"]'::jsonb),
  ('visa_application_new_admin', 'Nouvelle demande visa — admin', 'Visa', 'Nouvelle demande visa — {{client_name}} — {{passport_number}}', '<p>Nouvelle demande visa.</p><p>Client : {{client_name}}<br>Passeport : {{passport_number}}<br>Référence : {{visa_reference}}</p><p><a href="{{admin_link}}">Ouvrir la demande</a></p>', 'Nouvelle demande visa {{client_name}} - {{passport_number}} - {{visa_reference}} - {{admin_link}}', '["client_name","visa_reference","passport_number","admin_link","status","date","message"]'::jsonb, '["client_name","visa_reference","admin_link"]'::jsonb),
  ('visa_documents_requested_client', 'Documents visa demandés — client', 'Visa', 'Documents à fournir pour votre visa Japon — {{visa_reference}}', '<p>Bonjour {{client_name}},</p><p>Des documents sont attendus pour votre demande visa <strong>{{visa_reference}}</strong>.</p><p>{{message}}</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, documents attendus pour {{visa_reference}}. {{message}} L’équipe LeJapon.ma', '["client_name","visa_reference","download_link","message","date","status"]'::jsonb, '["client_name","visa_reference"]'::jsonb),
  ('visa_documents_received_client', 'Documents visa reçus client', 'Visa', 'Visa Japon — Documents reçus ({{visa_reference}})', '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#0f172a"><div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><div style="font-size:24px;font-weight:800;color:#f97316;margin-bottom:18px">LeJapon.ma</div><h1 style="font-size:22px;line-height:1.3;margin:0 0 18px">Documents visa reçus</h1><div style="font-size:15px;line-height:1.7;color:#253041"><p>Bonjour {{client_name}},</p><p>Nous avons bien reçu les documents liés à votre demande visa <strong>{{visa_reference}}</strong>.</p><p>Notre équipe prépare votre dossier pour la suite du traitement.</p></div><p style="margin-top:28px">L’équipe LeJapon.ma</p><p style="font-size:13px;color:#667085">Moroccan Express Travel and Events<br>info@lejapon.ma · +212 711 449 838</p></div></div>', 'Bonjour {{client_name}}, nous avons bien reçu les documents liés à votre demande visa {{visa_reference}}. Notre équipe prépare votre dossier pour la suite du traitement. L’équipe LeJapon.ma', '["client_name","visa_reference","admin_link","download_link","message","date","status","passport_number"]'::jsonb, '["client_name","visa_reference"]'::jsonb),
  ('visa_submitted_to_embassy_client', 'Visa déposé à l’ambassade — client', 'Visa', 'Votre dossier visa a été déposé à l’ambassade — {{visa_reference}}', '<p>Bonjour {{client_name}},</p><p>Votre dossier visa <strong>{{visa_reference}}</strong> a été déposé à l’ambassade du Japon.</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, votre dossier visa {{visa_reference}} a été déposé à l’ambassade du Japon. L’équipe LeJapon.ma', '["client_name","visa_reference","status","date","message"]'::jsonb, '["client_name","visa_reference"]'::jsonb),
  ('visa_approved_client', 'Visa approuvé — client', 'Visa', 'Votre visa Japon est approuvé — {{visa_reference}}', '<p>Bonjour {{client_name}},</p><p>Bonne nouvelle : votre visa <strong>{{visa_reference}}</strong> a été approuvé.</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, votre visa {{visa_reference}} a été approuvé. L’équipe LeJapon.ma', '["client_name","visa_reference","status","date","message"]'::jsonb, '["client_name","visa_reference"]'::jsonb),
  ('visa_rejected_or_issue_client', 'Visa refusé / complément demandé — client', 'Visa', 'Mise à jour importante concernant votre visa — {{visa_reference}}', '<p>Bonjour {{client_name}},</p><p>Une mise à jour importante concerne votre demande visa <strong>{{visa_reference}}</strong>.</p><p>Statut : {{status}}</p><p>{{message}}</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{client_name}}, mise à jour visa {{visa_reference}} : {{status}}. {{message}} L’équipe LeJapon.ma', '["client_name","visa_reference","status","message","date"]'::jsonb, '["client_name","visa_reference","status"]'::jsonb),
  ('agency_onboarding_submitted_admin', 'Dossier agence soumis — admin', 'Agences', 'Nouveau dossier partenaire — {{agency_name}}', '<p>L’agence <strong>{{agency_name}}</strong> a soumis son dossier partenaire.</p><p><a href="{{admin_link}}">Ouvrir le dossier</a></p>', 'Nouveau dossier partenaire : {{agency_name}} - {{admin_link}}', '["agency_name","admin_link","status","message"]'::jsonb, '["agency_name","admin_link"]'::jsonb),
  ('agency_onboarding_approved_agency', 'Dossier agence approuvé', 'Agences', 'Votre partenariat LeJapon.ma est approuvé', '<p>Bonjour {{agency_name}},</p><p>Votre dossier partenaire LeJapon.ma est approuvé.</p><p>L’équipe LeJapon.ma</p>', 'Bonjour {{agency_name}}, votre dossier partenaire LeJapon.ma est approuvé. L’équipe LeJapon.ma', '["agency_name","status","message"]'::jsonb, '["agency_name"]'::jsonb),
  ('agency_booking_new_admin', 'Nouvelle réservation agence — admin', 'Agences', 'Nouvelle réservation agence — {{agency_name}} — {{client_name}}', '<p>Agence : {{agency_name}}<br>Client : {{client_name}}<br>Voyage : {{trip_title}}</p><p><a href="{{admin_link}}">Ouvrir</a></p>', 'Nouvelle réservation agence {{agency_name}} - {{client_name}} - {{trip_title}} - {{admin_link}}', '["agency_name","client_name","trip_title","admin_link","amount","status"]'::jsonb, '["agency_name","client_name","trip_title"]'::jsonb),
  ('agency_payment_new_admin', 'Nouveau paiement agence — admin', 'Agences', 'Nouveau paiement agence — {{agency_name}} — {{amount}}', '<p>L’agence <strong>{{agency_name}}</strong> a enregistré un paiement de <strong>{{amount}}</strong>.</p>', 'Nouveau paiement agence {{agency_name}} - {{amount}}', '["agency_name","amount","payment_method","admin_link","status","date"]'::jsonb, '["agency_name","amount"]'::jsonb),
  ('agency_booking_confirmation_client', 'Confirmation réservation agence — client', 'Agences', 'Votre réservation via {{agency_name}} est bien enregistrée', '<p>Bonjour {{client_name}},</p><p>Votre réservation pour <strong>{{trip_title}}</strong> est bien enregistrée via <strong>{{agency_name}}</strong>.</p>', 'Bonjour {{client_name}}, votre réservation {{trip_title}} via {{agency_name}} est bien enregistrée.', '["agency_name","client_name","trip_title","booking_reference","amount","status"]'::jsonb, '["client_name","trip_title","agency_name"]'::jsonb),
  ('supplier_quote_requested', 'Demande devis fournisseur', 'Fournisseurs', 'Demande de devis Bureau Japon — {{trip_title}}', '<p>Merci de préparer un devis pour le voyage <strong>{{trip_title}}</strong>.</p><p><a href="{{admin_link}}">Ouvrir le devis</a></p>', 'Demande devis fournisseur {{trip_title}} - {{admin_link}}', '["trip_title","admin_link","message","date"]'::jsonb, '["trip_title","admin_link"]'::jsonb),
  ('supplier_quote_submitted_admin', 'Devis fournisseur soumis — admin', 'Fournisseurs', 'Devis fournisseur soumis — {{trip_title}}', '<p>Le devis fournisseur pour <strong>{{trip_title}}</strong> a été soumis.</p><p><a href="{{admin_link}}">Ouvrir</a></p>', 'Devis fournisseur soumis {{trip_title}} - {{admin_link}}', '["trip_title","admin_link","status","message"]'::jsonb, '["trip_title","admin_link"]'::jsonb),
  ('supplier_row_assigned', 'Ligne devis assignée', 'Fournisseurs', 'Une ligne de devis vous est assignée — {{trip_title}}', '<p>Une ligne de devis vous est assignée pour <strong>{{trip_title}}</strong>.</p><p><a href="{{admin_link}}">Ouvrir</a></p>', 'Ligne assignée {{trip_title}} - {{admin_link}}', '["trip_title","admin_link","message","date"]'::jsonb, '["trip_title","admin_link"]'::jsonb),
  ('password_reset_custom', 'Réinitialisation mot de passe', 'Système', 'Réinitialisation de votre mot de passe LeJapon.ma', '<p>Bonjour {{client_name}},</p><p>Vous pouvez réinitialiser votre mot de passe avec le lien ci-dessous.</p><p><a href="{{download_link}}">Réinitialiser</a></p>', 'Réinitialisation mot de passe : {{download_link}}', '["client_name","download_link"]'::jsonb, '["download_link"]'::jsonb),
  ('user_invitation', 'Invitation utilisateur', 'Système', 'Invitation à rejoindre LeJapon.ma', '<p>Bonjour {{client_name}},</p><p>Vous êtes invité à rejoindre l’espace LeJapon.ma.</p><p><a href="{{download_link}}">Accéder à votre compte</a></p>', 'Invitation LeJapon.ma : {{download_link}}', '["client_name","download_link"]'::jsonb, '["download_link"]'::jsonb)
)
INSERT INTO public.email_templates (
  key,
  name,
  category,
  language,
  subject,
  html_body,
  body_html,
  preheader,
  body_text,
  allowed_variables,
  required_variables,
  is_active,
  is_system,
  metadata,
  updated_at
)
SELECT
  key,
  name,
  category,
  'fr',
  subject,
  body_html,
  body_html,
  body_text,
  body_text,
  allowed_variables,
  required_variables,
  true,
  true,
  jsonb_build_object('seeded_by', '20260606120000_email_templates_schema_test_fix'),
  now()
FROM templates
ON CONFLICT (key, language) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  subject = EXCLUDED.subject,
  html_body = EXCLUDED.html_body,
  body_html = EXCLUDED.body_html,
  preheader = EXCLUDED.preheader,
  body_text = EXCLUDED.body_text,
  allowed_variables = EXCLUDED.allowed_variables,
  required_variables = EXCLUDED.required_variables,
  is_active = true,
  is_system = true,
  metadata = coalesce(public.email_templates.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = now();

WITH legacy_branding AS (
  SELECT
    ('L''équipe ' || 'Ta' || 'pis Volant — Le Japon') AS old_footer,
    ('Ta' || 'pis Volant — Le Japon') AS old_brand_line,
    ('Ta' || 'pis Volant') AS old_brand,
    ('Tri' || 'ps app') AS old_app
)
UPDATE public.email_templates
SET
  subject = replace(replace(replace(replace(subject, legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'), legacy_branding.old_app, 'LeJapon.ma'),
  html_body = replace(replace(replace(replace(html_body, legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'), legacy_branding.old_app, 'LeJapon.ma'),
  preheader = replace(replace(replace(replace(coalesce(preheader, ''), legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'), legacy_branding.old_app, 'LeJapon.ma'),
  body_html = replace(replace(replace(replace(coalesce(body_html, html_body), legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'), legacy_branding.old_app, 'LeJapon.ma'),
  body_text = replace(replace(replace(replace(coalesce(body_text, preheader, ''), legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'), legacy_branding.old_app, 'LeJapon.ma'),
  updated_at = now()
FROM legacy_branding
WHERE
  subject ILIKE '%' || legacy_branding.old_brand || '%'
  OR html_body ILIKE '%' || legacy_branding.old_brand || '%'
  OR preheader ILIKE '%' || legacy_branding.old_brand || '%'
  OR body_html ILIKE '%' || legacy_branding.old_brand || '%'
  OR body_text ILIKE '%' || legacy_branding.old_brand || '%'
  OR subject ILIKE '%' || legacy_branding.old_app || '%'
  OR html_body ILIKE '%' || legacy_branding.old_app || '%'
  OR preheader ILIKE '%' || legacy_branding.old_app || '%'
  OR body_html ILIKE '%' || legacy_branding.old_app || '%'
  OR body_text ILIKE '%' || legacy_branding.old_app || '%';

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage templates" ON public.email_templates;
CREATE POLICY "staff manage templates" ON public.email_templates
FOR ALL
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

NOTIFY pgrst, 'reload schema';
