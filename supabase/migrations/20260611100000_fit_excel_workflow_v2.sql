alter table public.fit_day_templates
  add column if not exists pax_group_size integer not null default 2;

alter table public.fit_quote_days
  add column if not exists local_key text,
  add column if not exists pax_group_size integer not null default 2;

alter table public.fit_quotes
  add column if not exists share_token text,
  add column if not exists share_slug text,
  add column if not exists share_enabled boolean not null default false,
  add column if not exists valid_until date,
  add column if not exists client_notes text,
  add column if not exists requested_changes_at timestamptz,
  add column if not exists hotel_cost_mad numeric not null default 0,
  add column if not exists flight_cost_mad numeric not null default 0;

alter table public.fit_quote_cost_lines
  drop constraint if exists fit_quote_cost_lines_category_check;

alter table public.fit_quote_cost_lines
  add constraint fit_quote_cost_lines_category_check
  check (category in ('transport','guide','visit','luggage','agency_fee','hotel','flight','activities','other','adjustment','discount','optional_extra'));

create table if not exists public.fit_day_template_cost_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.fit_day_templates(id) on delete cascade,
  sort_order integer not null default 0,
  category text not null default 'other',
  label text not null default '',
  price_mad numeric not null default 0,
  price_jpy numeric not null default 0,
  quantity numeric not null default 1,
  times numeric not null default 1,
  subtotal_mad numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  fee_type text not null default 'fixed',
  percentage_rate numeric not null default 0,
  notes text,
  is_optional boolean not null default false,
  is_client_visible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fit_day_template_cost_lines_category_check check (category in ('transport','guide','visit','luggage','agency_fee','hotel','flight','activities','other')),
  constraint fit_day_template_cost_lines_fee_type_check check (fee_type in ('fixed','percentage_day','percentage_quote'))
);

create table if not exists public.fit_quote_day_cost_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  day_id uuid not null references public.fit_quote_days(id) on delete cascade,
  template_line_id uuid references public.fit_day_template_cost_lines(id) on delete set null,
  sort_order integer not null default 0,
  category text not null default 'other',
  label text not null default '',
  price_mad numeric not null default 0,
  price_jpy numeric not null default 0,
  quantity numeric not null default 1,
  times numeric not null default 1,
  subtotal_mad numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  fee_type text not null default 'fixed',
  percentage_rate numeric not null default 0,
  notes text,
  is_optional boolean not null default false,
  is_client_visible boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fit_quote_day_cost_lines_category_check check (category in ('transport','guide','visit','luggage','agency_fee','hotel','flight','activities','other')),
  constraint fit_quote_day_cost_lines_fee_type_check check (fee_type in ('fixed','percentage_day','percentage_quote'))
);

create table if not exists public.fit_quote_hotel_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  sort_order integer not null default 0,
  city text,
  hotel_name text,
  room_type text,
  rooms_count numeric not null default 1,
  nights numeric not null default 1,
  price_per_room_night_mad numeric not null default 0,
  price_per_room_night_jpy numeric not null default 0,
  subtotal_mad numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fit_quote_flight_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  sort_order integer not null default 0,
  route text,
  airline text,
  fare_per_person_mad numeric not null default 0,
  fare_per_person_jpy numeric not null default 0,
  passengers_count numeric not null default 1,
  subtotal_mad numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fit_quotes_share_token_uidx on public.fit_quotes(share_token) where share_token is not null;
create index if not exists fit_quotes_share_enabled_idx on public.fit_quotes(share_enabled);
create index if not exists fit_quote_days_local_key_idx on public.fit_quote_days(quote_id, local_key);
create index if not exists fit_day_template_cost_lines_template_idx on public.fit_day_template_cost_lines(template_id, sort_order);
create index if not exists fit_quote_day_cost_lines_quote_idx on public.fit_quote_day_cost_lines(quote_id, sort_order);
create index if not exists fit_quote_day_cost_lines_day_idx on public.fit_quote_day_cost_lines(day_id, sort_order);
create index if not exists fit_quote_hotel_lines_quote_idx on public.fit_quote_hotel_lines(quote_id, sort_order);
create index if not exists fit_quote_flight_lines_quote_idx on public.fit_quote_flight_lines(quote_id, sort_order);

drop trigger if exists fit_day_template_cost_lines_updated_at on public.fit_day_template_cost_lines;
create trigger fit_day_template_cost_lines_updated_at
before update on public.fit_day_template_cost_lines
for each row execute function public.set_updated_at();

drop trigger if exists fit_quote_day_cost_lines_updated_at on public.fit_quote_day_cost_lines;
create trigger fit_quote_day_cost_lines_updated_at
before update on public.fit_quote_day_cost_lines
for each row execute function public.set_updated_at();

drop trigger if exists fit_quote_hotel_lines_updated_at on public.fit_quote_hotel_lines;
create trigger fit_quote_hotel_lines_updated_at
before update on public.fit_quote_hotel_lines
for each row execute function public.set_updated_at();

