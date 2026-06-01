-- V2 Commission Engine V1
-- Additive only: creates a dedicated simple commission engine table.

create table if not exists public.commission_engine_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope text not null default 'global',
  destination text,
  product_trip_id uuid references public.trips(id) on delete set null,
  rule_name text,
  commission_type text not null default 'percentage',
  commission_value numeric(12,2) not null default 0,
  currency text not null default 'MAD',
  applies_to text not null default 'booking_total',
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'active',
  priority integer not null default 100,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_engine_rules_scope_check
    check (scope in ('global', 'destination', 'product')),
  constraint commission_engine_rules_type_check
    check (commission_type in ('percentage', 'fixed_amount')),
  constraint commission_engine_rules_applies_to_check
    check (applies_to in ('booking_total', 'base_trip_price')),
  constraint commission_engine_rules_status_check
    check (status in ('active', 'inactive', 'archived')),
  constraint commission_engine_rules_value_check
    check (commission_value >= 0),
  constraint commission_engine_rules_dates_check
    check (effective_to is null or effective_to >= effective_from),
  constraint commission_engine_rules_scope_target_check
    check (
      (scope = 'global' and destination is null and product_trip_id is null)
      or (scope = 'destination' and destination is not null and product_trip_id is null)
      or (scope = 'product' and product_trip_id is not null)
    )
);

create index if not exists idx_commission_engine_rules_org_status
  on public.commission_engine_rules (organization_id, status);

create index if not exists idx_commission_engine_rules_scope
  on public.commission_engine_rules (organization_id, scope, status, priority);

create index if not exists idx_commission_engine_rules_effective
  on public.commission_engine_rules (organization_id, effective_from, effective_to);

create index if not exists idx_commission_engine_rules_product
  on public.commission_engine_rules (organization_id, product_trip_id)
  where scope = 'product';

create unique index if not exists ux_commission_engine_active_global
  on public.commission_engine_rules (organization_id)
  where scope = 'global' and status = 'active';

create unique index if not exists ux_commission_engine_active_destination
  on public.commission_engine_rules (organization_id, lower(destination))
  where scope = 'destination' and status = 'active';

create unique index if not exists ux_commission_engine_active_product
  on public.commission_engine_rules (organization_id, product_trip_id)
  where scope = 'product' and status = 'active';

create or replace function public.v2_commission_engine_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_commission_engine_rules_updated_at on public.commission_engine_rules;
create trigger trg_commission_engine_rules_updated_at
before update on public.commission_engine_rules
for each row execute function public.v2_commission_engine_touch_updated_at();

alter table public.commission_engine_rules enable row level security;

drop policy if exists "commission_engine_rules_super_admin_manage" on public.commission_engine_rules;
create policy "commission_engine_rules_super_admin_manage"
on public.commission_engine_rules
for all
using (public.is_super_admin(auth.uid()))
with check (public.is_super_admin(auth.uid()));

drop policy if exists "commission_engine_rules_agency_read_own" on public.commission_engine_rules;
create policy "commission_engine_rules_agency_read_own"
on public.commission_engine_rules
for select
using (
  status = 'active'
  and exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = commission_engine_rules.organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and o.type = 'agency'
      and o.status = 'active'
  )
);

notify pgrst, 'reload schema';
