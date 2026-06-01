-- Disaster Recovery Pack V1 - schema.sql
-- Generated: 2026-06-01T01:35:32.611Z
-- Source: local Supabase migrations plus current V2 recovery compatibility SQL.
-- Apply this to a fresh Supabase project from SQL editor or psql after enabling required extensions.
-- Excluded superseded local migrations: 20260529090000_v2_commission_engine_v1.sql


-- =====================================================================
-- Migration: 20260422170952_864df6ac-c613-45be-8ff8-3464e026d861.sql
-- =====================================================================
-- ============ ENUMS ============
create type public.app_role as enum ('admin', 'manager', 'agent', 'supplier');
create type public.booking_status as enum ('lead', 'confirmed', 'paid', 'cancelled', 'completed');
create type public.payment_status as enum ('pending', 'received', 'refunded');
create type public.trip_status as enum ('draft', 'open', 'closed', 'completed');
create type public.content_status as enum ('draft', 'published');

-- ============ AUTH / PROFILES / ROLES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

-- security definer role check (avoids RLS recursion)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('admin','manager','agent')
  )
$$;

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ============ TRIPS ============
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  season text,
  destination text,
  start_date date,
  end_date date,
  duration_days int,
  base_price_mad numeric(10,2) not null default 0,
  currency text not null default 'MAD',
  total_slots int not null default 12,
  slots_left int not null default 12,
  cover_url text,
  short_description text,
  long_description text,
  highlights text[],
  status trip_status not null default 'draft',
  is_featured boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.trips enable row level security;
create trigger trips_updated_at before update on public.trips for each row execute function public.set_updated_at();

create table public.itinerary_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_number int not null,
  city text,
  title text not null,
  description text,
  meals text,
  accommodation text,
  created_at timestamptz not null default now()
);
alter table public.itinerary_days enable row level security;

create table public.pricing_tiers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  description text,
  base_supplement_mad numeric(10,2) not null default 0,
  single_room_supplement_mad numeric(10,2) not null default 0,
  triple_room_discount_mad numeric(10,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.pricing_tiers enable row level security;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  city text,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;
create trigger suppliers_updated_at before update on public.suppliers for each row execute function public.set_updated_at();

create table public.trip_suppliers (
  trip_id uuid not null references public.trips(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  role text,
  primary key (trip_id, supplier_id)
);
alter table public.trip_suppliers enable row level security;

-- ============ EXTRAS ============
create table public.extras (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  category text,
  description text,
  price_mad numeric(10,2) not null default 0,
  city text,
  image_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.extras enable row level security;
create trigger extras_updated_at before update on public.extras for each row execute function public.set_updated_at();

-- ============ CRM / CLIENTS ============
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  city text,
  country text default 'Maroc',
  birthdate date,
  passport_number text,
  passport_expiry date,
  emergency_contact text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.client_notes enable row level security;

-- ============ BOOKINGS ============
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null default ('LJ-' || upper(substring(gen_random_uuid()::text from 1 for 6))),
  trip_id uuid references public.trips(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  -- snapshot fields (allow public lead form without client account)
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  contact_city text,
  num_adults int not null default 1,
  num_children int not null default 0,
  formula text,
  room_type text,
  preferred_dates text,
  message text,
  total_amount_mad numeric(10,2) not null default 0,
  paid_amount_mad numeric(10,2) not null default 0,
  status booking_status not null default 'lead',
  assigned_to uuid references auth.users(id),
  source text default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bookings enable row level security;
create trigger bookings_updated_at before update on public.bookings for each row execute function public.set_updated_at();

create table public.booking_extras (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  extra_id uuid references public.extras(id) on delete set null,
  name_snapshot text not null,
  qty int not null default 1,
  unit_price_mad numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);
alter table public.booking_extras enable row level security;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  amount_mad numeric(10,2) not null,
  method text,
  status payment_status not null default 'pending',
  reference text,
  paid_at timestamptz,
  notes text,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;

-- ============ CONTENT ============
create table public.pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  meta_description text,
  status content_status not null default 'draft',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pages enable row level security;
create trigger pages_updated_at before update on public.pages for each row execute function public.set_updated_at();

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text,
  body text,
  cover_url text,
  category text,
  tags text[],
  status content_status not null default 'draft',
  published_at timestamptz,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.articles enable row level security;
create trigger articles_updated_at before update on public.articles for each row execute function public.set_updated_at();

create table public.media (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  url text not null,
  mime_type text,
  size_bytes bigint,
  width int,
  height int,
  alt text,
  tags text[],
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.media enable row level security;

-- ============ STORAGE BUCKET ============
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- ============ RLS POLICIES ============

-- profiles
create policy "anyone authenticated can read profiles"
  on public.profiles for select using (auth.uid() is not null);
create policy "users update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "users insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- user_roles
create policy "users see own roles"
  on public.user_roles for select using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "admins manage roles"
  on public.user_roles for all using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));

-- trips: public read open/completed, staff full
create policy "public read open trips"
  on public.trips for select using (status in ('open','completed') or public.is_staff(auth.uid()));
create policy "staff manage trips"
  on public.trips for all using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- itinerary, pricing, trip_suppliers: same as trips
create policy "public read itinerary" on public.itinerary_days for select
  using (exists (select 1 from public.trips t where t.id = trip_id and (t.status in ('open','completed') or public.is_staff(auth.uid()))));
create policy "staff manage itinerary" on public.itinerary_days for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "public read pricing" on public.pricing_tiers for select
  using (exists (select 1 from public.trips t where t.id = trip_id and (t.status in ('open','completed') or public.is_staff(auth.uid()))));
create policy "staff manage pricing" on public.pricing_tiers for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "staff read suppliers" on public.suppliers for select using (public.is_staff(auth.uid()));
create policy "staff manage suppliers" on public.suppliers for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "staff read trip_suppliers" on public.trip_suppliers for select using (public.is_staff(auth.uid()));
create policy "staff manage trip_suppliers" on public.trip_suppliers for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- extras: public read active, staff full
create policy "public read active extras" on public.extras for select
  using (is_active = true or public.is_staff(auth.uid()));
create policy "staff manage extras" on public.extras for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- clients: staff only
create policy "staff read clients" on public.clients for select using (public.is_staff(auth.uid()));
create policy "staff manage clients" on public.clients for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "staff read client_notes" on public.client_notes for select using (public.is_staff(auth.uid()));
create policy "staff manage client_notes" on public.client_notes for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- bookings: public can insert leads, staff manage all
create policy "public insert lead booking" on public.bookings for insert
  with check (status = 'lead');
create policy "staff read bookings" on public.bookings for select using (public.is_staff(auth.uid()));
create policy "staff update bookings" on public.bookings for update
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));
create policy "staff delete bookings" on public.bookings for delete using (public.is_staff(auth.uid()));

create policy "public insert booking extras" on public.booking_extras for insert
  with check (exists (select 1 from public.bookings b where b.id = booking_id and b.status = 'lead'));
create policy "staff read booking extras" on public.booking_extras for select using (public.is_staff(auth.uid()));
create policy "staff manage booking extras" on public.booking_extras for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

create policy "staff read payments" on public.payments for select using (public.is_staff(auth.uid()));
create policy "staff manage payments" on public.payments for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- pages: public read published, staff manage
create policy "public read published pages" on public.pages for select
  using (status = 'published' or public.is_staff(auth.uid()));
create policy "staff manage pages" on public.pages for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- articles: public read published, staff manage
create policy "public read published articles" on public.articles for select
  using (status = 'published' or public.is_staff(auth.uid()));
create policy "staff manage articles" on public.articles for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- media: public read, staff manage
create policy "public read media" on public.media for select using (true);
create policy "staff manage media" on public.media for all
  using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

-- storage policies for 'media' bucket
create policy "public read media bucket"
  on storage.objects for select using (bucket_id = 'media');
create policy "staff upload media"
  on storage.objects for insert with check (bucket_id = 'media' and public.is_staff(auth.uid()));
create policy "staff update media"
  on storage.objects for update using (bucket_id = 'media' and public.is_staff(auth.uid()));
create policy "staff delete media"
  on storage.objects for delete using (bucket_id = 'media' and public.is_staff(auth.uid()));

-- indexes
create index trips_status_idx on public.trips(status);
create index bookings_status_idx on public.bookings(status);
create index bookings_trip_idx on public.bookings(trip_id);
create index bookings_client_idx on public.bookings(client_id);
create index payments_booking_idx on public.payments(booking_id);
create index articles_status_idx on public.articles(status);
create index itinerary_trip_idx on public.itinerary_days(trip_id);
create index pricing_trip_idx on public.pricing_tiers(trip_id);

-- =====================================================================
-- Migration: 20260422171012_f32a1adc-4298-4425-a79c-a1b6cd11bc2f.sql
-- =====================================================================
-- 1. Fix search_path on set_updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- 2. Restrict listing on media bucket: keep direct read by URL but block list operations to staff
drop policy if exists "public read media bucket" on storage.objects;

create policy "staff list media bucket"
  on storage.objects for select
  using (bucket_id = 'media' and public.is_staff(auth.uid()));

-- Note: bucket remains public so files can be served by URL (e.g. <img src="https://.../media/xxx">),
-- but listing the contents requires staff role.

-- =====================================================================
-- Migration: 20260422171718_3c647fb6-c762-40a2-bbbe-57e231de52ac.sql
-- =====================================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'content_manager';

-- =====================================================================
-- Migration: 20260422171731_412c0d12-0faf-4449-935f-c49d7324105b.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role in ('super_admin','admin','manager','agent','content_manager')
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = ANY(_roles)
  )
$function$;

DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "super_admins manage roles"
ON public.user_roles FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "users see own roles" ON public.user_roles;
CREATE POLICY "read own or staff-admin reads all"
ON public.user_roles FOR SELECT
USING (
  auth.uid() = user_id
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'admin')
);

-- =====================================================================
-- Migration: 20260422172706_fafce42c-0a1e-4c1e-a88f-37cb27ea1dc5.sql
-- =====================================================================
-- Link auth users to a supplier company
create table public.supplier_members (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (supplier_id, user_id)
);

alter table public.supplier_members enable row level security;

-- Helper: list supplier_ids a user belongs to
create or replace function public.user_supplier_ids(_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select supplier_id from public.supplier_members where user_id = _user_id
$$;

-- Helper: can this user access this trip as a supplier?
create or replace function public.supplier_can_access_trip(_user_id uuid, _trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_suppliers ts
    join public.supplier_members sm on sm.supplier_id = ts.supplier_id
    where ts.trip_id = _trip_id and sm.user_id = _user_id
  )
$$;

-- RLS for supplier_members
create policy "staff manage supplier_members"
on public.supplier_members for all
using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

create policy "users read own supplier_members"
on public.supplier_members for select
using (auth.uid() = user_id or is_staff(auth.uid()));

-- Supplier day costs (per trip, per day)
create table public.supplier_day_costs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  day_number int not null,
  city text,
  nights int not null default 0,
  hotel_cost numeric not null default 0,
  transport_cost numeric not null default 0,
  guide_cost numeric not null default 0,
  activities_cost numeric not null default 0,
  meals_cost numeric not null default 0,
  total_cost numeric generated always as
    (coalesce(hotel_cost,0)+coalesce(transport_cost,0)+coalesce(guide_cost,0)+coalesce(activities_cost,0)+coalesce(meals_cost,0))
    stored,
  currency text not null default 'JPY',
  services text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, supplier_id, day_number)
);

create index idx_supplier_day_costs_trip on public.supplier_day_costs(trip_id);
create index idx_supplier_day_costs_supplier on public.supplier_day_costs(supplier_id);

create trigger trg_supplier_day_costs_updated
before update on public.supplier_day_costs
for each row execute function public.set_updated_at();

alter table public.supplier_day_costs enable row level security;

