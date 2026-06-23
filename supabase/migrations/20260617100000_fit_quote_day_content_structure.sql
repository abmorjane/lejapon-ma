-- FIT day content structure for cleaner client text generation.
-- Additive only: existing fields remain the compatibility source of truth.

alter table public.fit_day_templates
  add column if not exists source_description text,
  add column if not exists sales_summary text,
  add column if not exists optimized_client_description text,
  add column if not exists meal_plan jsonb not null default '[]'::jsonb,
  add column if not exists day_pace text;

alter table public.fit_quote_days
  add column if not exists source_description text,
  add column if not exists sales_summary text,
  add column if not exists optimized_client_description text,
  add column if not exists meal_plan jsonb not null default '[]'::jsonb,
  add column if not exists day_pace text;

grant select (
  sales_summary, optimized_client_description, meal_plan, day_pace
) on public.fit_quote_days to anon;

notify pgrst, 'reload schema';
