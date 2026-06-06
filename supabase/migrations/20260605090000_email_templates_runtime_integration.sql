ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS allowed_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS required_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

WITH legacy_branding AS (
  SELECT
    ('L''équipe ' || 'Ta' || 'pis Volant — Le Japon') AS old_footer,
    ('Ta' || 'pis Volant — Le Japon') AS old_brand_line,
    ('Ta' || 'pis Volant') AS old_brand
)
UPDATE public.email_templates
SET
  subject = replace(replace(replace(subject, legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'),
  html_body = replace(replace(replace(html_body, legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'),
  preheader = replace(replace(replace(preheader, legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'),
  body_html = replace(replace(replace(coalesce(body_html, html_body), legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'),
  body_text = replace(replace(replace(coalesce(body_text, preheader), legacy_branding.old_footer, 'L’équipe LeJapon.ma'), legacy_branding.old_brand_line, 'LeJapon.ma'), legacy_branding.old_brand, 'LeJapon.ma'),
  updated_at = now()
FROM legacy_branding
WHERE
  subject ILIKE '%' || legacy_branding.old_brand || '%'
  OR html_body ILIKE '%' || legacy_branding.old_brand || '%'
  OR preheader ILIKE '%' || legacy_branding.old_brand || '%'
  OR body_html ILIKE '%' || legacy_branding.old_brand || '%'
  OR body_text ILIKE '%' || legacy_branding.old_brand || '%';

DO $$
DECLARE
  v_body_html text := '<div style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ef;padding:24px;color:#0f172a"><div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #eadfd7;border-radius:18px;padding:28px"><div style="font-size:24px;font-weight:800;color:#f97316;margin-bottom:18px">LeJapon.ma</div><h1 style="font-size:22px;line-height:1.3;margin:0 0 18px">Documents visa reçus</h1><div style="font-size:15px;line-height:1.7;color:#253041"><p>Bonjour {{client_name}},</p><p>Nous avons bien reçu les documents liés à votre demande visa <strong>{{visa_reference}}</strong>.</p><p>Notre équipe prépare votre dossier pour la suite du traitement.</p></div><p style="margin-top:28px">L''équipe LeJapon.ma</p><p style="font-size:13px;color:#667085">Moroccan Express Travel and Events<br/>info@lejapon.ma · +212 711 449 838</p></div></div>';
  v_body_text text := 'Bonjour {{client_name}},

Nous avons bien reçu les documents liés à votre demande visa {{visa_reference}}.
Notre équipe prépare votre dossier pour la suite du traitement.

L''équipe LeJapon.ma
Moroccan Express Travel and Events
info@lejapon.ma';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.email_templates
    WHERE key = 'visa_documents_received_client'
       OR name = 'visa_documents_received_client'
       OR name = 'Documents visa reçus client'
  ) THEN
    UPDATE public.email_templates
    SET
      key = 'visa_documents_received_client',
      name = coalesce(nullif(name, 'visa_documents_received_client'), 'Documents visa reçus client'),
      category = 'Visa',
      language = coalesce(language, 'fr'),
      subject = 'Visa Japon — Documents reçus ({{visa_reference}})',
      html_body = v_body_html,
      body_html = v_body_html,
      preheader = v_body_text,
      body_text = v_body_text,
      allowed_variables = '["client_name","visa_reference","admin_link","download_link","message","date","status","passport_number"]'::jsonb,
      required_variables = '["client_name","visa_reference"]'::jsonb,
      is_active = true,
      is_system = true,
      metadata = coalesce(metadata, '{}'::jsonb) || '{"seeded_by":"20260605090000_email_templates_runtime_integration"}'::jsonb,
      updated_at = now()
    WHERE key = 'visa_documents_received_client'
       OR name = 'visa_documents_received_client'
       OR name = 'Documents visa reçus client';
  ELSE
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
      metadata
    )
    VALUES (
      'visa_documents_received_client',
      'Documents visa reçus client',
      'Visa',
      'fr',
      'Visa Japon — Documents reçus ({{visa_reference}})',
      v_body_html,
      v_body_html,
      v_body_text,
      v_body_text,
      '["client_name","visa_reference","admin_link","download_link","message","date","status","passport_number"]'::jsonb,
      '["client_name","visa_reference"]'::jsonb,
      true,
      true,
      '{"seeded_by":"20260605090000_email_templates_runtime_integration"}'::jsonb
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