-- Staff full access
create policy "staff manage supplier_day_costs"
on public.supplier_day_costs for all
using (is_staff(auth.uid())) with check (is_staff(auth.uid()));

-- Suppliers read their own assigned trips' costs
create policy "supplier read own day_costs"
on public.supplier_day_costs for select
using (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

-- Suppliers insert for their own supplier on assigned trips
create policy "supplier insert own day_costs"
on public.supplier_day_costs for insert
with check (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

-- Suppliers update their own
create policy "supplier update own day_costs"
on public.supplier_day_costs for update
using (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
  and public.supplier_can_access_trip(auth.uid(), trip_id)
)
with check (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

-- Suppliers delete their own
create policy "supplier delete own day_costs"
on public.supplier_day_costs for delete
using (
  supplier_id in (select public.user_supplier_ids(auth.uid()))
  and public.supplier_can_access_trip(auth.uid(), trip_id)
);

-- Allow suppliers to read trips assigned to them (in addition to existing public/staff policies)
create policy "supplier read assigned trips"
on public.trips for select
using (public.supplier_can_access_trip(auth.uid(), id));

-- Allow suppliers to read trip_suppliers rows for their supplier
create policy "supplier read own trip_suppliers"
on public.trip_suppliers for select
using (supplier_id in (select public.user_supplier_ids(auth.uid())));

-- Allow suppliers to read their own supplier company row
create policy "supplier read own supplier"
on public.suppliers for select
using (id in (select public.user_supplier_ids(auth.uid())));

-- =====================================================================
-- Migration: 20260422173544_15b9c028-d737-4f7e-b908-331724cb8b83.sql
-- =====================================================================

-- 1. Add loyalty fields to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS trips_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rewards_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_tier text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS is_returning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_trip_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_trip_at timestamptz;

-- 2. Reward type enum
DO $$ BEGIN
  CREATE TYPE public.reward_type AS ENUM ('discount', 'free_activity', 'vip_upgrade');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reward_status AS ENUM ('available', 'used', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Client rewards table
CREATE TABLE IF NOT EXISTS public.client_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type public.reward_type NOT NULL,
  status public.reward_status NOT NULL DEFAULT 'available',
  label text NOT NULL,
  value_mad numeric NOT NULL DEFAULT 0,
  percent integer,
  granted_reason text,
  used_booking_id uuid,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_rewards_client ON public.client_rewards(client_id);
CREATE INDEX IF NOT EXISTS idx_client_rewards_status ON public.client_rewards(status);

ALTER TABLE public.client_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage client_rewards" ON public.client_rewards;
CREATE POLICY "staff manage client_rewards" ON public.client_rewards
  FOR ALL USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff read client_rewards" ON public.client_rewards;
CREATE POLICY "staff read client_rewards" ON public.client_rewards
  FOR SELECT USING (public.is_staff(auth.uid()));

CREATE TRIGGER trg_client_rewards_updated
  BEFORE UPDATE ON public.client_rewards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Recalculate loyalty function
CREATE OR REPLACE FUNCTION public.recalculate_client_loyalty(_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
  _first timestamptz;
  _last timestamptz;
  _tier text;
  _prev_tier text;
BEGIN
  SELECT count(*), min(created_at), max(updated_at)
    INTO _count, _first, _last
  FROM public.bookings
  WHERE client_id = _client_id AND status IN ('completed','paid');

  _tier := CASE
    WHEN _count >= 5 THEN 'gold'
    WHEN _count >= 3 THEN 'silver'
    WHEN _count >= 1 THEN 'bronze'
    ELSE 'none'
  END;

  SELECT loyalty_tier INTO _prev_tier FROM public.clients WHERE id = _client_id;

  UPDATE public.clients
    SET trips_completed = _count,
        is_returning = (_count >= 2),
        loyalty_tier = _tier,
        first_trip_at = COALESCE(first_trip_at, _first),
        last_trip_at = _last,
        updated_at = now()
    WHERE id = _client_id;

  -- Auto-grant a reward when newly eligible (returning client) and no available reward exists
  IF _count >= 2 AND _prev_tier IS DISTINCT FROM _tier THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.client_rewards
      WHERE client_id = _client_id AND status = 'available'
    ) THEN
      INSERT INTO public.client_rewards (client_id, type, label, percent, granted_reason)
      VALUES (
        _client_id,
        CASE WHEN _tier = 'gold' THEN 'vip_upgrade'
             WHEN _tier = 'silver' THEN 'free_activity'
             ELSE 'discount' END,
        CASE WHEN _tier = 'gold' THEN 'Surclassement VIP offert'
             WHEN _tier = 'silver' THEN 'Activité offerte'
             ELSE '10% sur le prochain voyage' END,
        CASE WHEN _tier = 'bronze' THEN 10 ELSE NULL END,
        'Atteinte du palier ' || _tier
      );
    END IF;
  END IF;
END;
$$;

-- 5. Trigger on bookings to auto-recalc
CREATE OR REPLACE FUNCTION public.bookings_loyalty_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_id IS NOT NULL AND NEW.status IN ('completed','paid') THEN
    PERFORM public.recalculate_client_loyalty(NEW.client_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_loyalty ON public.bookings;
CREATE TRIGGER trg_bookings_loyalty
  AFTER INSERT OR UPDATE OF status, client_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_loyalty_trigger();

-- =====================================================================
-- Migration: 20260422175112_4116d155-d666-4758-806e-2e08fa2392fb.sql
-- =====================================================================

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

-- =====================================================================
-- Migration: 20260422175125_676969a0-cff2-4d8e-b877-2de253191037.sql
-- =====================================================================
DROP POLICY IF EXISTS "anyone insert events" ON public.email_events;

-- =====================================================================
-- Migration: 20260422181027_b1c0cc73-e576-4560-a12d-25d6acc7da2a.sql
-- =====================================================================
-- Singleton-like table to store SMTP configuration editable from the admin
create table if not exists public.email_settings (
  id uuid primary key default gen_random_uuid(),
  smtp_host text not null default '',
  smtp_port integer not null default 465,
  smtp_secure text not null default 'ssl', -- 'ssl' | 'starttls' | 'none'
  smtp_username text not null default '',
  smtp_password text not null default '',
  from_email text not null default '',
  from_name text not null default '',
  reply_to text,
  is_active boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_settings enable row level security;

-- Only super_admin can read/write SMTP credentials
drop policy if exists "super_admin read email_settings" on public.email_settings;
create policy "super_admin read email_settings"
on public.email_settings for select
using (public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "super_admin manage email_settings" on public.email_settings;
create policy "super_admin manage email_settings"
on public.email_settings for all
using (public.has_role(auth.uid(), 'super_admin'))
with check (public.has_role(auth.uid(), 'super_admin'));

-- Updated_at trigger
drop trigger if exists set_email_settings_updated_at on public.email_settings;
create trigger set_email_settings_updated_at
before update on public.email_settings
for each row execute function public.set_updated_at();

-- Seed an empty row so admins can edit instead of insert (idempotent)
insert into public.email_settings (smtp_host, smtp_port, smtp_secure, from_email, from_name, is_active)
select '', 465, 'ssl', '', '', false
where not exists (select 1 from public.email_settings);

-- =====================================================================
-- Migration: 20260422185002_7c9effd4-b743-4c93-bccf-8ce2dc23fb83.sql
-- =====================================================================

-- Enums
CREATE TYPE public.visa_status AS ENUM ('draft','submitted','in_review','approved','rejected','completed');
CREATE TYPE public.visa_document_type AS ENUM ('passport','photo','employment','flight','hotel','other');

-- Settings (singleton)
CREATE TABLE public.visa_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guarantor_name text NOT NULL DEFAULT 'Moroccan Express Travel & Events',
  guarantor_tel text NOT NULL DEFAULT '080-9980-3986',
  guarantor_address text NOT NULL DEFAULT '37-4 Saiinshuneicho, Ukyo-ku, Kyoto city 615-0005',
  guarantor_dob text,
  guarantor_sex text,
  guarantor_relationship text DEFAULT 'Travel agency / Tour operator',
  guarantor_profession text DEFAULT 'Travel agency',
  guarantor_nationality text DEFAULT 'Japanese',
  inviter_same_as_guarantor boolean NOT NULL DEFAULT true,
  inviter_name text,
  inviter_tel text,
  inviter_address text,
  inviter_dob text,
  inviter_sex text,
  inviter_relationship text,
  inviter_profession text,
  inviter_nationality text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visa_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authenticated read visa_settings"
  ON public.visa_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "super_admin manage visa_settings"
  ON public.visa_settings FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER trg_visa_settings_updated
  BEFORE UPDATE ON public.visa_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.visa_settings (id) VALUES (gen_random_uuid());

-- Applications
CREATE TABLE public.visa_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  booking_id uuid,
  status public.visa_status NOT NULL DEFAULT 'draft',
  reference text NOT NULL DEFAULT ('VISA-' || upper(substring(gen_random_uuid()::text from 1 for 6))),

  -- Identity
  surname text,
  given_names text,
  other_names text,
  date_of_birth date,
  place_of_birth_city text,
  place_of_birth_state text,
  place_of_birth_country text,
  sex text,
  marital_status text,
  nationality text,
  former_nationality text,
  national_id_no text,

  -- Passport
  passport_type text DEFAULT 'ordinary',
  passport_no text,
  passport_place_of_issue text,
  passport_date_of_issue date,
  passport_issuing_authority text,
  passport_date_of_expiry date,
  certificate_of_eligibility_no text,

  -- Travel
  purpose_of_visit text,
  intended_length_of_stay text,
  date_of_arrival date,
  port_of_entry text,
  airline_or_ship text,

  -- Stay
  hotel_name text,
  hotel_tel text,
  hotel_address text,
  previous_stays text,

  -- Residence
  residential_address text,
  residential_tel text,
  residential_mobile text,
  residential_email text,

  -- Profession
  profession text,
  employer_name text,
  employer_tel text,
  employer_address text,
  partner_profession text,

  -- Declarations (questions)
  q_convicted_crime boolean NOT NULL DEFAULT false,
  q_imprisoned_1y boolean NOT NULL DEFAULT false,
  q_deported boolean NOT NULL DEFAULT false,
  q_drug_offence boolean NOT NULL DEFAULT false,
  q_prostitution boolean NOT NULL DEFAULT false,
  q_trafficking boolean NOT NULL DEFAULT false,
  declarations_details text,
  remarks text,

  consent_truthful boolean NOT NULL DEFAULT false,
  consent_data boolean NOT NULL DEFAULT false,
  date_of_application date,

  admin_notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visa_applications_user ON public.visa_applications(user_id);
CREATE INDEX idx_visa_applications_status ON public.visa_applications(status);

ALTER TABLE public.visa_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own visa_applications"
  ON public.visa_applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users read own visa_applications"
  ON public.visa_applications FOR SELECT
  USING (auth.uid() = user_id OR is_staff(auth.uid()));

CREATE POLICY "users update own draft visa_applications"
  ON public.visa_applications FOR UPDATE
  USING (auth.uid() = user_id AND status = 'draft')
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users delete own draft visa_applications"
  ON public.visa_applications FOR DELETE
  USING (auth.uid() = user_id AND status = 'draft');

CREATE POLICY "staff manage visa_applications"
  ON public.visa_applications FOR ALL
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER trg_visa_applications_updated
  BEFORE UPDATE ON public.visa_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Documents
CREATE TABLE public.visa_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.visa_applications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  doc_type public.visa_document_type NOT NULL DEFAULT 'passport',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visa_documents_application ON public.visa_documents(application_id);

ALTER TABLE public.visa_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own visa_documents"
  ON public.visa_documents FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.visa_applications a WHERE a.id = application_id AND a.user_id = auth.uid())
  );

CREATE POLICY "users read own visa_documents"
  ON public.visa_documents FOR SELECT
  USING (auth.uid() = user_id OR is_staff(auth.uid()));

CREATE POLICY "users delete own draft visa_documents"
  ON public.visa_documents FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.visa_applications a WHERE a.id = application_id AND a.user_id = auth.uid() AND a.status = 'draft')
  );

CREATE POLICY "staff manage visa_documents"
  ON public.visa_documents FOR ALL
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('visa-docs', 'visa-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies — users access only their own folder (named after their auth uid)
CREATE POLICY "users upload own visa-docs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'visa-docs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "users read own visa-docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'visa-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid()))
  );

CREATE POLICY "users delete own visa-docs"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'visa-docs'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR is_staff(auth.uid()))
  );

-- =====================================================================
-- Migration: 20260422192719_1f644b22-964f-4763-97d4-bd1aa664a0f0.sql
-- =====================================================================
ALTER TABLE public.visa_applications
ADD COLUMN IF NOT EXISTS consent_disclaimer boolean NOT NULL DEFAULT false;

-- =====================================================================
-- Migration: 20260422192953_ec8e278d-5916-4554-b81d-9a8707184340.sql
-- =====================================================================
-- Add new status to track when admin has acknowledged document receipt
ALTER TYPE public.visa_status ADD VALUE IF NOT EXISTS 'documents_received' BEFORE 'in_review';

-- Allow users to upload additional documents to their applications
-- regardless of status (draft, submitted, in_review, etc.) — but never delete after submission
DROP POLICY IF EXISTS "users insert own visa_documents" ON public.visa_documents;
CREATE POLICY "users insert own visa_documents"
ON public.visa_documents
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.visa_applications a
    WHERE a.id = visa_documents.application_id
      AND a.user_id = auth.uid()
      AND a.status <> 'completed'
      AND a.status <> 'rejected'
  )
);

