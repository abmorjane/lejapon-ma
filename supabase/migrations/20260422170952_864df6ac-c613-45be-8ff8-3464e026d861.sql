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