-- Rattrapage schema cache + pricing dynamique des templates FIT partenaires.
-- Idempotent: ne supprime aucune donnée et force PostgREST à recharger le schema.

alter table public.fit_quotes
  add column if not exists cancellation_conditions text,
  add column if not exists booking_conditions text,
  add column if not exists payment_conditions text,
  add column if not exists non_included_text text;

alter table public.fit_day_templates
  add column if not exists partner_net_pricing_mode text not null default 'auto',
  add column if not exists calculated_ground_cost_mad numeric not null default 0,
  add column if not exists calculated_japan_agency_fee_mad numeric not null default 0,
  add column if not exists calculated_project_cost_mad numeric not null default 0,
  add column if not exists calculated_margin_mad numeric not null default 0,
  add column if not exists calculated_sale_price_mad numeric not null default 0;

alter table public.fit_day_templates
  drop constraint if exists fit_day_templates_partner_net_pricing_mode_check,
  add constraint fit_day_templates_partner_net_pricing_mode_check
  check (partner_net_pricing_mode in ('auto', 'manual'));

alter table public.fit_day_template_cost_lines
  add column if not exists partner_visible boolean not null default true,
  add column if not exists can_partner_disable boolean not null default false,
  add column if not exists affects_partner_net_price boolean not null default true,
  add column if not exists net_price_impact numeric not null default 0;

notify pgrst, 'reload schema';