-- =====================================================================
-- Migration: 20260422193314_843264c5-b0a5-40e5-a7de-31d6b47a6b34.sql
-- =====================================================================
ALTER TABLE public.visa_applications
ADD COLUMN IF NOT EXISTS requested_documents text,
ADD COLUMN IF NOT EXISTS documents_requested_at timestamptz;

-- =====================================================================
-- Migration: 20260422194752_0756ca59-083b-4683-9799-f7b83e9903e5.sql
-- =====================================================================

-- Add new visa workflow statuses
ALTER TYPE visa_status ADD VALUE IF NOT EXISTS 'awaiting_documents';
ALTER TYPE visa_status ADD VALUE IF NOT EXISTS 'submitted_to_embassy';

-- =====================================================================
-- Migration: 20260422194817_c3068f3b-93a8-4e4a-a886-96951b21fd53.sql
-- =====================================================================

-- Document checklist by category
CREATE TABLE IF NOT EXISTS public.visa_document_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.visa_document_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read active checklists"
  ON public.visa_document_checklists FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_active OR is_staff(auth.uid())));

CREATE POLICY "staff manage checklists"
  ON public.visa_document_checklists FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]));

CREATE TRIGGER trg_visa_checklists_updated_at
  BEFORE UPDATE ON public.visa_document_checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Link applications to a checklist category
ALTER TABLE public.visa_applications
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'tourism';

-- Seed default categories
INSERT INTO public.visa_document_checklists (category, label, description, items, sort_order) VALUES
  ('tourism', 'Visa Touristique', 'Documents requis pour un séjour touristique au Japon',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm récente fond blanc","Justificatif d''emploi (attestation de travail)","Relevés bancaires des 3 derniers mois","Réservation d''hôtel pour toute la durée du séjour","Réservation de vol aller-retour","Programme de voyage détaillé","Attestation d''assurance voyage"]'::jsonb, 1),
  ('business', 'Visa Affaires', 'Documents requis pour un voyage professionnel',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm récente fond blanc","Lettre d''invitation de l''entreprise au Japon","Lettre de mission de votre employeur","Attestation de travail","Réservation d''hôtel et de vol","Programme professionnel détaillé"]'::jsonb, 2),
  ('family_visit', 'Visite Familiale / Amis', 'Documents requis pour visiter un proche au Japon',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm fond blanc","Lettre d''invitation du garant au Japon","Copie passeport / titre de séjour du garant","Justificatif de lien (acte, photos, échanges)","Justificatifs financiers (vous ou garant)","Réservation de vol aller-retour"]'::jsonb, 3),
  ('student', 'Visa Étudiant / Court terme', 'Documents pour un séjour d''études court',
   '["Passeport original (validité min. 6 mois)","Photo d''identité 45×35mm fond blanc","Lettre d''admission de l''établissement","Justificatifs financiers","Programme d''études","Réservation hôtel / logement"]'::jsonb, 4)
ON CONFLICT (category) DO NOTHING;

-- =====================================================================
-- Migration: 20260422200131_fae5c89a-1e8f-402c-80f2-dae92a2e4a75.sql
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- =====================================================================
-- Migration: 20260422200157_ec594eac-b135-41b9-bb23-b992e159ac21.sql
-- =====================================================================
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove any previous version of the job (idempotent)
DO $$
DECLARE _jobid bigint;
BEGIN
  SELECT jobid INTO _jobid FROM cron.job WHERE jobname = 'visa-document-reminders-daily';
  IF _jobid IS NOT NULL THEN
    PERFORM cron.unschedule(_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'visa-document-reminders-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url:='https://nxnncbddtpjusrnhilxk.supabase.co/functions/v1/send-visa-reminders',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bm5jYmRkdHBqdXNybmhpbHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Njk5MjEsImV4cCI6MjA5MjQ0NTkyMX0.Y5MG6Gh-opGHemlK8OSAP0quoyV9NZ1XGuQJcjDX2mE"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  );
  $$
);

-- =====================================================================
-- Migration: 20260423201648_0978eca9-010b-4636-8d86-7758a0f33103.sql
-- =====================================================================
-- Newsletter subscribers table
CREATE TABLE public.newsletter_subscribers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'homepage',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Anyone can subscribe
CREATE POLICY "public can subscribe to newsletter"
ON public.newsletter_subscribers
FOR INSERT
WITH CHECK (true);

-- Only staff can read/manage
CREATE POLICY "staff read newsletter_subscribers"
ON public.newsletter_subscribers
FOR SELECT
USING (is_staff(auth.uid()));

CREATE POLICY "staff manage newsletter_subscribers"
ON public.newsletter_subscribers
FOR ALL
USING (is_staff(auth.uid()))
WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER set_newsletter_subscribers_updated_at
BEFORE UPDATE ON public.newsletter_subscribers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_newsletter_subscribers_email ON public.newsletter_subscribers(email);

-- =====================================================================
-- Migration: 20260423203933_ee47aca3-587c-4010-a82a-4aa3a2b31836.sql
-- =====================================================================
-- Programmes table
CREATE TABLE public.programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  duration text NOT NULL DEFAULT '',
  cities text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  days jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_url text,
  pdf_path text,
  is_published boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.programmes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read published programmes"
  ON public.programmes FOR SELECT
  USING (is_published = true OR public.is_staff(auth.uid()));

CREATE POLICY "staff manage programmes"
  ON public.programmes FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER programmes_set_updated_at
  BEFORE UPDATE ON public.programmes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket for PDFs (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('programme-pdfs', 'programme-pdfs', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read programme pdfs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'programme-pdfs');

CREATE POLICY "staff upload programme pdfs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'programme-pdfs' AND public.is_staff(auth.uid()));

CREATE POLICY "staff update programme pdfs"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'programme-pdfs' AND public.is_staff(auth.uid()));

CREATE POLICY "staff delete programme pdfs"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'programme-pdfs' AND public.is_staff(auth.uid()));

-- Seed both programmes
INSERT INTO public.programmes (slug, title, duration, cities, description, days, sort_order)
VALUES
  (
    'programme-1',
    'Programme 1 (17 jours)',
    '17 jours',
    ARRAY['Tokyo','Kamakura','Hakone','Kyoto','Hiroshima','Osaka','Tokyo'],
    'Une immersion complète au Japon en 17 jours, de Tokyo aux temples de Kyoto, en passant par Hakone, Hiroshima et Osaka, avant un retour à Tokyo.',
    '[]'::jsonb,
    1
  ),
  (
    'programme-2',
    'Programme 2 (13 jours)',
    '13 jours',
    ARRAY['Tokyo','Kamakura','Hakone','Kyoto','Hiroshima','Osaka'],
    'Un itinéraire condensé de 13 jours pour découvrir l''essentiel du Japon, de Tokyo à Osaka.',
    '[]'::jsonb,
    2
  );

-- =====================================================================
-- Migration: 20260424120003_e953aa0d-f5e9-4fe3-9359-0521a66b9bdc.sql
-- =====================================================================
-- Extend programmes with hero/intro fields
ALTER TABLE public.programmes
  ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS introduction text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS cta_label text NOT NULL DEFAULT 'Demander un devis',
  ADD COLUMN IF NOT EXISTS cta_url text NOT NULL DEFAULT '/contact',
  ADD COLUMN IF NOT EXISTS meta_description text;

-- Rich per-day table
CREATE TABLE IF NOT EXISTS public.programme_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  day_number integer NOT NULL,
  city text NOT NULL DEFAULT '',
  badge text,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  main_image_url text,
  gallery_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  included_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  icons jsonb NOT NULL DEFAULT '[]'::jsonb,
  special_note text,
  is_optional boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_programme_days_prog ON public.programme_days(programme_id, sort_order);

ALTER TABLE public.programme_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read active programme_days"
  ON public.programme_days FOR SELECT
  USING (
    is_active = true
    AND EXISTS (SELECT 1 FROM public.programmes p WHERE p.id = programme_id AND (p.is_published = true OR public.is_staff(auth.uid())))
    OR public.is_staff(auth.uid())
  );

CREATE POLICY "staff manage programme_days"
  ON public.programme_days FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER programme_days_set_updated
  BEFORE UPDATE ON public.programme_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket for programme images (hero + day photos)
INSERT INTO storage.buckets (id, name, public)
VALUES ('programme-images', 'programme-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read programme-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'programme-images');

CREATE POLICY "staff write programme-images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'programme-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff update programme-images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'programme-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff delete programme-images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'programme-images' AND public.is_staff(auth.uid()));

-- =====================================================================
-- Migration: 20260424161113_11813389-ad76-4db9-a923-c976bf4c680f.sql
-- =====================================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS badge_type text,
  ADD COLUMN IF NOT EXISTS badge_text text,
  ADD COLUMN IF NOT EXISTS destinations text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS program_link text,
  ADD COLUMN IF NOT EXISTS promo_percent integer,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_trips_sort_order ON public.trips(sort_order);
CREATE INDEX IF NOT EXISTS idx_trips_is_featured ON public.trips(is_featured);

-- =====================================================================
-- Migration: 20260424210533_cc46a9ef-53af-4adf-8428-a2999e73ed15.sql
-- =====================================================================

-- Catégories d'articles
CREATE TABLE IF NOT EXISTS public.article_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read article_categories"
  ON public.article_categories FOR SELECT USING (true);

CREATE POLICY "staff manage article_categories"
  ON public.article_categories FOR ALL
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- Seed des catégories par défaut
INSERT INTO public.article_categories (name, slug, sort_order) VALUES
  ('Cuisine', 'cuisine', 10),
  ('Culture', 'culture', 20),
  ('Études', 'etudes', 30),
  ('Histoire', 'histoire', 40),
  ('Kyoto', 'kyoto', 50),
  ('Non classé', 'non-classe', 60),
  ('Osaka', 'osaka', 70),
  ('Osaka Expo', 'osaka-expo', 80),
  ('Tokyo', 'tokyo', 90),
  ('Voyage', 'voyage', 100)
ON CONFLICT (name) DO NOTHING;

-- Colonnes additionnelles pour articles (SEO + galerie)
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS gallery_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS meta_title TEXT,
  ADD COLUMN IF NOT EXISTS meta_description TEXT,
  ADD COLUMN IF NOT EXISTS reading_time_minutes INTEGER;

-- Bucket public pour les images d'articles
INSERT INTO storage.buckets (id, name, public)
VALUES ('article-images', 'article-images', true)
ON CONFLICT (id) DO NOTHING;

-- Policies storage : lecture publique, écriture staff
CREATE POLICY "public read article-images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'article-images');

CREATE POLICY "staff upload article-images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'article-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff update article-images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'article-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff delete article-images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'article-images' AND public.is_staff(auth.uid()));

-- =====================================================================
-- Migration: 20260427175524_49e8df18-7c4b-4dd5-827e-24faccfb18e4.sql
-- =====================================================================

ALTER TABLE public.extras ADD COLUMN IF NOT EXISTS alt_text text;
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS cover_alt text;
ALTER TABLE public.programmes ADD COLUMN IF NOT EXISTS hero_alt text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cover_alt text;

-- =====================================================================
-- Migration: 20260511212325_36e46f77-513a-4169-8130-9f2d189bf142.sql
-- =====================================================================

CREATE TABLE public.route_slugs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_key text NOT NULL UNIQUE,
  label text NOT NULL,
  slug text NOT NULL UNIQUE,
  default_slug text NOT NULL,
  is_editable boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.route_slugs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read route_slugs" ON public.route_slugs
  FOR SELECT USING (true);

CREATE POLICY "staff manage route_slugs" ON public.route_slugs
  FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER route_slugs_updated_at
  BEFORE UPDATE ON public.route_slugs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.route_slugs (route_key, label, slug, default_slug, sort_order) VALUES
  ('trips',       'Voyages',        'voyages',     'voyages',     1),
  ('experiences', 'Expériences',    'experiences', 'experiences', 2),
  ('about',       'À propos',       'a-propos',    'a-propos',    3),
  ('journal',     'Journal',        'journal',     'journal',     4),
  ('blog',        'Blog',           'blog',        'blog',        5),
  ('contact',     'Contact',        'contact',     'contact',     6),
  ('booking',     'Réservation',    'reserver',    'reserver',    7),
  ('programme',   'Programme',      'programme',   'programme',   8),
  ('visa',        'Visa Japon',     'visa',        'visa',        9);

-- =====================================================================
-- Migration: 20260511231142_3ce1e2e8-2589-4036-afa0-63717e92ba87.sql
-- =====================================================================
UPDATE public.route_slugs SET slug = 'formulaire-visa', default_slug = 'formulaire-visa' WHERE route_key = 'visa';

-- =====================================================================
-- Migration: 20260511233121_6bab02f6-8556-4562-b519-45c776371a0d.sql
-- =====================================================================
DELETE FROM public.route_slugs WHERE route_key='journal';

-- =====================================================================
-- Migration: 20260512144338_5165bf89-afa2-4a7f-a57e-c3ea9dcb79d7.sql
-- =====================================================================

-- Add registered trip info to clients (latest trip the client signed up for)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS last_trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_trip_label text;

-- Booking documents history (quotes & receipts)
CREATE TABLE IF NOT EXISTS public.booking_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quote','receipt')),
  number text NOT NULL,
  storage_path text NOT NULL,
  total_mad numeric,
  paid_mad numeric,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_documents_booking ON public.booking_documents(booking_id);

ALTER TABLE public.booking_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read booking_documents" ON public.booking_documents;
CREATE POLICY "staff read booking_documents" ON public.booking_documents
  FOR SELECT USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff insert booking_documents" ON public.booking_documents;
CREATE POLICY "staff insert booking_documents" ON public.booking_documents
  FOR INSERT WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin delete booking_documents" ON public.booking_documents;
CREATE POLICY "admin delete booking_documents" ON public.booking_documents
  FOR DELETE USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]));

