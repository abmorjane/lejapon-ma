-- Supplier / Japan Office Quote Engine V1
-- Proposal only. Do not apply automatically.

alter table public.suppliers
  add column if not exists type text default 'supplier',
  add column if not exists status text not null default 'active',
  add column if not exists country text default 'Japan',
  add column if not exists languages text[] default '{}'::text[],
  add column if not exists website text,
  add column if not exists address text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.supplier_trip_quotes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','reviewed','approved','revision_requested','rejected','archived')),
  participant_count int not null default 0,
  commission_percentage numeric not null default 10,
  exchange_rate_jpy_mad numeric not null default 0,
  total_hotels_jpy numeric not null default 0,
  total_transport_jpy numeric not null default 0,
  total_activities_jpy numeric not null default 0,
  total_guides_jpy numeric not null default 0,
  total_other_jpy numeric not null default 0,
  grand_total_jpy numeric not null default 0,
  commission_amount_jpy numeric not null default 0,
  final_total_jpy numeric not null default 0,
  final_total_mad numeric not null default 0,
  cost_per_person_jpy numeric not null default 0,
  cost_per_person_mad numeric not null default 0,
  supplier_notes text,
  internal_notes text,
  admin_feedback text,
  created_by uuid,
  updated_by uuid,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_trip_quotes_trip on public.supplier_trip_quotes(trip_id);
create index if not exists idx_supplier_trip_quotes_supplier on public.supplier_trip_quotes(supplier_id);
create index if not exists idx_supplier_trip_quotes_status on public.supplier_trip_quotes(status);

create table if not exists public.supplier_quote_hotel_rows (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0,
  city text,
  hotel_name text,
  check_in date,
  check_out date,
  nights int not null default 1,
  room_type text,
  rooms_count int not null default 1,
  unit_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  comment text,
  assigned_to text,
  status text not null default 'todo' check (status in ('todo','pending','confirmed','issue')),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_transport_rows (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0,
  service_date date,
  day_number int,
  city_route text,
  transport_type text,
  description text,
  quantity numeric not null default 1,
  unit_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  comment text,
  assigned_to text,
  status text not null default 'todo' check (status in ('todo','pending','confirmed','issue')),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_activity_rows (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0,
  service_date date,
  activity_name text,
  quantity numeric not null default 1,
  unit_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  comment text,
  assigned_to text,
  status text not null default 'todo' check (status in ('todo','pending','confirmed','issue')),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_guide_rows (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0,
  service_date date,
  city text,
  guide_type text,
  guides_count int not null default 1,
  daily_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  comment text,
  assigned_to text,
  status text not null default 'todo' check (status in ('todo','pending','confirmed','issue')),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_other_rows (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0,
  label text,
  quantity numeric not null default 1,
  unit_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0,
  comment text,
  assigned_to text,
  status text not null default 'todo' check (status in ('todo','pending','confirmed','issue')),
  updated_at timestamptz not null default now()
);

create index if not exists idx_supplier_quote_hotel_rows_quote on public.supplier_quote_hotel_rows(quote_id, sort_order);
create index if not exists idx_supplier_quote_transport_rows_quote on public.supplier_quote_transport_rows(quote_id, sort_order);
create index if not exists idx_supplier_quote_activity_rows_quote on public.supplier_quote_activity_rows(quote_id, sort_order);
create index if not exists idx_supplier_quote_guide_rows_quote on public.supplier_quote_guide_rows(quote_id, sort_order);
create index if not exists idx_supplier_quote_other_rows_quote on public.supplier_quote_other_rows(quote_id, sort_order);

create table if not exists public.supplier_quote_comments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  row_table text,
  row_id uuid,
  visibility text not null default 'internal' check (visibility in ('internal','supplier')),
  body text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_quote_comments_quote on public.supplier_quote_comments(quote_id, created_at);

alter table public.supplier_trip_quotes enable row level security;
alter table public.supplier_quote_hotel_rows enable row level security;
alter table public.supplier_quote_transport_rows enable row level security;
alter table public.supplier_quote_activity_rows enable row level security;
alter table public.supplier_quote_guide_rows enable row level security;
alter table public.supplier_quote_other_rows enable row level security;
alter table public.supplier_quote_comments enable row level security;

drop policy if exists "staff manage supplier_trip_quotes" on public.supplier_trip_quotes;
create policy "staff manage supplier_trip_quotes"
on public.supplier_trip_quotes for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "supplier read own supplier_trip_quotes" on public.supplier_trip_quotes;
create policy "supplier read own supplier_trip_quotes"
on public.supplier_trip_quotes for select
using (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
  or public.supplier_can_access_trip(auth.uid(), trip_id)
);

drop policy if exists "supplier write own supplier_trip_quotes" on public.supplier_trip_quotes;
create policy "supplier write own supplier_trip_quotes"
on public.supplier_trip_quotes for all
using (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
  and status in ('draft','submitted','revision_requested')
)
with check (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
);

drop policy if exists "staff manage supplier quote hotel rows" on public.supplier_quote_hotel_rows;
create policy "staff manage supplier quote hotel rows" on public.supplier_quote_hotel_rows for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage supplier quote transport rows" on public.supplier_quote_transport_rows;
create policy "staff manage supplier quote transport rows" on public.supplier_quote_transport_rows for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage supplier quote activity rows" on public.supplier_quote_activity_rows;
create policy "staff manage supplier quote activity rows" on public.supplier_quote_activity_rows for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage supplier quote guide rows" on public.supplier_quote_guide_rows;
create policy "staff manage supplier quote guide rows" on public.supplier_quote_guide_rows for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage supplier quote other rows" on public.supplier_quote_other_rows;
create policy "staff manage supplier quote other rows" on public.supplier_quote_other_rows for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "supplier manage own supplier quote hotel rows" on public.supplier_quote_hotel_rows;
create policy "supplier manage own supplier quote hotel rows" on public.supplier_quote_hotel_rows for all
using (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid())) and q.status in ('draft','submitted','revision_requested')))
with check (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid()))));

