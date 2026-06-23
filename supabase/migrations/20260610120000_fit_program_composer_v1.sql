create table if not exists public.fit_day_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  city text,
  theme text,
  duration text,
  description_client text,
  internal_notes text,
  included_visits jsonb not null default '[]'::jsonb,
  optional_visits jsonb not null default '[]'::jsonb,
  transport_type text,
  guide_required boolean not null default false,
  hotel_night boolean not null default true,
  meal_notes text,
  estimated_cost_jpy numeric not null default 0,
  estimated_cost_mad numeric not null default 0,
  default_selling_price_mad numeric not null default 0,
  margin_percent numeric not null default 0,
  image_urls jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fit_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  client_name text,
  travelers_count integer not null default 1,
  travel_start_date date,
  travel_end_date date,
  hotel_category text,
  room_type text,
  currency text not null default 'MAD',
  language text not null default 'fr',
  notes text,
  status text not null default 'draft',
  manual_adjustment_mad numeric not null default 0,
  discount_mad numeric not null default 0,
  total_cost_mad numeric not null default 0,
  total_selling_price_mad numeric not null default 0,
  margin_amount_mad numeric not null default 0,
  margin_percent numeric not null default 0,
  price_per_person_mad numeric not null default 0,
  hotel_total_mad numeric not null default 0,
  transport_total_mad numeric not null default 0,
  guide_total_mad numeric not null default 0,
  activities_total_mad numeric not null default 0,
  other_total_mad numeric not null default 0,
  payment_conditions text,
  inclusions text,
  exclusions text,
  converted_booking_id uuid references public.bookings(id) on delete set null,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fit_quotes_status_check check (status in ('draft','sent','accepted','rejected','converted_to_booking'))
);

create table if not exists public.fit_quote_days (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  template_id uuid references public.fit_day_templates(id) on delete set null,
  day_number integer not null default 1,
  sort_order integer not null default 0,
  date date,
  title text not null,
  city text,
  description_client text,
  visits jsonb not null default '[]'::jsonb,
  optional_visits jsonb not null default '[]'::jsonb,
  transport_type text,
  guide_required boolean not null default false,
  hotel_night boolean not null default true,
  meal_notes text,
  cost_jpy numeric not null default 0,
  cost_mad numeric not null default 0,
  selling_price_mad numeric not null default 0,
  notes text,
  internal_notes text,
  image_urls jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fit_quote_cost_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  day_id uuid references public.fit_quote_days(id) on delete set null,
  sort_order integer not null default 0,
  category text not null default 'other',
  label text not null default '',
  quantity numeric not null default 1,
  unit_cost_jpy numeric not null default 0,
  unit_cost_mad numeric not null default 0,
  total_jpy numeric not null default 0,
  total_mad numeric not null default 0,
  selling_price_mad numeric not null default 0,
  optional boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fit_quote_cost_lines_category_check check (category in ('hotel','transport','guide','activities','other','adjustment','discount','optional_extra'))
);

create table if not exists public.fit_quote_documents (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  document_type text not null default 'client_pdf',
  file_name text,
  storage_path text,
  public_url text,
  generated_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fit_day_templates_city_idx on public.fit_day_templates(city);
create index if not exists fit_day_templates_theme_idx on public.fit_day_templates(theme);
create index if not exists fit_day_templates_active_idx on public.fit_day_templates(is_active);
create index if not exists fit_day_templates_tags_gin_idx on public.fit_day_templates using gin(tags);

create index if not exists fit_quotes_client_id_idx on public.fit_quotes(client_id);
create index if not exists fit_quotes_status_idx on public.fit_quotes(status);
create index if not exists fit_quotes_updated_at_idx on public.fit_quotes(updated_at desc);
create index if not exists fit_quotes_converted_booking_id_idx on public.fit_quotes(converted_booking_id);

create index if not exists fit_quote_days_quote_id_idx on public.fit_quote_days(quote_id);
create index if not exists fit_quote_days_quote_sort_idx on public.fit_quote_days(quote_id, sort_order);
create index if not exists fit_quote_days_template_id_idx on public.fit_quote_days(template_id);

create index if not exists fit_quote_cost_lines_quote_id_idx on public.fit_quote_cost_lines(quote_id);
create index if not exists fit_quote_cost_lines_quote_sort_idx on public.fit_quote_cost_lines(quote_id, sort_order);
create index if not exists fit_quote_cost_lines_category_idx on public.fit_quote_cost_lines(category);

create index if not exists fit_quote_documents_quote_id_idx on public.fit_quote_documents(quote_id);
create index if not exists fit_quote_documents_type_idx on public.fit_quote_documents(document_type);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fit_day_templates_updated_at on public.fit_day_templates;
create trigger fit_day_templates_updated_at
before update on public.fit_day_templates
for each row execute function public.set_updated_at();

drop trigger if exists fit_quotes_updated_at on public.fit_quotes;
create trigger fit_quotes_updated_at
before update on public.fit_quotes
for each row execute function public.set_updated_at();

drop trigger if exists fit_quote_days_updated_at on public.fit_quote_days;
create trigger fit_quote_days_updated_at
before update on public.fit_quote_days
for each row execute function public.set_updated_at();

drop trigger if exists fit_quote_cost_lines_updated_at on public.fit_quote_cost_lines;
create trigger fit_quote_cost_lines_updated_at
before update on public.fit_quote_cost_lines
for each row execute function public.set_updated_at();

alter table public.fit_day_templates enable row level security;
alter table public.fit_quotes enable row level security;
alter table public.fit_quote_days enable row level security;
alter table public.fit_quote_cost_lines enable row level security;
alter table public.fit_quote_documents enable row level security;

drop policy if exists "staff manage fit day templates" on public.fit_day_templates;
create policy "staff manage fit day templates" on public.fit_day_templates
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage fit quotes" on public.fit_quotes;
create policy "staff manage fit quotes" on public.fit_quotes
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage fit quote days" on public.fit_quote_days;
create policy "staff manage fit quote days" on public.fit_quote_days
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage fit quote cost lines" on public.fit_quote_cost_lines;
create policy "staff manage fit quote cost lines" on public.fit_quote_cost_lines
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage fit quote documents" on public.fit_quote_documents;
create policy "staff manage fit quote documents" on public.fit_quote_documents
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

notify pgrst, 'reload schema';