-- Private storage bucket for booking documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('booking-docs', 'booking-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for booking-docs (staff only)
DROP POLICY IF EXISTS "staff read booking-docs" ON storage.objects;
CREATE POLICY "staff read booking-docs" ON storage.objects
  FOR SELECT USING (bucket_id = 'booking-docs' AND public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff insert booking-docs" ON storage.objects;
CREATE POLICY "staff insert booking-docs" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'booking-docs' AND public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin delete booking-docs" ON storage.objects;
CREATE POLICY "admin delete booking-docs" ON storage.objects
  FOR DELETE USING (bucket_id = 'booking-docs' AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]));

-- Allow public booking form to upsert client with trip info
DROP POLICY IF EXISTS "public upsert client from booking" ON public.clients;
CREATE POLICY "public upsert client from booking" ON public.clients
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "public update client from booking" ON public.clients;
CREATE POLICY "public update client from booking" ON public.clients
  FOR UPDATE USING (true) WITH CHECK (true);

-- =====================================================================
-- Migration: 20260512230428_c7b235ea-83be-4877-a5af-14833bc3bdfb.sql
-- =====================================================================
CREATE TABLE public.booking_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  user_id uuid,
  user_email text,
  field text NOT NULL,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_audit_booking ON public.booking_audit_log(booking_id, created_at DESC);

ALTER TABLE public.booking_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read booking_audit_log"
ON public.booking_audit_log FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE POLICY "staff insert booking_audit_log"
ON public.booking_audit_log FOR INSERT
WITH CHECK (public.is_staff(auth.uid()));

-- =====================================================================
-- Migration: 20260513005626_48a4c210-6c5f-4c5c-82d3-d8a21264afc3.sql
-- =====================================================================

-- 1) RPC upsert client (anti-doublon par email puis téléphone)
CREATE OR REPLACE FUNCTION public.upsert_client_from_booking(
  _name text, _email text, _phone text, _city text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id uuid; _email_clean text; _phone_clean text;
BEGIN
  _email_clean := NULLIF(lower(trim(_email)), '');
  _phone_clean := NULLIF(trim(_phone), '');

  IF _email_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE lower(email) = _email_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _phone_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE phone = _phone_clean LIMIT 1;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.clients (full_name, email, phone, city, country, source)
    VALUES (COALESCE(NULLIF(trim(_name), ''), _email_clean, 'Client'),
            _email_clean, _phone_clean, NULLIF(trim(_city), ''), 'Maroc', 'booking_form')
    RETURNING id INTO _id;
  ELSE
    UPDATE public.clients SET
      full_name = COALESCE(NULLIF(trim(_name), ''), full_name),
      email     = COALESCE(_email_clean, email),
      phone     = COALESCE(_phone_clean, phone),
      city      = COALESCE(NULLIF(trim(_city), ''), city),
      updated_at = now()
    WHERE id = _id;
  END IF;

  RETURN _id;
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_client_from_booking(text,text,text,text) TO anon, authenticated;

-- 2) Trigger AFTER pour synchroniser stats client à chaque insert/update de booking
CREATE OR REPLACE FUNCTION public.bookings_sync_client_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _title text; _season text; _start date; _label text; _trip_id uuid;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Last trip = booking le plus récent du client
  SELECT b.trip_id INTO _trip_id
  FROM public.bookings b
  WHERE b.client_id = NEW.client_id
  ORDER BY b.created_at DESC LIMIT 1;

  IF _trip_id IS NOT NULL THEN
    SELECT title, season, start_date INTO _title, _season, _start
    FROM public.trips WHERE id = _trip_id;
    _label := COALESCE(NULLIF(_season, ''), _title);
    IF _start IS NOT NULL THEN
      _label := _label || ' — ' || to_char(_start, 'DD/MM/YYYY');
    END IF;
  END IF;

  UPDATE public.clients SET
    last_trip_id    = _trip_id,
    last_trip_label = _label,
    last_trip_at    = now(),
    trips_completed = (SELECT count(*) FROM public.bookings WHERE client_id = NEW.client_id),
    is_returning    = ((SELECT count(*) FROM public.bookings WHERE client_id = NEW.client_id) >= 2),
    updated_at      = now()
  WHERE id = NEW.client_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_sync_client_stats_trg ON public.bookings;
CREATE TRIGGER bookings_sync_client_stats_trg
AFTER INSERT OR UPDATE OF client_id, trip_id, total_amount_mad, paid_amount_mad, status
ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.bookings_sync_client_stats();

-- 3) Backfill: créer fiches client manquantes à partir des bookings existants
INSERT INTO public.clients (full_name, email, phone, city, country, source, created_at)
SELECT DISTINCT ON (lower(b.contact_email))
  COALESCE(NULLIF(trim(b.contact_name), ''), b.contact_email),
  lower(trim(b.contact_email)),
  NULLIF(trim(b.contact_phone), ''),
  NULLIF(trim(b.contact_city), ''),
  'Maroc',
  'backfill_booking',
  b.created_at
FROM public.bookings b
WHERE b.contact_email IS NOT NULL
  AND length(trim(b.contact_email)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE lower(c.email) = lower(trim(b.contact_email))
  )
ORDER BY lower(b.contact_email), b.created_at ASC;

-- 4) Lier les bookings orphelins à leur client (par email)
UPDATE public.bookings b
SET client_id = c.id
FROM public.clients c
WHERE b.client_id IS NULL
  AND b.contact_email IS NOT NULL
  AND lower(c.email) = lower(trim(b.contact_email));

-- 5) Recalcul stats pour tous les clients (one-shot)
UPDATE public.clients c SET
  trips_completed = sub.cnt,
  is_returning    = (sub.cnt >= 2),
  last_trip_id    = sub.last_trip_id,
  last_trip_label = sub.last_label,
  last_trip_at    = sub.last_at,
  updated_at      = now()
FROM (
  SELECT
    b.client_id,
    count(*) AS cnt,
    (array_agg(b.trip_id ORDER BY b.created_at DESC))[1] AS last_trip_id,
    max(b.created_at) AS last_at,
    (
      SELECT COALESCE(NULLIF(t.season, ''), t.title)
             || COALESCE(' — ' || to_char(t.start_date, 'DD/MM/YYYY'), '')
      FROM public.bookings b2
      LEFT JOIN public.trips t ON t.id = b2.trip_id
      WHERE b2.client_id = b.client_id
      ORDER BY b2.created_at DESC LIMIT 1
    ) AS last_label
  FROM public.bookings b
  WHERE b.client_id IS NOT NULL
  GROUP BY b.client_id
) sub
WHERE c.id = sub.client_id;

-- =====================================================================
-- Migration: 20260513011629_07229fd0-cb20-4b64-9838-4b0a4bbf6d43.sql
-- =====================================================================

-- ============================================================
-- 1. New role: marketing_manager
-- ============================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing_manager';

-- ============================================================
-- 2. Clients: marketing fields
-- ============================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS marketing_status text NOT NULL DEFAULT 'subscribed'
    CHECK (marketing_status IN ('subscribed','unsubscribed','bounced','complained')),
  ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_bounce_reason text,
  ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS clients_unsubscribe_token_idx ON public.clients(unsubscribe_token);
CREATE INDEX IF NOT EXISTS clients_marketing_status_idx ON public.clients(marketing_status);
CREATE INDEX IF NOT EXISTS clients_language_idx ON public.clients(language);

-- ============================================================
-- 3. Segments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.marketing_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff manage marketing_segments" ON public.marketing_segments;
CREATE POLICY "staff manage marketing_segments"
  ON public.marketing_segments FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_marketing_segments_updated
  BEFORE UPDATE ON public.marketing_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. Email campaigns: marketing fields
-- ============================================================
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS cta_url text,
  ADD COLUMN IF NOT EXISTS hero_image_url text,
  ADD COLUMN IF NOT EXISTS segment_id uuid REFERENCES public.marketing_segments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unsubscribed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounced_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_address text;

-- ============================================================
-- 5. Email templates: marketing fields
-- ============================================================
ALTER TABLE public.email_templates
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS cta_label text,
  ADD COLUMN IF NOT EXISTS cta_url text,
  ADD COLUMN IF NOT EXISTS hero_image_url text;

