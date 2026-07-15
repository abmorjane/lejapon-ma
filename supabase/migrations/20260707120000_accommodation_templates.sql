-- Reusable accommodation templates for trip hotel sequences.
-- Templates store relative itinerary days, not fixed calendar dates.

create table if not exists public.accommodation_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  duration_days integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accommodation_template_rows (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.accommodation_templates(id) on delete cascade,
  hotel_catalog_id uuid,
  hotel_name text not null,
  city text,
  arrival_day integer not null,
  departure_day integer not null,
  address text,
  phone text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accommodation_templates
  drop constraint if exists accommodation_templates_duration_days_positive;

alter table public.accommodation_templates
  add constraint accommodation_templates_duration_days_positive
  check (duration_days is null or duration_days > 0);

alter table public.accommodation_template_rows
  drop constraint if exists accommodation_template_rows_days_valid;

alter table public.accommodation_template_rows
  add constraint accommodation_template_rows_days_valid
  check (arrival_day > 0 and departure_day > arrival_day);

create index if not exists idx_accommodation_template_rows_template_order
  on public.accommodation_template_rows(template_id, sort_order);

create index if not exists idx_accommodation_templates_active_name
  on public.accommodation_templates(is_active, name);

alter table public.accommodation_templates enable row level security;
alter table public.accommodation_template_rows enable row level security;

drop policy if exists "staff manage accommodation templates" on public.accommodation_templates;
create policy "staff manage accommodation templates"
on public.accommodation_templates
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop policy if exists "staff manage accommodation template rows" on public.accommodation_template_rows;
create policy "staff manage accommodation template rows"
on public.accommodation_template_rows
for all
using (public.v2_is_staff(auth.uid()))
with check (public.v2_is_staff(auth.uid()));

drop trigger if exists accommodation_templates_updated_at on public.accommodation_templates;
create trigger accommodation_templates_updated_at
before update on public.accommodation_templates
for each row execute function public.set_updated_at();

drop trigger if exists accommodation_template_rows_updated_at on public.accommodation_template_rows;
create trigger accommodation_template_rows_updated_at
before update on public.accommodation_template_rows
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