drop policy if exists "supplier manage own supplier quote transport rows" on public.supplier_quote_transport_rows;
create policy "supplier manage own supplier quote transport rows" on public.supplier_quote_transport_rows for all
using (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid())) and q.status in ('draft','submitted','revision_requested')))
with check (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid()))));

drop policy if exists "supplier manage own supplier quote activity rows" on public.supplier_quote_activity_rows;
create policy "supplier manage own supplier quote activity rows" on public.supplier_quote_activity_rows for all
using (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid())) and q.status in ('draft','submitted','revision_requested')))
with check (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid()))));

drop policy if exists "supplier manage own supplier quote guide rows" on public.supplier_quote_guide_rows;
create policy "supplier manage own supplier quote guide rows" on public.supplier_quote_guide_rows for all
using (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid())) and q.status in ('draft','submitted','revision_requested')))
with check (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid()))));

drop policy if exists "supplier manage own supplier quote other rows" on public.supplier_quote_other_rows;
create policy "supplier manage own supplier quote other rows" on public.supplier_quote_other_rows for all
using (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid())) and q.status in ('draft','submitted','revision_requested')))
with check (exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid()))));

drop policy if exists "staff manage supplier_quote_comments" on public.supplier_quote_comments;
create policy "staff manage supplier_quote_comments" on public.supplier_quote_comments for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "supplier read supplier_quote_comments" on public.supplier_quote_comments;
create policy "supplier read supplier_quote_comments" on public.supplier_quote_comments for select
using (
  visibility = 'supplier'
  and exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid())))
);

drop policy if exists "supplier insert supplier_quote_comments" on public.supplier_quote_comments;
create policy "supplier insert supplier_quote_comments" on public.supplier_quote_comments for insert
with check (
  visibility = 'supplier'
  and exists (select 1 from public.supplier_trip_quotes q where q.id = quote_id and q.supplier_id in (select public.user_supplier_ids(auth.uid())))
);

notify pgrst, 'reload schema';