-- ============================================================
-- 6. Marketing settings: company info on email_settings
-- ============================================================
ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS company_name text NOT NULL DEFAULT 'lejapon.ma',
  ADD COLUMN IF NOT EXISTS company_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'smtp'
    CHECK (provider IN ('smtp','brevo','resend','mailgun','lovable'));

-- ============================================================
-- 7. Unified marketing contacts view (CRM + newsletter + visa)
-- ============================================================
CREATE OR REPLACE VIEW public.marketing_contacts_view AS
SELECT
  c.id                                            AS client_id,
  lower(c.email)                                  AS email,
  c.full_name                                     AS full_name,
  c.phone                                         AS phone,
  c.city                                          AS city,
  c.country                                       AS country,
  c.language                                      AS language,
  c.source                                        AS source,
  c.marketing_status                              AS marketing_status,
  c.unsubscribe_token                             AS unsubscribe_token,
  c.tags                                          AS tags,
  c.loyalty_tier                                  AS loyalty_tier,
  c.is_returning                                  AS is_returning,
  c.trips_completed                               AS trips_completed,
  c.last_trip_label                               AS last_trip_label,
  c.last_trip_at                                  AS last_trip_at,
  c.created_at                                    AS created_at
FROM public.clients c
WHERE c.email IS NOT NULL

UNION ALL

SELECT
  NULL::uuid                                      AS client_id,
  lower(n.email)                                  AS email,
  NULL::text                                      AS full_name,
  NULL::text                                      AS phone,
  NULL::text                                      AS city,
  'Maroc'::text                                   AS country,
  'fr'::text                                      AS language,
  COALESCE(n.source, 'newsletter')                AS source,
  CASE WHEN n.is_active THEN 'subscribed' ELSE 'unsubscribed' END AS marketing_status,
  NULL::uuid                                      AS unsubscribe_token,
  '{}'::text[]                                    AS tags,
  'none'::text                                    AS loyalty_tier,
  false                                           AS is_returning,
  0                                               AS trips_completed,
  NULL::text                                      AS last_trip_label,
  NULL::timestamptz                               AS last_trip_at,
  n.created_at                                    AS created_at
FROM public.newsletter_subscribers n
WHERE n.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.clients c2
    WHERE lower(c2.email) = lower(n.email)
  );

GRANT SELECT ON public.marketing_contacts_view TO authenticated;

-- ============================================================
-- 8. Function: resolve a segment to a list of recipients
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_marketing_segment(_segment_id uuid)
RETURNS TABLE(
  client_id uuid,
  email text,
  full_name text,
  language text,
  unsubscribe_token uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _filters jsonb;
BEGIN
  SELECT filters INTO _filters FROM public.marketing_segments WHERE id = _segment_id;
  IF _filters IS NULL THEN _filters := '{}'::jsonb; END IF;

  RETURN QUERY
  SELECT c.id, lower(c.email), c.full_name, c.language, c.unsubscribe_token
  FROM public.clients c
  WHERE c.email IS NOT NULL
    AND c.marketing_status = 'subscribed'
    AND (NOT (_filters ? 'language')   OR c.language = (_filters->>'language'))
    AND (NOT (_filters ? 'cities')     OR c.city = ANY (
          ARRAY(SELECT jsonb_array_elements_text(_filters->'cities'))))
    AND (NOT (_filters ? 'min_trips')  OR c.trips_completed >= (_filters->>'min_trips')::int)
    AND (NOT (_filters ? 'max_trips')  OR c.trips_completed <= (_filters->>'max_trips')::int)
    AND (NOT (_filters ? 'loyalty_tiers') OR c.loyalty_tier = ANY (
          ARRAY(SELECT jsonb_array_elements_text(_filters->'loyalty_tiers'))))
    AND (NOT (_filters ? 'sources')    OR c.source = ANY (
          ARRAY(SELECT jsonb_array_elements_text(_filters->'sources'))))
    AND (NOT (_filters ? 'tag')        OR (_filters->>'tag') = ANY(c.tags))
    AND (NOT (_filters ? 'returning_only') OR c.is_returning = true)
    AND (NOT (_filters ? 'has_unpaid_balance') OR EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.client_id = c.id
            AND b.paid_amount_mad < b.total_amount_mad
            AND b.status NOT IN ('cancelled')
        ))
    AND (NOT (_filters ? 'season') OR EXISTS (
          SELECT 1 FROM public.bookings b
          JOIN public.trips t ON t.id = b.trip_id
          WHERE b.client_id = c.id
            AND lower(coalesce(t.season,'')) LIKE '%' || lower(_filters->>'season') || '%'
        ))
    AND (NOT (_filters ? 'has_visa_request') OR EXISTS (
          SELECT 1 FROM public.visa_applications v
          WHERE v.user_id = c.id
        ));
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_marketing_segment(uuid) TO authenticated, anon;

-- ============================================================
-- 9. Function: unsubscribe by token (public, security definer)
-- ============================================================
CREATE OR REPLACE FUNCTION public.unsubscribe_marketing_by_token(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _email text; _name text;
BEGIN
  UPDATE public.clients
     SET marketing_status = 'unsubscribed',
         marketing_unsubscribed_at = now(),
         updated_at = now()
   WHERE unsubscribe_token = _token
   RETURNING email, full_name INTO _email, _name;

  IF _email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'email', _email, 'full_name', _name);
END $$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_marketing_by_token(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resubscribe_marketing_by_token(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _email text;
BEGIN
  UPDATE public.clients
     SET marketing_status = 'subscribed',
         marketing_unsubscribed_at = NULL,
         updated_at = now()
   WHERE unsubscribe_token = _token
   RETURNING email INTO _email;

  IF _email IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'email', _email);
END $$;

GRANT EXECUTE ON FUNCTION public.resubscribe_marketing_by_token(uuid) TO anon, authenticated;

-- ============================================================
-- 10. Helper: bulk recompute campaign stats from recipients
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_campaign_stats(_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.email_campaigns c
     SET total_recipients   = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id),
         sent_count         = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND status = 'sent'),
         failed_count       = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND status = 'failed'),
         open_count         = (SELECT coalesce(sum(open_count),0) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id),
         click_count        = (SELECT coalesce(sum(click_count),0) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id),
         unique_open_count  = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND first_opened_at IS NOT NULL),
         unique_click_count = (SELECT count(*) FROM public.email_campaign_recipients WHERE campaign_id = _campaign_id AND first_clicked_at IS NOT NULL),
         unsubscribed_count = (SELECT count(*) FROM public.email_events WHERE campaign_id = _campaign_id AND event_type = 'unsubscribed'),
         bounced_count      = (SELECT count(*) FROM public.email_events WHERE campaign_id = _campaign_id AND event_type = 'bounced'),
         updated_at = now()
   WHERE c.id = _campaign_id;
END $$;

GRANT EXECUTE ON FUNCTION public.recompute_campaign_stats(uuid) TO authenticated;

-- ============================================================
-- 11. Backfill: ensure all clients have unsubscribe_token
-- ============================================================
UPDATE public.clients SET unsubscribe_token = gen_random_uuid() WHERE unsubscribe_token IS NULL;

-- =====================================================================
-- Migration: 20260513011646_8915e288-b58d-4efb-a543-bd24dc7050d7.sql
-- =====================================================================

-- Use security_invoker so RLS of the calling user applies
ALTER VIEW public.marketing_contacts_view SET (security_invoker = true);

-- Restrict segment resolution to authenticated users only
REVOKE EXECUTE ON FUNCTION public.resolve_marketing_segment(uuid) FROM anon;

-- =====================================================================
-- Migration: 20260513013424_cf4af805-a2d3-4bb3-96b5-6dc5ab93e881.sql
-- =====================================================================
-- Add 'sending' to recipient_status enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'recipient_status' AND e.enumlabel = 'sending'
  ) THEN
    ALTER TYPE recipient_status ADD VALUE 'sending' BEFORE 'sent';
  END IF;
END $$;

-- Indexes for queue dispatcher
CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign_status
  ON public.email_campaign_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_status_sched
  ON public.email_campaigns (status, scheduled_at);

-- =====================================================================
-- Migration: 20260513013441_e0f3c2ca-cd74-45b0-b07d-2317ac0a5071.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.claim_marketing_batch(_campaign_id uuid, _limit integer)
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  client_id uuid,
  tracking_token text,
  unsubscribe_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT r.id
    FROM public.email_campaign_recipients r
    WHERE r.campaign_id = _campaign_id
      AND r.status = 'pending'
    ORDER BY r.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT _limit
  ),
  upd AS (
    UPDATE public.email_campaign_recipients r
       SET status = 'sending'
      FROM picked p
     WHERE r.id = p.id
    RETURNING r.id, r.email, r.full_name, r.client_id, r.tracking_token
  )
  SELECT u.id, u.email, u.full_name, u.client_id, u.tracking_token, c.unsubscribe_token
    FROM upd u
    LEFT JOIN public.clients c ON c.id = u.client_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.claim_marketing_batch(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketing_batch(uuid, integer) TO service_role;

-- =====================================================================
-- Migration: 20260513021857_80f08583-52ac-40fd-a74c-e6d6c25854c0.sql
-- =====================================================================

-- Enum for FAQ categories
DO $$ BEGIN
  CREATE TYPE public.faq_category AS ENUM ('voyage','prix_reservation','visa','organisation','conseils_pratiques');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category public.faq_category NOT NULL DEFAULT 'voyage',
  question_fr text NOT NULL,
  answer_fr text NOT NULL,
  question_en text,
  answer_en text,
  question_ar text,
  answer_ar text,
  meta_title_fr text,
  meta_description_fr text,
  meta_title_en text,
  meta_description_en text,
  meta_title_ar text,
  meta_description_ar text,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read published faqs" ON public.faqs;
CREATE POLICY "public read published faqs" ON public.faqs
  FOR SELECT USING (is_published = true OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage faqs" ON public.faqs;
CREATE POLICY "staff manage faqs" ON public.faqs
  FOR ALL USING (
    public.has_any_role(auth.uid(), ARRAY['super_admin','admin','content_manager']::app_role[])
  ) WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['super_admin','admin','content_manager']::app_role[])
  );

DROP TRIGGER IF EXISTS faqs_set_updated_at ON public.faqs;
CREATE TRIGGER faqs_set_updated_at BEFORE UPDATE ON public.faqs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS faqs_sort_idx ON public.faqs (sort_order, created_at);
CREATE INDEX IF NOT EXISTS faqs_category_idx ON public.faqs (category);