drop trigger if exists fit_quote_flight_lines_updated_at on public.fit_quote_flight_lines;
create trigger fit_quote_flight_lines_updated_at
before update on public.fit_quote_flight_lines
for each row execute function public.set_updated_at();

alter table public.fit_day_template_cost_lines enable row level security;
alter table public.fit_quote_day_cost_lines enable row level security;
alter table public.fit_quote_hotel_lines enable row level security;
alter table public.fit_quote_flight_lines enable row level security;

drop policy if exists "staff manage fit day template cost lines" on public.fit_day_template_cost_lines;
create policy "staff manage fit day template cost lines" on public.fit_day_template_cost_lines
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage fit quote day cost lines" on public.fit_quote_day_cost_lines;
create policy "staff manage fit quote day cost lines" on public.fit_quote_day_cost_lines
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage fit quote hotel lines" on public.fit_quote_hotel_lines;
create policy "staff manage fit quote hotel lines" on public.fit_quote_hotel_lines
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage fit quote flight lines" on public.fit_quote_flight_lines;
create policy "staff manage fit quote flight lines" on public.fit_quote_flight_lines
for all using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "public read shared fit quotes" on public.fit_quotes;
create policy "public read shared fit quotes" on public.fit_quotes
for select using (share_enabled = true and share_token is not null);

drop policy if exists "public update shared fit quote response" on public.fit_quotes;
create policy "public update shared fit quote response" on public.fit_quotes
for update using (share_enabled = true and share_token is not null)
with check (share_enabled = true and share_token is not null);

