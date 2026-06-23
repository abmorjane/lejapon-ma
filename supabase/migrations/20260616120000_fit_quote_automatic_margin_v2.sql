-- FIT automatic costing v2.
-- Keeps existing quotes on legacy calculation while new quotes can use separated Japan agency fees and LeJapon.ma margin.

alter table public.fit_quotes
  add column if not exists calculation_mode text not null default 'legacy',
  add column if not exists japan_agency_fee_rate numeric not null default 10,
  add column if not exists lejapon_margin_rate numeric not null default 20,
  add column if not exists margin_scope text not null default 'program_only',
  add column if not exists rounding_rule text not null default 'unit',
  add column if not exists ground_cost_total_mad numeric not null default 0,
  add column if not exists japan_agency_fee_total_mad numeric not null default 0,
  add column if not exists project_cost_total_mad numeric not null default 0;

alter table public.fit_quotes
  drop constraint if exists fit_quotes_calculation_mode_check,
  add constraint fit_quotes_calculation_mode_check
    check (calculation_mode in ('legacy','automatic_v2'));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_margin_scope_check,
  add constraint fit_quotes_margin_scope_check
    check (margin_scope in ('program_only','program_hotels','program_hotels_flights','all'));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_rounding_rule_check,
  add constraint fit_quotes_rounding_rule_check
    check (rounding_rule in ('unit','ten','hundred'));

alter table public.fit_quote_days
  add column if not exists japan_agency_fee_rate_override numeric,
  add column if not exists calculated_ground_cost numeric not null default 0,
  add column if not exists calculated_japan_agency_fee numeric not null default 0,
  add column if not exists calculated_project_cost numeric not null default 0,
  add column if not exists calculated_margin numeric not null default 0,
  add column if not exists calculated_sale_price numeric not null default 0,
  add column if not exists calculated_sale_price_per_person numeric not null default 0;

alter table public.fit_day_template_cost_lines
  add column if not exists cost_role text not null default 'supplier_cost',
  add column if not exists included_in_calculation boolean not null default true;

alter table public.fit_quote_day_cost_lines
  add column if not exists cost_role text not null default 'supplier_cost',
  add column if not exists included_in_calculation boolean not null default true;

alter table public.fit_quote_cost_lines
  add column if not exists cost_role text not null default 'supplier_cost',
  add column if not exists included_in_calculation boolean not null default true;

alter table public.fit_day_template_cost_lines
  drop constraint if exists fit_day_template_cost_lines_cost_role_check,
  add constraint fit_day_template_cost_lines_cost_role_check
    check (cost_role in ('supplier_cost','japan_agency_fee_auto','lejapon_margin_auto','adjustment','discount'));

alter table public.fit_quote_day_cost_lines
  drop constraint if exists fit_quote_day_cost_lines_cost_role_check,
  add constraint fit_quote_day_cost_lines_cost_role_check
    check (cost_role in ('supplier_cost','japan_agency_fee_auto','lejapon_margin_auto','adjustment','discount'));

alter table public.fit_quote_cost_lines
  drop constraint if exists fit_quote_cost_lines_cost_role_check,
  add constraint fit_quote_cost_lines_cost_role_check
    check (cost_role in ('supplier_cost','japan_agency_fee_auto','lejapon_margin_auto','adjustment','discount'));

alter table public.fit_day_template_cost_lines
  drop constraint if exists fit_day_template_cost_lines_category_check,
  add constraint fit_day_template_cost_lines_category_check
    check (category in ('transport','guide','visit','luggage','agency_fee','hotel','flight','train','bus','meal','transfer','activities','other'));

alter table public.fit_quote_day_cost_lines
  drop constraint if exists fit_quote_day_cost_lines_category_check,
  add constraint fit_quote_day_cost_lines_category_check
    check (category in ('transport','guide','visit','luggage','agency_fee','hotel','flight','train','bus','meal','transfer','activities','other'));

alter table public.fit_quote_cost_lines
  drop constraint if exists fit_quote_cost_lines_category_check,
  add constraint fit_quote_cost_lines_category_check
    check (category in ('transport','guide','visit','luggage','agency_fee','hotel','flight','train','bus','meal','transfer','activities','other','adjustment','discount','optional_extra'));

notify pgrst, 'reload schema';