-- Seed initial FR FAQs (only if table is empty)
INSERT INTO public.faqs (category, question_fr, answer_fr, sort_order)
SELECT * FROM (VALUES
  ('voyage'::public.faq_category, 'Le voyage est pour combien de jours ?',
   '15 jours, 8 jours à Tokyo et 7 jours dans la région Kansai entre Kyoto, Hiroshima et Osaka.', 10),
  ('voyage', 'Quelles sont les dates du voyage ?',
   E'Pour la saison printanière, le départ est entre le 15 et le 20 mars, et le retour entre le 1er et le 5 avril.\n\nPour la saison estivale, le départ est entre le 6 et le 22 juillet, et le retour entre le 20 juillet et le 9 août.\n\nPour la saison d''automne, le départ est entre le 20 octobre et le 9 novembre, et le retour entre le 9 et le 24 novembre.', 20),
  ('voyage', 'On va partir avec quelle compagnie aérienne ?',
   E'Il n''y a pas de vol direct du Maroc vers le Japon. Nous avons sélectionné le meilleur service aérien avec le minimum de temps d''escale possible : départ de Casablanca à destination de Tokyo avec Emirates ou Etihad.', 30),
  ('voyage', 'Quels sont les endroits que l''on va visiter ?',
   E'8 jours pour visiter Tokyo et ses environs (Asakusa, Shinjuku, Shibuya, Odaiba, Akihabara, Kamakura, Mont Fuji…) et 7 jours pour découvrir la région du Kansai (Kyoto, Osaka, Nara et Hiroshima).', 40),
  ('organisation', 'Quel type d''hôtels ?',
   E'À Tokyo, hôtel 4★ devant la gare de Shinagawa. À Kyoto, hôtel 4★ sur la fameuse avenue Gion « Shijo dori ». À Osaka, hôtel 4★ devant la gare principale d''Umeda. Tous les hôtels sont choisis pour la qualité de leurs prestations et pour leur emplacement stratégique, accessible facilement en transport en commun.', 50),
  ('prix_reservation', 'Qu''est-ce qui est compris dans le prix du voyage ?',
   E'Le prix comprend vos transferts, votre logement, votre transport, vos visites et vos repas (petit-déjeuners et déjeuners mentionnés dans le programme).\n\nLes frais du voyage sont des frais de groupe : si vous souhaitez profiter d''une journée ou deux en dehors du programme, nous ne pourrons pas prendre en charge vos dépenses.', 60),
  ('organisation', 'Quel moyen de transport entre les villes ?',
   E'Les transports entre les villes se font par Shinkansen (TGV).\n\nPour un maximum de confort, vous avez la possibilité d''envoyer votre bagage d''un hôtel à l''autre par voie express, à un prix variant entre 150 MAD et 300 MAD par valise et par envoi (Tokyo → Kyoto : 150 MAD, Kyoto → Osaka : 150 MAD, Osaka → aéroport de Tokyo : 300 MAD).\n\nCes frais ne sont pas inclus dans le prix total du voyage. Vous pouvez les régler à l''avance lors de votre inscription, ou directement sur place à la réception de l''hôtel.', 70),
  ('prix_reservation', 'Comment puis-je faire ma réservation ?',
   E'Si vous êtes intéressé par ce voyage, remplissez le formulaire d''inscription et effectuez un premier paiement de 50 % du prix total (le prix vous correspondant s''affiche à la fin du formulaire). Le reliquat est à payer après réception du visa.', 80),
  ('prix_reservation', 'Le prix de ma réservation peut-il changer ?',
   E'Oui. Si vous ne réglez pas une avance de 50 % du total du prix du voyage, vous pouvez recevoir une notification par e-mail vous informant d''une augmentation du prix de votre réservation.', 90),
  ('prix_reservation', 'Puis-je bénéficier d''une réduction ?',
   E'Oui. Vous bénéficiez d''une réduction de 2 % sur le prix total de votre réservation (hors activités) si vous validez votre réservation par le règlement de la somme totale du voyage 6 mois avant le départ.', 100),
  ('prix_reservation', 'Si j''annule mon voyage, puis-je récupérer mon argent ?',
   E'Jusqu''à 3 mois avant la date du voyage, vous pouvez récupérer la totalité de vos paiements. Deux mois avant la date, vous pouvez récupérer 50 % de vos paiements. Au-delà, le voyage est confirmé et il ne sera plus possible de vous rembourser.', 110),
  ('visa', 'Ai-je besoin d''un visa pour aller au Japon ?',
   E'Si vous êtes de nationalité marocaine, oui. Notre équipe se charge de déposer votre dossier à l''ambassade du Japon à Rabat. Le délai est de deux semaines à partir du jour du dépôt. Le coût est de 215 MAD à payer sur place.', 120),
  ('visa', 'Quels sont les documents nécessaires pour la demande de visa ?',
   E'Documents à fournir :\n1. Votre passeport\n2. Une photocopie de votre CIN (pas besoin qu''elle soit légalisée)\n3. Un formulaire à remplir\n4. Une photo avec un fond blanc\n5. Les 3 derniers relevés bancaires\n\nDes documents supplémentaires peuvent être demandés selon l''âge ou le métier du participant. Nous vous contacterons par e-mail ou par téléphone si nécessaire.', 130),
  ('visa', 'Quand puis-je vous envoyer mon dossier visa ?',
   'Vous pouvez nous envoyer votre dossier après confirmation du virement d''inscription au voyage.', 140),
  ('prix_reservation', 'Puis-je faire une réservation de dernière minute ?',
   E'Oui, dans la limite des places disponibles. Il faut prévoir une augmentation du prix du voyage de 10 % à 20 % à partir de deux mois avant la date du voyage.', 150),
  ('organisation', 'Combien y a-t-il de participants par voyage ?',
   E'Le nombre de participants varie entre 16 et 30 personnes par voyage. Si vous parrainez ce voyage avec un proche, vous pouvez demander une réduction de 2 % (dans la limite du possible) sur le total du prix du voyage, hors activités. (Offres non cumulables.)', 160),
  ('conseils_pratiques', 'Aurai-je besoin d''argent de poche, et combien ?',
   E'Le Japon est une destination lointaine et exotique : vous trouverez beaucoup de choses intéressantes. Pour un petit budget, 500 € suffisent pour de petits plaisirs. Pour un budget moyen à grand, prévoyez 1 000 € et plus par personne.', 170),
  ('organisation', 'Je ne vis pas au Maroc, puis-je participer ?',
   E'Oui. Faites-nous une demande par e-mail pour solliciter le prix du voyage hors vol. Un responsable vous accompagnera pour trouver un vol adéquat au départ du pays où vous vous trouvez, qui correspond aux dates du programme.', 180)
) AS v(category, question_fr, answer_fr, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.faqs);

-- =====================================================================
-- Migration: 20260513173409_a744a4d9-0e87-4017-a70b-3fa1d34d7577.sql
-- =====================================================================

-- booking_participants
CREATE TABLE public.booking_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  trip_id uuid,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  sex text,
  date_of_birth date,
  passport_no text,
  passport_issue_date date,
  passport_expiry date,
  client_type text,
  is_lead boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_participants_booking ON public.booking_participants(booking_id);
CREATE INDEX idx_booking_participants_trip ON public.booking_participants(trip_id);
ALTER TABLE public.booking_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage booking_participants" ON public.booking_participants FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE TRIGGER trg_bp_updated BEFORE UPDATE ON public.booking_participants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- trip_hotels
CREATE TABLE public.trip_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  name text NOT NULL,
  city text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trip_hotels_trip ON public.trip_hotels(trip_id);
ALTER TABLE public.trip_hotels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage trip_hotels" ON public.trip_hotels FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- trip_rooms
CREATE TABLE public.trip_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_hotel_id uuid NOT NULL REFERENCES public.trip_hotels(id) ON DELETE CASCADE,
  room_number text,
  room_type text NOT NULL DEFAULT 'twin',
  client_type text,
  capacity int NOT NULL DEFAULT 2,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trip_rooms_hotel ON public.trip_rooms(trip_hotel_id);
ALTER TABLE public.trip_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage trip_rooms" ON public.trip_rooms FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- room_assignments
CREATE TABLE public.room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.trip_rooms(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.booking_participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(participant_id)
);
CREATE INDEX idx_room_assignments_room ON public.room_assignments(room_id);
ALTER TABLE public.room_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage room_assignments" ON public.room_assignments FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- booking_participant_activities
CREATE TABLE public.booking_participant_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.booking_participants(id) ON DELETE CASCADE,
  extra_id uuid NOT NULL,
  is_selected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(participant_id, extra_id)
);
CREATE INDEX idx_bpa_participant ON public.booking_participant_activities(participant_id);
CREATE INDEX idx_bpa_extra ON public.booking_participant_activities(extra_id);
ALTER TABLE public.booking_participant_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage bpa" ON public.booking_participant_activities FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- trip_japan_payments
CREATE TABLE public.trip_japan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  paid_on date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'JPY',
  exchange_rate numeric NOT NULL DEFAULT 1,
  amount_mad numeric NOT NULL DEFAULT 0,
  method text,
  beneficiary text,
  comment text,
  receipt_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_japan_payments_trip ON public.trip_japan_payments(trip_id);
ALTER TABLE public.trip_japan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage trip_japan_payments" ON public.trip_japan_payments FOR ALL USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE TRIGGER trg_jp_updated BEFORE UPDATE ON public.trip_japan_payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Migration: 20260513175211_24d2d980-a1f8-4a96-b872-b7dd0053986b.sql
-- =====================================================================

-- 1. Add columns to booking_participants
ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS relation text;

CREATE INDEX IF NOT EXISTS idx_booking_participants_booking_id ON public.booking_participants(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_participants_client_id ON public.booking_participants(client_id);

-- 2. find_or_create_client function (anti-doublon)
CREATE OR REPLACE FUNCTION public.find_or_create_client_for_participant(
  _full_name text,
  _email text,
  _phone text,
  _passport_no text
)
RETURNS TABLE(client_id uuid, was_existing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _email_clean text := NULLIF(lower(trim(_email)), '');
  _phone_clean text := NULLIF(trim(_phone), '');
  _passport_clean text := NULLIF(trim(_passport_no), '');
BEGIN
  IF _email_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE lower(email) = _email_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _phone_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE phone = _phone_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _passport_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE passport_number = _passport_clean LIMIT 1;
  END IF;

  IF _id IS NOT NULL THEN
    UPDATE public.clients SET
      full_name = COALESCE(NULLIF(trim(_full_name), ''), full_name),
      email = COALESCE(_email_clean, email),
      phone = COALESCE(_phone_clean, phone),
      passport_number = COALESCE(_passport_clean, passport_number),
      updated_at = now()
    WHERE id = _id;
    RETURN QUERY SELECT _id, true;
    RETURN;
  END IF;

  INSERT INTO public.clients (full_name, email, phone, passport_number, country, source)
  VALUES (
    COALESCE(NULLIF(trim(_full_name), ''), _email_clean, 'Voyageur'),
    _email_clean,
    _phone_clean,
    _passport_clean,
    'Maroc',
    'booking_participant'
  )
  RETURNING id INTO _id;

  RETURN QUERY SELECT _id, false;
END
$$;

-- 3. Trigger : create lead participant on new booking
CREATE OR REPLACE FUNCTION public.bookings_create_lead_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _first text;
  _last text;
  _parts text[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.booking_participants WHERE booking_id = NEW.id AND is_lead = true) THEN
    RETURN NEW;
  END IF;

  _parts := regexp_split_to_array(coalesce(trim(NEW.contact_name),''), '\s+');
  _first := COALESCE(_parts[1], '');
  IF array_length(_parts, 1) > 1 THEN
    _last := array_to_string(_parts[2:array_length(_parts,1)], ' ');
  ELSE
    _last := '';
  END IF;

  INSERT INTO public.booking_participants
    (booking_id, trip_id, first_name, last_name, email, phone, is_lead, client_id, relation)
  VALUES
    (NEW.id, NEW.trip_id, _first, _last, NEW.contact_email, NEW.contact_phone, true, NEW.client_id, 'self');

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_bookings_create_lead_participant ON public.bookings;
CREATE TRIGGER trg_bookings_create_lead_participant
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.bookings_create_lead_participant();

-- 4. Backfill existing bookings without lead participant
INSERT INTO public.booking_participants
  (booking_id, trip_id, first_name, last_name, email, phone, is_lead, client_id, relation)
SELECT
  b.id,
  b.trip_id,
  COALESCE(split_part(trim(b.contact_name), ' ', 1), ''),
  CASE
    WHEN position(' ' in trim(b.contact_name)) > 0
    THEN trim(substring(trim(b.contact_name) from position(' ' in trim(b.contact_name)) + 1))
    ELSE ''
  END,
  b.contact_email,
  b.contact_phone,
  true,
  b.client_id,
  'self'
FROM public.bookings b
WHERE NOT EXISTS (
  SELECT 1 FROM public.booking_participants p
  WHERE p.booking_id = b.id AND p.is_lead = true
);

-- =====================================================================
-- Migration: 20260513180754_088b8e50-37e0-4910-a87a-633aa5eaa704.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.content_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id text NOT NULL,
  field text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','ar')),
  value_text text,
  status text NOT NULL DEFAULT 'auto' CHECK (status IN ('auto','verified','manual')),
  source_text_hash text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, row_id, field, language)
);

