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