drop policy if exists "public read shared fit quote days" on public.fit_quote_days;
create policy "public read shared fit quote days" on public.fit_quote_days
for select using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_days.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read visible shared fit quote day lines" on public.fit_quote_day_cost_lines;
create policy "public read visible shared fit quote day lines" on public.fit_quote_day_cost_lines
for select using (
  is_client_visible = true
  and exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_day_cost_lines.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

grant select on public.fit_quotes, public.fit_quote_days, public.fit_quote_day_cost_lines to anon, authenticated;
grant update(status, client_notes, accepted_at, requested_changes_at, updated_at) on public.fit_quotes to anon, authenticated;

with templates(title, city, theme, description_client, transport_type, guide_required, tags) as (
  values
    ('Tokyo Arrival Transfer', 'Tokyo', 'Arrivée', 'Accueil à Tokyo et transfert privé vers l’hôtel.', 'private_transfer', false, '["Tokyo","Arrivée","Transfer"]'::jsonb),
    ('Meiji Harajuku Shibuya', 'Tokyo', 'Tokyo moderne', 'Découverte de Meiji Jingu, Harajuku et Shibuya.', 'metro', true, '["Tokyo","Shibuya","Harajuku"]'::jsonb),
    ('Tokyo Tower Odaiba TeamLab', 'Tokyo', 'Art digital', 'Tokyo Tower, Odaiba et expérience immersive TeamLab.', 'metro', true, '["Tokyo","Odaiba","TeamLab"]'::jsonb),
    ('Asakusa Akihabara', 'Tokyo', 'Tradition et pop culture', 'Asakusa, Senso-ji et Akihabara.', 'metro', true, '["Tokyo","Asakusa","Akihabara"]'::jsonb),
    ('Tokyo Kyoto transfer', 'Tokyo / Kyoto', 'Transfert', 'Transfert entre Tokyo et Kyoto en train.', 'train', false, '["Tokyo","Kyoto","Train"]'::jsonb),
    ('Kyoto temples', 'Kyoto', 'Tradition', 'Journée temples à Kyoto.', 'public_transport', true, '["Kyoto","Temples"]'::jsonb),
    ('Hiroshima Miyajima', 'Hiroshima', 'Histoire', 'Hiroshima, musée de la paix, ferry et Miyajima.', 'train_ferry', true, '["Hiroshima","Miyajima"]'::jsonb),
    ('Nara', 'Nara', 'Patrimoine', 'Excursion à Nara et ses temples.', 'train', true, '["Nara","Patrimoine"]'::jsonb),
    ('Kyoto Tokyo transfer', 'Kyoto / Tokyo', 'Transfert', 'Retour entre Kyoto et Tokyo en train.', 'train', false, '["Kyoto","Tokyo","Train"]'::jsonb)
)
insert into public.fit_day_templates (
  title, city, theme, duration, description_client, included_visits, optional_visits, transport_type,
  guide_required, hotel_night, estimated_cost_mad, default_selling_price_mad, margin_percent, tags, is_active, metadata
)
select
  title, city, theme, '1 journée', description_client, '[]'::jsonb, '[]'::jsonb, transport_type,
  guide_required, true, 0, 0, 20, tags, true, '{"seeded_by":"fit_excel_workflow_v2"}'::jsonb
from templates t
where not exists (
  select 1 from public.fit_day_templates existing
  where lower(existing.title) = lower(t.title)
);

with seed_lines(template_title, sort_order, category, label, price_mad, quantity, times, fee_type, percentage_rate, is_client_visible) as (
  values
    ('Tokyo Arrival Transfer', 1, 'transport', 'Transfer airport - hotel', 9000, 1, 1, 'fixed', 0, false),
    ('Tokyo Arrival Transfer', 2, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Meiji Harajuku Shibuya', 1, 'transport', 'Transport en métro', 80, 2, 1, 'fixed', 0, false),
    ('Meiji Harajuku Shibuya', 2, 'guide', 'Guide FR', 3600, 1, 1, 'fixed', 0, false),
    ('Meiji Harajuku Shibuya', 3, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Tokyo Tower Odaiba TeamLab', 1, 'transport', 'Transport métro', 120, 2, 1, 'fixed', 0, false),
    ('Tokyo Tower Odaiba TeamLab', 2, 'visit', 'Tokyo Tower', 180, 2, 1, 'fixed', 0, true),
    ('Tokyo Tower Odaiba TeamLab', 3, 'visit', 'TeamLab', 350, 2, 1, 'fixed', 0, true),
    ('Tokyo Tower Odaiba TeamLab', 4, 'guide', 'Guide FR', 3600, 1, 1, 'fixed', 0, false),
    ('Tokyo Tower Odaiba TeamLab', 5, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Asakusa Akihabara', 1, 'transport', 'Transport métro', 100, 2, 1, 'fixed', 0, false),
    ('Asakusa Akihabara', 2, 'guide', 'Guide FR', 3600, 1, 1, 'fixed', 0, false),
    ('Asakusa Akihabara', 3, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Tokyo Kyoto transfer', 1, 'transport', 'Train Tokyo - Kyoto', 950, 2, 1, 'fixed', 0, false),
    ('Tokyo Kyoto transfer', 2, 'luggage', 'Transfert bagages', 220, 2, 1, 'fixed', 0, false),
    ('Tokyo Kyoto transfer', 3, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Kyoto temples', 1, 'transport', 'Transport local', 100, 2, 1, 'fixed', 0, false),
    ('Kyoto temples', 2, 'visit', 'Entrées temples', 120, 2, 1, 'fixed', 0, true),
    ('Kyoto temples', 3, 'guide', 'Guide FR', 4200, 1, 1, 'fixed', 0, false),
    ('Kyoto temples', 4, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Hiroshima Miyajima', 1, 'transport', 'Transport Hiroshima', 160, 2, 1, 'fixed', 0, false),
    ('Hiroshima Miyajima', 2, 'visit', 'Musée de la bombe', 20, 2, 1, 'fixed', 0, true),
    ('Hiroshima Miyajima', 3, 'transport', 'Ferry Miyajima', 20, 2, 1, 'fixed', 0, false),
    ('Hiroshima Miyajima', 4, 'visit', 'Taxe de Miyajima', 10, 2, 1, 'fixed', 0, true),
    ('Hiroshima Miyajima', 5, 'guide', 'Guide FR', 4500, 1, 1, 'fixed', 0, false),
    ('Hiroshima Miyajima', 6, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Nara', 1, 'transport', 'Train Kyoto - Nara', 130, 2, 1, 'fixed', 0, false),
    ('Nara', 2, 'visit', 'Entrées temples', 80, 2, 1, 'fixed', 0, true),
    ('Nara', 3, 'guide', 'Guide FR', 4200, 1, 1, 'fixed', 0, false),
    ('Nara', 4, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false),
    ('Kyoto Tokyo transfer', 1, 'transport', 'Train Kyoto - Tokyo', 950, 2, 1, 'fixed', 0, false),
    ('Kyoto Tokyo transfer', 2, 'luggage', 'Transfert bagages', 220, 2, 1, 'fixed', 0, false),
    ('Kyoto Tokyo transfer', 3, 'agency_fee', 'Frais d’agence', 0, 1, 1, 'percentage_day', 20, false)
)
insert into public.fit_day_template_cost_lines (
  template_id, sort_order, category, label, price_mad, quantity, times, subtotal_mad,
  fee_type, percentage_rate, is_client_visible, metadata
)
select
  t.id, s.sort_order, s.category, s.label, s.price_mad, s.quantity, s.times,
  case when s.fee_type = 'fixed' then s.price_mad * s.quantity * s.times else 0 end,
  s.fee_type, s.percentage_rate, s.is_client_visible, '{"seeded_by":"fit_excel_workflow_v2"}'::jsonb
from seed_lines s
join public.fit_day_templates t on lower(t.title) = lower(s.template_title)
where not exists (
  select 1 from public.fit_day_template_cost_lines existing
  where existing.template_id = t.id
    and lower(existing.label) = lower(s.label)
    and existing.category = s.category
);

notify pgrst, 'reload schema';