CREATE INDEX IF NOT EXISTS idx_content_translations_lookup
  ON public.content_translations (table_name, language, row_id);

ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read content_translations"
  ON public.content_translations FOR SELECT
  USING (true);

CREATE POLICY "staff manage content_translations"
  ON public.content_translations FOR ALL
  USING (is_staff(auth.uid()))
  WITH CHECK (is_staff(auth.uid()));

CREATE TRIGGER content_translations_set_updated_at
  BEFORE UPDATE ON public.content_translations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Migration: 20260519090000_admin_email_logs.sql
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_email_logs_created_at
  ON public.admin_email_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_email_logs_event_type
  ON public.admin_email_logs(event_type, created_at DESC);

ALTER TABLE public.admin_email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read admin_email_logs" ON public.admin_email_logs;
CREATE POLICY "staff read admin_email_logs"
ON public.admin_email_logs FOR SELECT
USING (public.is_staff(auth.uid()));

-- =====================================================================
-- Migration: 20260519093000_passport_ocr_admin.sql
-- =====================================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS passport_issue_date date,
  ADD COLUMN IF NOT EXISTS passport_file_path text;

ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS passport_file_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('passports', 'passports', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "admins read passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins read passports" ON storage.objects;
CREATE POLICY "admins read passports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "admins upload passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passports" ON storage.objects;
CREATE POLICY "admins upload passports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "admins delete passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passports" ON storage.objects;
CREATE POLICY "admins delete passports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

-- =====================================================================
-- Migration: 20260519101500_fix_passports_bucket.sql
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'passports',
  'passports',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[];

DROP POLICY IF EXISTS "admins read passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passport scans" ON storage.objects;
DROP POLICY IF EXISTS "admins read passports" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passports" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passports" ON storage.objects;

CREATE POLICY "admins read passports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "admins upload passports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "admins delete passports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'passports'
  AND (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
  )
);

-- =====================================================================
-- Migration: 20260519103000_email_logs_internal_notifications.sql
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  subject text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read contact_messages" ON public.contact_messages;
CREATE POLICY "staff read contact_messages"
ON public.contact_messages FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  recipient text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  related_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  related_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  related_contact_id uuid REFERENCES public.contact_messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON public.email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_event_type ON public.email_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON public.email_logs(status, created_at DESC);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read email_logs" ON public.email_logs;
CREATE POLICY "staff read email_logs"
ON public.email_logs FOR SELECT
USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "service manage email_logs" ON public.email_logs;
CREATE POLICY "service manage email_logs"
ON public.email_logs FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.email_logs (
  event_type,
  recipient,
  subject,
  status,
  error_message,
  metadata,
  created_at,
  sent_at
)
SELECT
  event_type,
  recipient,
  null,
  status,
  error_message,
  metadata,
  created_at,
  CASE WHEN status = 'sent' THEN created_at ELSE null END
FROM public.admin_email_logs
WHERE NOT EXISTS (
  SELECT 1
  FROM public.email_logs
  WHERE email_logs.event_type = admin_email_logs.event_type
    AND email_logs.recipient = admin_email_logs.recipient
    AND email_logs.created_at = admin_email_logs.created_at
);

-- =====================================================================
-- Migration: 20260520120000_fix_clients_schema_frontend_alignment.sql
-- =====================================================================
-- Fix public.clients so it matches the current admin CRM frontend exactly.
--
-- Frontend sources audited:
-- - src/admin/pages/Clients.tsx
-- - src/admin/components/ClientsImportDialog.tsx
-- - src/pages/Booking.tsx
-- - src/admin/components/CreateBookingDialog.tsx
-- - src/admin/components/LinkExistingClientDialog.tsx
--
-- Fields inserted by Admin > Clients > Ajouter client:
-- full_name, email, phone, city, country, source,
-- passport_number, passport_expiry, passport_issue_date, birthdate,
-- nationality, sex, passport_file_path
--
-- Fields selected/updated by the CRM client list/detail:
-- id, full_name, email, phone, city, country, source,
-- passport_number, passport_expiry, passport_issue_date, birthdate,
-- nationality, sex, passport_file_path, last_trip_label,
-- loyalty_tier, is_returning, trips_completed, rewards_used, created_at

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  city text,
  country text DEFAULT 'Maroc',
  source text,
  passport_number text,
  passport_expiry date,
  passport_issue_date date,
  birthdate date,
  nationality text,
  sex text,
  passport_file_path text,
  last_trip_label text,
  loyalty_tier text NOT NULL DEFAULT 'none',
  is_returning boolean NOT NULL DEFAULT false,
  trips_completed integer NOT NULL DEFAULT 0,
  rewards_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'Maroc',
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS passport_number text,
  ADD COLUMN IF NOT EXISTS passport_expiry date,
  ADD COLUMN IF NOT EXISTS passport_issue_date date,
  ADD COLUMN IF NOT EXISTS birthdate date,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS passport_file_path text,
  ADD COLUMN IF NOT EXISTS last_trip_label text,
  ADD COLUMN IF NOT EXISTS loyalty_tier text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS is_returning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trips_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rewards_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.clients
SET
  country = COALESCE(country, 'Maroc'),
  loyalty_tier = COALESCE(loyalty_tier, 'none'),
  is_returning = COALESCE(is_returning, false),
  trips_completed = COALESCE(trips_completed, 0),
  rewards_used = COALESCE(rewards_used, 0),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, now());

CREATE INDEX IF NOT EXISTS idx_clients_email_lower ON public.clients (lower(email));
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_passport_number ON public.clients (passport_number);
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON public.clients (created_at DESC);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Migration: 20260520143000_add_client_personal_admin_fields.sql
-- =====================================================================
-- Add personal administrative fields used by the CRM, visa workflows and linked travelers.
-- Safe migration: only adds missing nullable columns and indexes.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS profession text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.booking_participants
  ADD COLUMN IF NOT EXISTS profession text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS passport_file_path text;

CREATE INDEX IF NOT EXISTS idx_clients_profession ON public.clients (profession);
CREATE INDEX IF NOT EXISTS idx_clients_marital_status ON public.clients (marital_status);
CREATE INDEX IF NOT EXISTS idx_booking_participants_profession ON public.booking_participants (profession);
CREATE INDEX IF NOT EXISTS idx_booking_participants_marital_status ON public.booking_participants (marital_status);

-- Keep the participant-to-client helper compatible with the new optional fields.
CREATE OR REPLACE FUNCTION public.find_or_create_client_for_participant(
  _full_name text,
  _email text,
  _phone text,
  _passport_no text
)
RETURNS TABLE(client_id uuid, was_existing boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _email_clean text := NULLIF(lower(trim(_email)), '');
  _phone_clean text := NULLIF(trim(_phone), '');
  _passport_clean text := NULLIF(trim(_passport_no), '');
BEGIN
  IF _email_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE lower(email) = _email_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _phone_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE phone = _phone_clean LIMIT 1;
  END IF;
  IF _id IS NULL AND _passport_clean IS NOT NULL THEN
    SELECT id INTO _id FROM public.clients WHERE passport_number = _passport_clean LIMIT 1;
  END IF;

  IF _id IS NOT NULL THEN
    UPDATE public.clients SET
      full_name = COALESCE(NULLIF(trim(_full_name), ''), full_name),
      email = COALESCE(_email_clean, email),
      phone = COALESCE(_phone_clean, phone),
      passport_number = COALESCE(_passport_clean, passport_number),
      updated_at = now()
    WHERE id = _id;
    RETURN QUERY SELECT _id, true;
    RETURN;
  END IF;

  INSERT INTO public.clients (full_name, email, phone, passport_number, country, source)
  VALUES (
    COALESCE(NULLIF(trim(_full_name), ''), _email_clean, 'Voyageur'),
    _email_clean,
    _phone_clean,
    _passport_clean,
    'Maroc',
    'booking_participant'
  )
  RETURNING id INTO _id;

  RETURN QUERY SELECT _id, false;
END
$$;

-- =====================================================================
-- Migration: 20260520150000_secure_crm_export_logs.sql
-- =====================================================================
-- Server-side audit log for sensitive CRM exports.

CREATE TABLE IF NOT EXISTS public.crm_export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  ip_address text,
  exported_count integer NOT NULL DEFAULT 0,
  export_type text NOT NULL CHECK (export_type IN ('CSV', 'XLSX')),
  scope text,
  include_passport_data boolean NOT NULL DEFAULT false,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'denied', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_export_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin read crm export logs" ON public.crm_export_logs;
CREATE POLICY "super_admin read crm export logs"
ON public.crm_export_logs
FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "super_admin insert crm export logs" ON public.crm_export_logs;
CREATE POLICY "super_admin insert crm export logs"
ON public.crm_export_logs
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_crm_export_logs_user_id ON public.crm_export_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_export_logs_created_at ON public.crm_export_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_export_logs_status ON public.crm_export_logs(status);

-- =====================================================================
-- Migration: 20260520162000_add_crm_import_client_columns.sql
-- =====================================================================
-- Align public.clients with the CRM import/export mapping.
-- All columns are nullable so existing clients and partial imports remain safe.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS passport_expiring_soon boolean,
  ADD COLUMN IF NOT EXISTS passport_renewal_needed boolean,
  ADD COLUMN IF NOT EXISTS last_trip_departure_date date,
  ADD COLUMN IF NOT EXISTS client_status text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric,
  ADD COLUMN IF NOT EXISTS balance_due numeric,
  ADD COLUMN IF NOT EXISTS registered_at date;

CREATE INDEX IF NOT EXISTS idx_clients_registered_at ON public.clients (registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_last_trip_departure_date ON public.clients (last_trip_departure_date DESC);
CREATE INDEX IF NOT EXISTS idx_clients_client_status ON public.clients (client_status);

-- =====================================================================
-- Migration: 20260526090000_v101_visa_trip_defaults_and_ocr_manager.sql
-- =====================================================================
-- V1.0.1 stabilization: allow Sales Manager (app_role = manager) to use passport OCR
-- and add optional trip-level visa defaults. Additive only; no business statuses changed.

DROP POLICY IF EXISTS "admins read passports" ON storage.objects;
DROP POLICY IF EXISTS "admins upload passports" ON storage.objects;
DROP POLICY IF EXISTS "admins delete passports" ON storage.objects;
DROP POLICY IF EXISTS "admins and sales managers read passports" ON storage.objects;
DROP POLICY IF EXISTS "admins and sales managers upload passports" ON storage.objects;
DROP POLICY IF EXISTS "admins and sales managers delete passports" ON storage.objects;

CREATE POLICY "admins and sales managers read passports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'passports'
  AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin','manager']::public.app_role[])
);

CREATE POLICY "admins and sales managers upload passports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'passports'
  AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin','manager']::public.app_role[])
);

CREATE POLICY "admins and sales managers delete passports"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'passports'
  AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin','manager']::public.app_role[])
);

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS visa_japan_arrival_date date,
  ADD COLUMN IF NOT EXISTS visa_japan_departure_date date,
  ADD COLUMN IF NOT EXISTS visa_arrival_port text,
  ADD COLUMN IF NOT EXISTS visa_arrival_flight_number text,
  ADD COLUMN IF NOT EXISTS visa_hotel_name text,
  ADD COLUMN IF NOT EXISTS visa_hotel_address text,
  ADD COLUMN IF NOT EXISTS visa_hotel_phone text,
  ADD COLUMN IF NOT EXISTS programme_id uuid REFERENCES public.programmes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trips_programme_id ON public.trips(programme_id);

CREATE OR REPLACE FUNCTION public.apply_visa_trip_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trip_row public.trips%ROWTYPE;
BEGIN
  IF NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.*
    INTO trip_row
  FROM public.bookings b
  JOIN public.trips t ON t.id = b.trip_id
  WHERE b.id = NEW.booking_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.date_of_arrival := COALESCE(NEW.date_of_arrival, trip_row.visa_japan_arrival_date);
  NEW.port_of_entry := COALESCE(NULLIF(NEW.port_of_entry, ''), trip_row.visa_arrival_port);
  NEW.airline_or_ship := COALESCE(NULLIF(NEW.airline_or_ship, ''), trip_row.visa_arrival_flight_number);
  NEW.hotel_name := COALESCE(NULLIF(NEW.hotel_name, ''), trip_row.visa_hotel_name);
  NEW.hotel_address := COALESCE(NULLIF(NEW.hotel_address, ''), trip_row.visa_hotel_address);
  NEW.hotel_tel := COALESCE(NULLIF(NEW.hotel_tel, ''), trip_row.visa_hotel_phone);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_visa_trip_defaults ON public.visa_applications;
CREATE TRIGGER trg_apply_visa_trip_defaults
BEFORE INSERT OR UPDATE OF booking_id ON public.visa_applications
FOR EACH ROW
EXECUTE FUNCTION public.apply_visa_trip_defaults();

-- =====================================================================
-- Migration: 20260526093000_v101_travel_docs_flights_hotels.sql
-- =====================================================================
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS outbound_flight_text text,
  ADD COLUMN IF NOT EXISTS return_flight_text text;

ALTER TABLE public.trip_hotels
  ADD COLUMN IF NOT EXISTS check_in date,
  ADD COLUMN IF NOT EXISTS check_out date,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE INDEX IF NOT EXISTS idx_trip_hotels_trip_dates
  ON public.trip_hotels (trip_id, check_in, check_out);

-- =====================================================================
-- Migration: 20260526103000_agency_settings_public_read.sql
-- =====================================================================
-- V1.0.1 agency settings public read
-- Legal/contact branding is intentionally public so the site header/footer can
-- reuse the same centrally managed values as generated documents.

DROP POLICY IF EXISTS "public read agency_settings" ON public.agency_settings;
CREATE POLICY "public read agency_settings"
ON public.agency_settings
FOR SELECT
USING (true);

-- =====================================================================
-- Migration: 20260526113000_admin_backup_logs.sql
-- =====================================================================
-- V1.0.1 disaster recovery: audit manual platform backup exports.
CREATE TABLE IF NOT EXISTS public.admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  status text NOT NULL DEFAULT 'success',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin read admin_logs" ON public.admin_logs;
CREATE POLICY "super_admin read admin_logs"
ON public.admin_logs
FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "super_admin insert admin_logs" ON public.admin_logs;
CREATE POLICY "super_admin insert admin_logs"
ON public.admin_logs
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON public.admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON public.admin_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_user_id ON public.admin_logs(user_id, created_at DESC);


-- =====================================================================
-- Disaster Recovery Pack V1 - current V2 compatibility layer
-- Source: applied production SQL + current application data model.
-- This block intentionally supersedes legacy/incomplete local V2 drafts.
-- =====================================================================

create or replace function public.is_super_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(_user_id, 'super_admin'::public.app_role);
$$;

-- Current production admin_logs does not require entity_type as a column.
-- Backup audit code stores backup_entity_type inside metadata.
alter table if exists public.admin_logs
  drop column if exists entity_type;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'agency'
    check (type in ('internal', 'agency', 'japan_partner', 'supplier')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'archived')),
  display_name text not null,
  legal_name text,
  email text,
  phone text,
  website text,
  address_line_1 text,
  address_line_2 text,
  city text,
  postal_code text,
  country text,
  tax_identifier text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organizations_type on public.organizations(type);
create index if not exists idx_organizations_status on public.organizations(status);
create index if not exists idx_organizations_display_name_lower on public.organizations(lower(display_name));

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;

drop policy if exists "admins manage organizations" on public.organizations;
create policy "admins manage organizations"
on public.organizations
for all
using (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]));

drop policy if exists "members read own organization" on public.organizations;
create policy "members read own organization"
on public.organizations
for select
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = organizations.id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent'
    check (role in ('owner', 'admin', 'agent', 'finance', 'operations', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_organization_members_organization_id on public.organization_members(organization_id);
create index if not exists idx_organization_members_user_id on public.organization_members(user_id);
create index if not exists idx_organization_members_status on public.organization_members(status);

create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

alter table public.organization_members enable row level security;

drop policy if exists "admins manage organization_members" on public.organization_members;
create policy "admins manage organization_members"
on public.organization_members
for all
using (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]));

drop policy if exists "members read own membership" on public.organization_members;
create policy "members read own membership"
on public.organization_members
for select
using (user_id = auth.uid());

create table if not exists public.organization_member_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_member_id uuid references public.organization_members(id) on delete cascade unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  secondary_phone text,
  secondary_email text,
  position_title text,
  point_of_sale text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organization_member_profiles_user_id on public.organization_member_profiles(user_id);
create index if not exists idx_organization_member_profiles_organization_id on public.organization_member_profiles(organization_id);
create index if not exists idx_organization_member_profiles_email_lower on public.organization_member_profiles(lower(email));

create trigger organization_member_profiles_set_updated_at
before update on public.organization_member_profiles
for each row execute function public.set_updated_at();

alter table public.organization_member_profiles enable row level security;

drop policy if exists "admins manage organization_member_profiles" on public.organization_member_profiles;
create policy "admins manage organization_member_profiles"
on public.organization_member_profiles
for all
using (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]));

drop policy if exists "members read own organization_member_profile" on public.organization_member_profiles;
create policy "members read own organization_member_profile"
on public.organization_member_profiles
for select
using (user_id = auth.uid());

drop policy if exists "members update own organization_member_profile" on public.organization_member_profiles;
create policy "members update own organization_member_profile"
on public.organization_member_profiles
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create table if not exists public.agency_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  agency_code text unique,
  commercial_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  website text,
  market_country text,
  preferred_language text,
  billing_legal_name text,
  billing_email text,
  billing_phone text,
  billing_address_line_1 text,
  billing_address_line_2 text,
  billing_city text,
  billing_postal_code text,
  billing_country text,
  tax_identifier text,
  payment_terms text,
  default_commission_type text default 'percentage'
    check (default_commission_type in ('percentage', 'fixed_amount')),
  default_commission_value numeric,
  commission_currency text default 'MAD',
  commission_notes text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  commercial_notes text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agency_profiles_agency_code on public.agency_profiles(agency_code);
create trigger agency_profiles_set_updated_at
before update on public.agency_profiles
for each row execute function public.set_updated_at();
alter table public.agency_profiles enable row level security;

drop policy if exists "admins manage agency_profiles" on public.agency_profiles;
create policy "admins manage agency_profiles"
on public.agency_profiles
for all
using (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]));

drop policy if exists "agency members read own agency_profile" on public.agency_profiles;
create policy "agency members read own agency_profile"
on public.agency_profiles
for select
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = agency_profiles.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

create table if not exists public.partner_onboarding_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'awaiting_documents', 'under_review', 'submitted', 'approved', 'rejected')),
  source text default 'devenir-partenaire',
  metadata jsonb not null default '{}'::jsonb,
  form_data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_partner_onboarding_cases_organization_id on public.partner_onboarding_cases(organization_id);
create index if not exists idx_partner_onboarding_cases_status on public.partner_onboarding_cases(status);
create index if not exists idx_partner_onboarding_cases_created_at on public.partner_onboarding_cases(created_at desc);

create trigger partner_onboarding_cases_set_updated_at
before update on public.partner_onboarding_cases
for each row execute function public.set_updated_at();

alter table public.partner_onboarding_cases enable row level security;

drop policy if exists "admins manage partner_onboarding_cases" on public.partner_onboarding_cases;
create policy "admins manage partner_onboarding_cases"
on public.partner_onboarding_cases
for all
using (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]));

drop policy if exists "members read own partner_onboarding_cases" on public.partner_onboarding_cases;
create policy "members read own partner_onboarding_cases"
on public.partner_onboarding_cases
for select
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = partner_onboarding_cases.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

drop policy if exists "members update own partner_onboarding_cases" on public.partner_onboarding_cases;
create policy "members update own partner_onboarding_cases"
on public.partner_onboarding_cases
for update
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = partner_onboarding_cases.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = partner_onboarding_cases.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

create table if not exists public.partner_onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  onboarding_case_id uuid references public.partner_onboarding_cases(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  document_type text not null,
  file_path text not null,
  file_name text,
  status text not null default 'received',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_partner_onboarding_documents_case_id on public.partner_onboarding_documents(onboarding_case_id);
create index if not exists idx_partner_onboarding_documents_organization_id on public.partner_onboarding_documents(organization_id);
create index if not exists idx_partner_onboarding_documents_status on public.partner_onboarding_documents(status);

alter table public.partner_onboarding_documents enable row level security;

drop policy if exists "admins manage partner_onboarding_documents" on public.partner_onboarding_documents;
create policy "admins manage partner_onboarding_documents"
on public.partner_onboarding_documents
for all
using (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]));

drop policy if exists "members manage own partner_onboarding_documents" on public.partner_onboarding_documents;
create policy "members manage own partner_onboarding_documents"
on public.partner_onboarding_documents
for all
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = partner_onboarding_documents.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
)
with check (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = partner_onboarding_documents.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

create table if not exists public.commission_engine_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  scope text not null default 'agency_default'
    check (scope in ('agency_default', 'destination', 'product', 'trip_override')),
  rule_type text not null default 'percentage'
    check (rule_type in ('percentage', 'fixed_amount')),
  value numeric not null default 0,
  currency text not null default 'MAD',
  destination text,
  product_type text,
  trip_id uuid references public.trips(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (value >= 0),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index if not exists idx_commission_engine_rules_organization_id on public.commission_engine_rules(organization_id);
create index if not exists idx_commission_engine_rules_scope on public.commission_engine_rules(scope);
create index if not exists idx_commission_engine_rules_status on public.commission_engine_rules(status);

create trigger commission_engine_rules_set_updated_at
before update on public.commission_engine_rules
for each row execute function public.set_updated_at();

alter table public.commission_engine_rules enable row level security;

drop policy if exists "commission_engine_rules_admin_manage" on public.commission_engine_rules;
create policy "commission_engine_rules_admin_manage"
on public.commission_engine_rules
for all
using (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[]));

drop policy if exists "commission_engine_rules_active_org_member_read" on public.commission_engine_rules;
create policy "commission_engine_rules_active_org_member_read"
on public.commission_engine_rules
for select
using (
  status = 'active'
  and exists (
    select 1 from public.organization_members om
    where om.organization_id = commission_engine_rules.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  )
);

insert into storage.buckets (id, name, public)
values ('partner-onboarding', 'partner-onboarding', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "admins read partner-onboarding" on storage.objects;
create policy "admins read partner-onboarding"
on storage.objects for select
using (
  bucket_id = 'partner-onboarding'
  and public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[])
);

drop policy if exists "admins manage partner-onboarding" on storage.objects;
create policy "admins manage partner-onboarding"
on storage.objects for all
using (
  bucket_id = 'partner-onboarding'
  and public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[])
)
with check (
  bucket_id = 'partner-onboarding'
  and public.has_any_role(auth.uid(), array['super_admin','admin']::public.app_role[])
);

drop policy if exists "org members manage own partner-onboarding files" on storage.objects;
create policy "org members manage own partner-onboarding files"
on storage.objects for all
using (
  bucket_id = 'partner-onboarding'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid()
      and om.status = 'active'
      and (storage.foldername(storage.objects.name))[1] = om.organization_id::text
  )
)
with check (
  bucket_id = 'partner-onboarding'
  and exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid()
      and om.status = 'active'
      and (storage.foldername(storage.objects.name))[1] = om.organization_id::text
  )
);

notify pgrst, 'reload schema';
