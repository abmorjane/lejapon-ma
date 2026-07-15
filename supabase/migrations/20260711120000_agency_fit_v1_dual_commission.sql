-- Agency FIT V1 + dual commission engine, production-safe edition.
--
-- Safety principles:
-- 1. public.agency_fit_requests contains request/workflow data only.
-- 2. Confidential agency/company commission data is stored only in
--    public.agency_commission_snapshots and exposed through restricted views/RPCs.
-- 3. RLS is split by action and organization role.
-- 4. Child rows must match the parent request organization_id.
-- 5. This migration is additive/idempotent and does not drop tables or data.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.organizations') is null then
    raise exception 'Missing required table public.organizations. Apply the partner organization foundation migrations first.';
  end if;

  if to_regclass('public.organization_members') is null then
    raise exception 'Missing required table public.organization_members. Apply the partner organization foundation migrations first.';
  end if;

  if to_regclass('public.user_roles') is null then
    raise exception 'Missing required table public.user_roles. Apply the auth/roles foundation migrations first.';
  end if;

  if to_regclass('public.trips') is null then
    raise exception 'Missing required table public.trips. Apply the trip foundation migrations first.';
  end if;

  if to_regclass('public.bookings') is null then
    raise exception 'Missing required table public.bookings. Apply the booking foundation migrations first.';
  end if;

  if to_regclass('public.fit_quotes') is null then
    raise exception 'Missing required table public.fit_quotes. Apply FIT quote migrations first.';
  end if;

  if to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Missing required function public.set_updated_at(). Apply foundation migrations first.';
  end if;
end;
$$;

create or replace function public.agency_fit_is_staff_v1(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in ('super_admin', 'admin', 'manager', 'agent')
  );
$$;

create or replace function public.agency_fit_is_admin_v1(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in ('super_admin', 'admin')
  );
$$;

create or replace function public.agency_fit_member_role_v1(_user_id uuid, _organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select om.role
  from public.organization_members om
  where om.user_id = _user_id
    and om.organization_id = _organization_id
    and om.status = 'active'
  order by case om.role
    when 'owner' then 1
    when 'agency_admin' then 2
    when 'partner_agency_admin' then 3
    when 'admin' then 4
    when 'manager' then 5
    when 'sales_agent' then 6
    when 'partner_agent' then 7
    when 'agent' then 8
    when 'accountant' then 9
    when 'finance' then 10
    when 'operations' then 11
    else 50
  end
  limit 1;
$$;

create or replace function public.agency_fit_is_org_member_v1(_user_id uuid, _organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.user_id = _user_id
      and om.organization_id = _organization_id
      and om.status = 'active'
  );
$$;

create or replace function public.agency_fit_is_owner_manager_v1(_user_id uuid, _organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.agency_fit_member_role_v1(_user_id, _organization_id) in (
    'owner',
    'admin',
    'manager',
    'agency_admin',
    'partner_agency_admin'
  );
$$;

create or replace function public.agency_fit_is_sales_agent_v1(_user_id uuid, _organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.agency_fit_member_role_v1(_user_id, _organization_id) in (
    'sales_agent',
    'agent',
    'partner_agent'
  );
$$;

create or replace function public.agency_fit_is_finance_v1(_user_id uuid, _organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.agency_fit_member_role_v1(_user_id, _organization_id) in ('accountant', 'finance');
$$;

create or replace function public.agency_fit_is_operations_v1(_user_id uuid, _organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.agency_fit_member_role_v1(_user_id, _organization_id) = 'operations';
$$;

create or replace function public.agency_fit_normalize_commission_type_v1(_value text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(_value, '')) in ('fixed', 'fixed_amount', 'amount', 'montant_fixe') then 'fixed_amount'
    else 'percentage'
  end;
$$;

create table if not exists public.agency_fit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'new',
  client_full_name text not null default '',
  client_phone text,
  client_email text,
  adults integer not null default 1,
  children integer not null default 0,
  babies integer not null default 0,
  residence_country text,
  desired_departure_date date,
  desired_return_date date,
  flexibility text,
  destination_country text not null default 'Japan',
  cities text[] not null default '{}'::text[],
  duration_days integer,
  travel_styles text[] not null default '{}'::text[],
  hotel_category text,
  room_needs text[] not null default '{}'::text[],
  hotel_location_preference text,
  include_international_flights text,
  departure_airport text,
  preferred_airline text,
  baggage_needs text,
  guide_language text,
  guide_coverage text,
  transport_preference text,
  must_have_activities text,
  optional_extras text[] not null default '{}'::text[],
  budget_per_person numeric,
  currency text not null default 'MAD',
  budget_flexibility text,
  special_requests text,
  internal_agency_note text,
  admin_internal_notes text,
  agency_visible_message text,
  fit_quote_id uuid references public.fit_quotes(id) on delete set null,
  quote_link text,
  base_price_per_person numeric,
  base_total_price numeric,
  agency_margin_type text not null default 'fixed',
  agency_margin_value numeric not null default 0,
  final_client_price numeric,
  quoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agency_fit_requests
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists requested_by uuid references auth.users(id) on delete set null,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists status text not null default 'new',
  add column if not exists client_full_name text not null default '',
  add column if not exists client_phone text,
  add column if not exists client_email text,
  add column if not exists adults integer not null default 1,
  add column if not exists children integer not null default 0,
  add column if not exists babies integer not null default 0,
  add column if not exists residence_country text,
  add column if not exists desired_departure_date date,
  add column if not exists desired_return_date date,
  add column if not exists flexibility text,
  add column if not exists destination_country text not null default 'Japan',
  add column if not exists cities text[] not null default '{}'::text[],
  add column if not exists duration_days integer,
  add column if not exists travel_styles text[] not null default '{}'::text[],
  add column if not exists hotel_category text,
  add column if not exists room_needs text[] not null default '{}'::text[],
  add column if not exists hotel_location_preference text,
  add column if not exists include_international_flights text,
  add column if not exists departure_airport text,
  add column if not exists preferred_airline text,
  add column if not exists baggage_needs text,
  add column if not exists guide_language text,
  add column if not exists guide_coverage text,
  add column if not exists transport_preference text,
  add column if not exists must_have_activities text,
  add column if not exists optional_extras text[] not null default '{}'::text[],
  add column if not exists budget_per_person numeric,
  add column if not exists currency text not null default 'MAD',
  add column if not exists budget_flexibility text,
  add column if not exists special_requests text,
  add column if not exists internal_agency_note text,
  add column if not exists admin_internal_notes text,
  add column if not exists agency_visible_message text,
  add column if not exists fit_quote_id uuid references public.fit_quotes(id) on delete set null,
  add column if not exists quote_link text,
  add column if not exists base_price_per_person numeric,
  add column if not exists base_total_price numeric,
  add column if not exists agency_margin_type text not null default 'fixed',
  add column if not exists agency_margin_value numeric not null default 0,
  add column if not exists final_client_price numeric,
  add column if not exists quoted_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.agency_fit_requests
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists assigned_sales_agent_id uuid references auth.users(id) on delete set null,
  add column if not exists client_name text,
  add column if not exists destination text,
  add column if not exists travel_start_date date,
  add column if not exists travel_end_date date,
  add column if not exists adult_count integer,
  add column if not exists child_count integer,
  add column if not exists infant_count integer,
  add column if not exists room_preferences jsonb not null default '{}'::jsonb,
  add column if not exists budget_mad numeric,
  add column if not exists departure_city text,
  add column if not exists requested_services jsonb not null default '{}'::jsonb,
  add column if not exists request_details text,
  add column if not exists internal_notes text,
  add column if not exists converted_booking_id uuid references public.bookings(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists sales_agent_id uuid references auth.users(id) on delete set null;

-- If an earlier unsafe draft was partially applied, preserve confidential data
-- in versioned snapshots before removing the columns from the directly selected
-- request table.
create table if not exists public.agency_commission_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sales_agent_id uuid references auth.users(id) on delete set null,
  agency_fit_request_id uuid references public.agency_fit_requests(id) on delete set null,
  fit_quote_id uuid references public.fit_quotes(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  snapshot_version integer not null default 1,
  is_current boolean not null default true,
  eligible_sale_amount_mad numeric not null default 0,
  gross_agency_commission_type text not null default 'percentage',
  gross_agency_commission_value numeric not null default 0,
  gross_agency_commission_amount_mad numeric not null default 0,
  sales_agent_commission_type text not null default 'fixed_amount',
  sales_agent_commission_value numeric not null default 0,
  sales_agent_commission_amount_mad numeric not null default 0,
  sales_agent_commission_status text not null default 'estimated',
  agency_net_commission_amount_mad numeric not null default 0,
  calculated_at timestamptz not null default now(),
  rule_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.agency_commission_snapshots
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists sales_agent_id uuid references auth.users(id) on delete set null,
  add column if not exists agency_fit_request_id uuid references public.agency_fit_requests(id) on delete set null,
  add column if not exists fit_quote_id uuid references public.fit_quotes(id) on delete set null,
  add column if not exists booking_id uuid references public.bookings(id) on delete set null,
  add column if not exists snapshot_version integer not null default 1,
  add column if not exists is_current boolean not null default true,
  add column if not exists eligible_sale_amount_mad numeric not null default 0,
  add column if not exists gross_agency_commission_type text not null default 'percentage',
  add column if not exists gross_agency_commission_value numeric not null default 0,
  add column if not exists gross_agency_commission_amount_mad numeric not null default 0,
  add column if not exists sales_agent_commission_type text not null default 'fixed_amount',
  add column if not exists sales_agent_commission_value numeric not null default 0,
  add column if not exists sales_agent_commission_amount_mad numeric not null default 0,
  add column if not exists sales_agent_commission_status text not null default 'estimated',
  add column if not exists agency_net_commission_amount_mad numeric not null default 0,
  add column if not exists calculated_at timestamptz not null default now(),
  add column if not exists rule_source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

do $$
declare
  v_has_any_confidential_column boolean;
  v_eligible_expr text;
  v_gross_type_expr text;
  v_gross_value_expr text;
  v_gross_amount_expr text;
  v_agent_type_expr text;
  v_agent_value_expr text;
  v_agent_amount_expr text;
  v_agent_status_expr text;
  v_calculated_at_expr text;
  v_rule_source_expr text;
  v_snapshot_expr text;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_fit_requests'
      and column_name in (
        'eligible_sale_amount_mad',
        'gross_agency_commission_type',
        'gross_agency_commission_value',
        'gross_agency_commission_amount_mad',
        'sales_agent_commission_type',
        'sales_agent_commission_value',
        'sales_agent_commission_amount_mad',
        'sales_agent_commission_status',
        'commission_calculated_at',
        'commission_rule_source',
        'commission_snapshot'
      )
  ) into v_has_any_confidential_column;

  if not v_has_any_confidential_column then
    return;
  end if;

  v_eligible_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'eligible_sale_amount_mad'
  ) then 'r.eligible_sale_amount_mad' else 'null::numeric' end;
  v_gross_type_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'gross_agency_commission_type'
  ) then 'r.gross_agency_commission_type' else 'null::text' end;
  v_gross_value_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'gross_agency_commission_value'
  ) then 'r.gross_agency_commission_value' else 'null::numeric' end;
  v_gross_amount_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'gross_agency_commission_amount_mad'
  ) then 'r.gross_agency_commission_amount_mad' else 'null::numeric' end;
  v_agent_type_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'sales_agent_commission_type'
  ) then 'r.sales_agent_commission_type' else 'null::text' end;
  v_agent_value_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'sales_agent_commission_value'
  ) then 'r.sales_agent_commission_value' else 'null::numeric' end;
  v_agent_amount_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'sales_agent_commission_amount_mad'
  ) then 'r.sales_agent_commission_amount_mad' else 'null::numeric' end;
  v_agent_status_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'sales_agent_commission_status'
  ) then 'r.sales_agent_commission_status' else 'null::text' end;
  v_calculated_at_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'commission_calculated_at'
  ) then 'r.commission_calculated_at' else 'null::timestamptz' end;
  v_rule_source_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'commission_rule_source'
  ) then 'r.commission_rule_source' else 'null::text' end;
  v_snapshot_expr := case when exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agency_fit_requests' and column_name = 'commission_snapshot'
  ) then 'r.commission_snapshot' else '''{}''::jsonb' end;

  execute format($sql$
    insert into public.agency_commission_snapshots (
      organization_id,
      sales_agent_id,
      agency_fit_request_id,
      fit_quote_id,
      booking_id,
      snapshot_version,
      is_current,
      eligible_sale_amount_mad,
      gross_agency_commission_type,
      gross_agency_commission_value,
      gross_agency_commission_amount_mad,
      sales_agent_commission_type,
      sales_agent_commission_value,
      sales_agent_commission_amount_mad,
      sales_agent_commission_status,
      agency_net_commission_amount_mad,
      calculated_at,
      rule_source,
      metadata
    )
    select
      r.organization_id,
      coalesce(r.sales_agent_id, r.assigned_sales_agent_id, r.assigned_to),
      r.id,
      r.fit_quote_id,
      r.converted_booking_id,
      1,
      true,
      greatest(coalesce(%1$s, r.final_client_price, r.base_total_price, 0), 0),
      public.agency_fit_normalize_commission_type_v1(%2$s),
      greatest(coalesce(%3$s, 0), 0),
      greatest(coalesce(%4$s, 0), 0),
      public.agency_fit_normalize_commission_type_v1(%5$s),
      greatest(coalesce(%6$s, 0), 0),
      least(greatest(coalesce(%7$s, 0), 0), greatest(coalesce(%4$s, 0), 0)),
      coalesce(%8$s, 'estimated'),
      greatest(
        greatest(coalesce(%4$s, 0), 0)
        - least(greatest(coalesce(%7$s, 0), 0), greatest(coalesce(%4$s, 0), 0)),
        0
      ),
      coalesce(%9$s, now()),
      %10$s,
      jsonb_build_object('migrated_from_request_columns', true, 'source_snapshot', coalesce(%11$s, '{}'::jsonb))
    from public.agency_fit_requests r
    where coalesce(%4$s, %3$s, %7$s) is not null
      and not exists (
        select 1
        from public.agency_commission_snapshots s
        where s.agency_fit_request_id = r.id
          and s.snapshot_version = 1
      )
  $sql$,
    v_eligible_expr,
    v_gross_type_expr,
    v_gross_value_expr,
    v_gross_amount_expr,
    v_agent_type_expr,
    v_agent_value_expr,
    v_agent_amount_expr,
    v_agent_status_expr,
    v_calculated_at_expr,
    v_rule_source_expr,
    v_snapshot_expr
  );
end;
$$;

alter table public.agency_fit_requests
  drop column if exists eligible_sale_amount_mad,
  drop column if exists gross_agency_commission_type,
  drop column if exists gross_agency_commission_value,
  drop column if exists gross_agency_commission_amount_mad,
  drop column if exists sales_agent_commission_type,
  drop column if exists sales_agent_commission_value,
  drop column if exists sales_agent_commission_amount_mad,
  drop column if exists sales_agent_commission_status,
  drop column if exists agency_net_commission_amount_mad,
  drop column if exists commission_snapshot,
  drop column if exists commission_calculated_at,
  drop column if exists commission_rule_source;

alter table public.agency_fit_requests
  drop constraint if exists agency_fit_requests_status_check;

alter table public.agency_fit_requests
  add constraint agency_fit_requests_status_check check (
    status in (
      'draft',
      'submitted',
      'under_review',
      'information_required',
      'quote_in_progress',
      'quoted',
      'revision_requested',
      'accepted',
      'converted_to_booking',
      'cancelled',
      'new',
      'in_progress',
      'missing_info',
      'quote_preparing',
      'quote_sent_to_agency',
      'declined',
      'archived'
    )
  );

alter table public.agency_fit_requests
  drop constraint if exists agency_fit_requests_agency_margin_type_check;

alter table public.agency_fit_requests
  add constraint agency_fit_requests_agency_margin_type_check
  check (agency_margin_type in ('fixed', 'percentage', 'fixed_amount'));

alter table public.agency_fit_requests
  drop constraint if exists agency_fit_requests_financial_non_negative;

alter table public.agency_fit_requests
  add constraint agency_fit_requests_financial_non_negative check (
    coalesce(adults, 0) >= 0
    and coalesce(children, 0) >= 0
    and coalesce(babies, 0) >= 0
    and coalesce(adult_count, 0) >= 0
    and coalesce(child_count, 0) >= 0
    and coalesce(infant_count, 0) >= 0
    and coalesce(budget_per_person, 0) >= 0
    and coalesce(budget_mad, 0) >= 0
    and coalesce(base_price_per_person, 0) >= 0
    and coalesce(base_total_price, 0) >= 0
    and coalesce(agency_margin_value, 0) >= 0
    and coalesce(final_client_price, 0) >= 0
  );

alter table public.agency_fit_requests
  drop constraint if exists agency_fit_requests_travel_dates_order;

alter table public.agency_fit_requests
  add constraint agency_fit_requests_travel_dates_order check (
    (desired_departure_date is null or desired_return_date is null or desired_return_date >= desired_departure_date)
    and (travel_start_date is null or travel_end_date is null or travel_end_date >= travel_start_date)
  );

create index if not exists idx_agency_fit_requests_org_created
  on public.agency_fit_requests (organization_id, created_at desc);

create index if not exists idx_agency_fit_requests_status_created
  on public.agency_fit_requests (status, created_at desc);

create index if not exists idx_agency_fit_requests_created_by
  on public.agency_fit_requests (created_by);

create index if not exists idx_agency_fit_requests_assigned_sales_agent
  on public.agency_fit_requests (assigned_sales_agent_id);

create or replace function public.agency_fit_requests_normalize_v1()
returns trigger
language plpgsql
as $$
begin
  new.created_by := coalesce(new.created_by, new.requested_by);
  new.requested_by := coalesce(new.requested_by, new.created_by);
  new.assigned_sales_agent_id := coalesce(new.assigned_sales_agent_id, new.assigned_to, new.sales_agent_id);
  new.assigned_to := coalesce(new.assigned_to, new.assigned_sales_agent_id);
  new.sales_agent_id := coalesce(new.sales_agent_id, new.assigned_sales_agent_id);

  new.client_name := coalesce(nullif(trim(new.client_name), ''), nullif(trim(new.client_full_name), ''));
  new.client_full_name := coalesce(nullif(trim(new.client_full_name), ''), nullif(trim(new.client_name), ''), '');
  new.destination := coalesce(nullif(trim(new.destination), ''), nullif(trim(new.destination_country), ''));
  new.destination_country := coalesce(nullif(trim(new.destination_country), ''), nullif(trim(new.destination), ''), 'Japan');

  new.travel_start_date := coalesce(new.travel_start_date, new.desired_departure_date);
  new.travel_end_date := coalesce(new.travel_end_date, new.desired_return_date);
  new.desired_departure_date := coalesce(new.desired_departure_date, new.travel_start_date);
  new.desired_return_date := coalesce(new.desired_return_date, new.travel_end_date);

  new.adult_count := coalesce(new.adult_count, new.adults, 0);
  new.child_count := coalesce(new.child_count, new.children, 0);
  new.infant_count := coalesce(new.infant_count, new.babies, 0);
  new.adults := coalesce(new.adults, new.adult_count, 0);
  new.children := coalesce(new.children, new.child_count, 0);
  new.babies := coalesce(new.babies, new.infant_count, 0);

  new.request_details := coalesce(nullif(trim(new.request_details), ''), nullif(trim(new.special_requests), ''));
  new.special_requests := coalesce(nullif(trim(new.special_requests), ''), nullif(trim(new.request_details), ''));
  new.internal_notes := coalesce(nullif(trim(new.internal_notes), ''), nullif(trim(new.internal_agency_note), ''));

  if new.agency_margin_type = 'fixed' then
    new.agency_margin_type := 'fixed_amount';
  end if;

  if new.requested_services = '{}'::jsonb then
    new.requested_services := jsonb_strip_nulls(jsonb_build_object(
      'cities', to_jsonb(new.cities),
      'travel_styles', to_jsonb(new.travel_styles),
      'room_needs', to_jsonb(new.room_needs),
      'optional_extras', to_jsonb(new.optional_extras),
      'guide_language', new.guide_language,
      'guide_coverage', new.guide_coverage,
      'transport_preference', new.transport_preference,
      'include_international_flights', new.include_international_flights
    ));
  end if;

  if new.room_preferences = '{}'::jsonb then
    new.room_preferences := jsonb_strip_nulls(jsonb_build_object(
      'hotel_category', new.hotel_category,
      'room_needs', to_jsonb(new.room_needs),
      'hotel_location_preference', new.hotel_location_preference
    ));
  end if;

  if new.budget_mad is null and new.budget_per_person is not null then
    new.budget_mad := new.budget_per_person * greatest(coalesce(new.adults, 0) + coalesce(new.children, 0), 1);
  end if;

  return new;
end;
$$;

drop trigger if exists agency_fit_requests_normalize_before_write on public.agency_fit_requests;
drop trigger if exists agency_fit_requests_normalize_v1_before_write on public.agency_fit_requests;
create trigger agency_fit_requests_normalize_v1_before_write
before insert or update on public.agency_fit_requests
for each row execute function public.agency_fit_requests_normalize_v1();

drop trigger if exists agency_fit_requests_updated_at on public.agency_fit_requests;
create trigger agency_fit_requests_updated_at
before update on public.agency_fit_requests
for each row execute function public.set_updated_at();

create table if not exists public.agency_fit_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.agency_fit_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_type text not null default 'agency',
  visibility text not null default 'agency',
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.agency_fit_request_messages
  add column if not exists request_id uuid references public.agency_fit_requests(id) on delete cascade,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists sender_id uuid references auth.users(id) on delete set null,
  add column if not exists sender_type text not null default 'agency',
  add column if not exists visibility text not null default 'agency',
  add column if not exists message text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

alter table public.agency_fit_request_messages
  drop constraint if exists agency_fit_request_messages_visibility_check;

alter table public.agency_fit_request_messages
  add constraint agency_fit_request_messages_visibility_check
  check (visibility in ('agency', 'admin_internal', 'all'));

create table if not exists public.agency_fit_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.agency_fit_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  file_name text not null,
  file_path text not null,
  mime_type text,
  file_size bigint,
  visibility text not null default 'agency',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.agency_fit_request_files
  add column if not exists request_id uuid references public.agency_fit_requests(id) on delete cascade,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists file_name text,
  add column if not exists file_path text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists visibility text not null default 'agency',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.agency_fit_request_status_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.agency_fit_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.agency_fit_enforce_request_org_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select afr.organization_id
  into v_org_id
  from public.agency_fit_requests afr
  where afr.id = new.request_id;

  if v_org_id is null then
    raise exception 'Invalid agency FIT request_id %. Parent request not found.', new.request_id
      using errcode = '23503';
  end if;

  if new.organization_id is null then
    new.organization_id := v_org_id;
  end if;

  if new.organization_id is distinct from v_org_id then
    raise exception 'organization_id mismatch for agency FIT request %. Expected %, got %.', new.request_id, v_org_id, new.organization_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists agency_fit_request_messages_enforce_org on public.agency_fit_request_messages;
create trigger agency_fit_request_messages_enforce_org
before insert or update on public.agency_fit_request_messages
for each row execute function public.agency_fit_enforce_request_org_v1();

drop trigger if exists agency_fit_request_files_enforce_org on public.agency_fit_request_files;
create trigger agency_fit_request_files_enforce_org
before insert or update on public.agency_fit_request_files
for each row execute function public.agency_fit_enforce_request_org_v1();

drop trigger if exists agency_fit_request_status_history_enforce_org on public.agency_fit_request_status_history;
create trigger agency_fit_request_status_history_enforce_org
before insert or update on public.agency_fit_request_status_history
for each row execute function public.agency_fit_enforce_request_org_v1();

create index if not exists idx_agency_fit_messages_request_created
  on public.agency_fit_request_messages (request_id, created_at);

create index if not exists idx_agency_fit_files_request_created
  on public.agency_fit_request_files (request_id, created_at desc);

create index if not exists idx_agency_fit_status_history_request_created
  on public.agency_fit_request_status_history (request_id, created_at desc);

alter table public.agency_commission_snapshots
  add column if not exists snapshot_version integer not null default 1,
  add column if not exists is_current boolean not null default true,
  add column if not exists sales_agent_commission_status text not null default 'estimated';

alter table public.agency_commission_snapshots
  drop constraint if exists agency_commission_snapshots_gross_type_check;

alter table public.agency_commission_snapshots
  add constraint agency_commission_snapshots_gross_type_check
  check (gross_agency_commission_type in ('percentage', 'fixed_amount'));

alter table public.agency_commission_snapshots
  drop constraint if exists agency_commission_snapshots_agent_type_check;

alter table public.agency_commission_snapshots
  add constraint agency_commission_snapshots_agent_type_check
  check (sales_agent_commission_type in ('percentage', 'fixed_amount'));

alter table public.agency_commission_snapshots
  drop constraint if exists agency_commission_snapshots_financial_check;

alter table public.agency_commission_snapshots
  add constraint agency_commission_snapshots_financial_check check (
    snapshot_version > 0
    and eligible_sale_amount_mad >= 0
    and gross_agency_commission_value >= 0
    and gross_agency_commission_amount_mad >= 0
    and sales_agent_commission_value >= 0
    and sales_agent_commission_amount_mad >= 0
    and sales_agent_commission_amount_mad <= gross_agency_commission_amount_mad
    and agency_net_commission_amount_mad >= 0
    and agency_net_commission_amount_mad = gross_agency_commission_amount_mad - sales_agent_commission_amount_mad
  );

create unique index if not exists agency_commission_snapshots_fit_request_version_unique
  on public.agency_commission_snapshots (agency_fit_request_id, snapshot_version)
  where agency_fit_request_id is not null;

create unique index if not exists agency_commission_snapshots_booking_version_unique
  on public.agency_commission_snapshots (booking_id, snapshot_version)
  where booking_id is not null;

create unique index if not exists agency_commission_snapshots_fit_request_current_unique
  on public.agency_commission_snapshots (agency_fit_request_id)
  where agency_fit_request_id is not null and is_current = true;

create unique index if not exists agency_commission_snapshots_booking_current_unique
  on public.agency_commission_snapshots (booking_id)
  where booking_id is not null and is_current = true;

create index if not exists idx_agency_commission_snapshots_org_created
  on public.agency_commission_snapshots (organization_id, created_at desc);

create index if not exists idx_agency_commission_snapshots_agent_created
  on public.agency_commission_snapshots (sales_agent_id, created_at desc);

create or replace function public.agency_commission_snapshots_guard_v1()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Commission snapshots are immutable and cannot be deleted.';
  end if;

  if tg_op = 'UPDATE' then
    if old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.sales_agent_id is distinct from new.sales_agent_id
      or old.agency_fit_request_id is distinct from new.agency_fit_request_id
      or old.fit_quote_id is distinct from new.fit_quote_id
      or old.booking_id is distinct from new.booking_id
      or old.snapshot_version is distinct from new.snapshot_version
      or old.eligible_sale_amount_mad is distinct from new.eligible_sale_amount_mad
      or old.gross_agency_commission_type is distinct from new.gross_agency_commission_type
      or old.gross_agency_commission_value is distinct from new.gross_agency_commission_value
      or old.gross_agency_commission_amount_mad is distinct from new.gross_agency_commission_amount_mad
      or old.sales_agent_commission_type is distinct from new.sales_agent_commission_type
      or old.sales_agent_commission_value is distinct from new.sales_agent_commission_value
      or old.sales_agent_commission_amount_mad is distinct from new.sales_agent_commission_amount_mad
      or old.sales_agent_commission_status is distinct from new.sales_agent_commission_status
      or old.agency_net_commission_amount_mad is distinct from new.agency_net_commission_amount_mad
      or old.calculated_at is distinct from new.calculated_at
      or old.rule_source is distinct from new.rule_source
      or old.metadata is distinct from new.metadata
      or old.created_by is distinct from new.created_by
      or old.created_at is distinct from new.created_at then
      raise exception 'Commission snapshots are immutable. Only is_current can be updated.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists agency_commission_snapshots_immutable_guard on public.agency_commission_snapshots;
create trigger agency_commission_snapshots_immutable_guard
before update or delete on public.agency_commission_snapshots
for each row execute function public.agency_commission_snapshots_guard_v1();

create or replace function public.calculate_agency_dual_commission_snapshot_v1(
  p_organization_id uuid,
  p_sales_agent_id uuid,
  p_eligible_sale_amount_mad numeric,
  p_gross_type text,
  p_gross_value numeric,
  p_agent_type text default 'fixed_amount',
  p_agent_value numeric default 0,
  p_rule_source text default null
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_basis numeric := greatest(coalesce(p_eligible_sale_amount_mad, 0), 0);
  v_gross_type text := public.agency_fit_normalize_commission_type_v1(p_gross_type);
  v_agent_type text := public.agency_fit_normalize_commission_type_v1(p_agent_type);
  v_gross numeric := 0;
  v_agent numeric := 0;
begin
  if v_gross_type = 'fixed_amount' then
    v_gross := greatest(coalesce(p_gross_value, 0), 0);
  else
    v_gross := round(v_basis * greatest(coalesce(p_gross_value, 0), 0) / 100);
  end if;

  if p_sales_agent_id is null then
    v_agent := 0;
  elsif v_agent_type = 'percentage' then
    v_agent := round(v_basis * greatest(coalesce(p_agent_value, 0), 0) / 100);
  else
    v_agent := greatest(coalesce(p_agent_value, 0), 0);
  end if;

  v_agent := least(v_agent, v_gross);

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'sales_agent_id', p_sales_agent_id,
    'eligible_sale_amount_mad', v_basis,
    'gross_agency_commission_type', v_gross_type,
    'gross_agency_commission_value', greatest(coalesce(p_gross_value, 0), 0),
    'gross_agency_commission_amount_mad', v_gross,
    'sales_agent_commission_type', v_agent_type,
    'sales_agent_commission_value', greatest(coalesce(p_agent_value, 0), 0),
    'sales_agent_commission_amount_mad', v_agent,
    'agency_net_commission_amount_mad', greatest(v_gross - v_agent, 0),
    'calculated_at', now(),
    'rule_source', p_rule_source
  );
end;
$$;

create or replace function public.create_agency_commission_snapshot_v1(
  p_organization_id uuid,
  p_sales_agent_id uuid,
  p_agency_fit_request_id uuid,
  p_fit_quote_id uuid,
  p_booking_id uuid,
  p_eligible_sale_amount_mad numeric,
  p_gross_type text,
  p_gross_value numeric,
  p_agent_type text default 'fixed_amount',
  p_agent_value numeric default 0,
  p_sales_agent_commission_status text default 'estimated',
  p_rule_source text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_version integer;
  v_id uuid;
begin
  if not public.agency_fit_is_staff_v1(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  v_snapshot := public.calculate_agency_dual_commission_snapshot_v1(
    p_organization_id,
    p_sales_agent_id,
    p_eligible_sale_amount_mad,
    p_gross_type,
    p_gross_value,
    p_agent_type,
    p_agent_value,
    p_rule_source
  );

  select coalesce(max(snapshot_version), 0) + 1
  into v_version
  from public.agency_commission_snapshots
  where (p_agency_fit_request_id is not null and agency_fit_request_id = p_agency_fit_request_id)
     or (p_booking_id is not null and booking_id = p_booking_id);

  update public.agency_commission_snapshots
  set is_current = false
  where is_current = true
    and (
      (p_agency_fit_request_id is not null and agency_fit_request_id = p_agency_fit_request_id)
      or (p_booking_id is not null and booking_id = p_booking_id)
    );

  insert into public.agency_commission_snapshots (
    organization_id,
    sales_agent_id,
    agency_fit_request_id,
    fit_quote_id,
    booking_id,
    snapshot_version,
    is_current,
    eligible_sale_amount_mad,
    gross_agency_commission_type,
    gross_agency_commission_value,
    gross_agency_commission_amount_mad,
    sales_agent_commission_type,
    sales_agent_commission_value,
    sales_agent_commission_amount_mad,
    sales_agent_commission_status,
    agency_net_commission_amount_mad,
    calculated_at,
    rule_source,
    metadata,
    created_by
  )
  values (
    p_organization_id,
    p_sales_agent_id,
    p_agency_fit_request_id,
    p_fit_quote_id,
    p_booking_id,
    v_version,
    true,
    (v_snapshot->>'eligible_sale_amount_mad')::numeric,
    v_snapshot->>'gross_agency_commission_type',
    (v_snapshot->>'gross_agency_commission_value')::numeric,
    (v_snapshot->>'gross_agency_commission_amount_mad')::numeric,
    v_snapshot->>'sales_agent_commission_type',
    (v_snapshot->>'sales_agent_commission_value')::numeric,
    (v_snapshot->>'sales_agent_commission_amount_mad')::numeric,
    coalesce(nullif(p_sales_agent_commission_status, ''), 'estimated'),
    (v_snapshot->>'agency_net_commission_amount_mad')::numeric,
    now(),
    p_rule_source,
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid()
  )
  returning id into v_id;

  if p_agency_fit_request_id is not null then
    update public.agency_fit_requests
    set sales_agent_id = coalesce(sales_agent_id, p_sales_agent_id)
    where id = p_agency_fit_request_id
      and p_sales_agent_id is not null;
  end if;

  return v_id;
end;
$$;

alter table public.commission_engine_rules
  add column if not exists rule_type text,
  add column if not exists value numeric,
  add column if not exists product_type text,
  add column if not exists trip_id uuid references public.trips(id) on delete set null,
  add column if not exists starts_at date,
  add column if not exists ends_at date,
  add column if not exists gross_agency_commission_type text,
  add column if not exists gross_agency_commission_value numeric,
  add column if not exists sales_agent_commission_type text,
  add column if not exists sales_agent_commission_value numeric,
  add column if not exists sales_agent_commission_max_value numeric,
  add column if not exists sales_agent_commission_editable_by_owner boolean not null default false;

do $$
declare
  v_commission_type_expr text;
  v_commission_value_expr text;
  v_product_trip_id_expr text;
  v_effective_from_expr text;
  v_effective_to_expr text;
begin
  v_commission_type_expr := case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commission_engine_rules'
      and column_name = 'commission_type'
  ) then 'commission_type::text' else 'null::text' end;

  v_commission_value_expr := case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commission_engine_rules'
      and column_name = 'commission_value'
  ) then 'commission_value::numeric' else 'null::numeric' end;

  v_product_trip_id_expr := case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commission_engine_rules'
      and column_name = 'product_trip_id'
  ) then 'product_trip_id::uuid' else 'null::uuid' end;

  v_effective_from_expr := case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commission_engine_rules'
      and column_name = 'effective_from'
  ) then 'effective_from::date' else 'null::date' end;

  v_effective_to_expr := case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commission_engine_rules'
      and column_name = 'effective_to'
  ) then 'effective_to::date' else 'null::date' end;

  execute format($sql$
    update public.commission_engine_rules
    set
      rule_type = public.agency_fit_normalize_commission_type_v1(coalesce(rule_type, %1$s)),
      value = greatest(coalesce(value, %2$s, 0), 0),
      trip_id = coalesce(trip_id, %3$s),
      starts_at = coalesce(starts_at, %4$s),
      ends_at = coalesce(ends_at, %5$s),
      gross_agency_commission_type = public.agency_fit_normalize_commission_type_v1(coalesce(gross_agency_commission_type, rule_type, %1$s)),
      gross_agency_commission_value = greatest(coalesce(gross_agency_commission_value, value, %2$s, 0), 0),
      sales_agent_commission_type = public.agency_fit_normalize_commission_type_v1(coalesce(sales_agent_commission_type, 'fixed_amount')),
      sales_agent_commission_value = greatest(coalesce(sales_agent_commission_value, 0), 0)
    where true
  $sql$,
    v_commission_type_expr,
    v_commission_value_expr,
    v_product_trip_id_expr,
    v_effective_from_expr,
    v_effective_to_expr
  );
end;
$$;

alter table public.commission_engine_rules
  drop constraint if exists commission_engine_rules_rule_type_check;

alter table public.commission_engine_rules
  add constraint commission_engine_rules_rule_type_check
  check (rule_type in ('percentage', 'fixed_amount'));

alter table public.commission_engine_rules
  drop constraint if exists commission_engine_rules_dual_commission_check;

alter table public.commission_engine_rules
  add constraint commission_engine_rules_dual_commission_check check (
    coalesce(value, 0) >= 0
    and coalesce(gross_agency_commission_value, 0) >= 0
    and coalesce(sales_agent_commission_value, 0) >= 0
    and coalesce(sales_agent_commission_max_value, 0) >= 0
  );

create or replace function public.agency_fit_status_history_capture_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.agency_fit_request_status_history (
      request_id,
      organization_id,
      changed_by,
      old_status,
      new_status,
      reason,
      metadata
    )
    values (
      new.id,
      new.organization_id,
      auth.uid(),
      null,
      new.status,
      'created',
      '{}'::jsonb
    );
  elsif new.status is distinct from old.status then
    insert into public.agency_fit_request_status_history (
      request_id,
      organization_id,
      changed_by,
      old_status,
      new_status,
      reason,
      metadata
    )
    values (
      new.id,
      new.organization_id,
      auth.uid(),
      old.status,
      new.status,
      'status_changed',
      '{}'::jsonb
    );
  end if;
  return new;
end;
$$;

drop trigger if exists agency_fit_status_history_after_write on public.agency_fit_requests;
drop trigger if exists agency_fit_status_history_v1_after_write on public.agency_fit_requests;
create trigger agency_fit_status_history_v1_after_write
after insert or update of status on public.agency_fit_requests
for each row execute function public.agency_fit_status_history_capture_v1();

drop view if exists public.agency_fit_sales_agent_commissions;
drop view if exists public.agency_fit_owner_commissions;
drop view if exists public.agency_fit_admin_commissions;

create view public.agency_fit_sales_agent_commissions
with (security_barrier = true)
as
select
  s.id,
  s.organization_id,
  s.sales_agent_id,
  s.agency_fit_request_id,
  s.fit_quote_id,
  s.booking_id,
  s.snapshot_version,
  s.is_current,
  s.sales_agent_commission_amount_mad,
  s.sales_agent_commission_status,
  s.calculated_at,
  s.created_at
from public.agency_commission_snapshots s
where s.sales_agent_id = auth.uid();

create view public.agency_fit_owner_commissions
with (security_barrier = true)
as
select
  s.id,
  s.organization_id,
  s.sales_agent_id,
  s.agency_fit_request_id,
  s.fit_quote_id,
  s.booking_id,
  s.snapshot_version,
  s.is_current,
  s.eligible_sale_amount_mad,
  s.gross_agency_commission_type,
  s.gross_agency_commission_value,
  s.gross_agency_commission_amount_mad,
  s.sales_agent_commission_type,
  s.sales_agent_commission_value,
  s.sales_agent_commission_amount_mad,
  s.sales_agent_commission_status,
  s.agency_net_commission_amount_mad,
  s.calculated_at,
  s.rule_source,
  s.created_at
from public.agency_commission_snapshots s
where public.agency_fit_is_owner_manager_v1(auth.uid(), s.organization_id)
   or public.agency_fit_is_finance_v1(auth.uid(), s.organization_id);

create view public.agency_fit_admin_commissions
with (security_barrier = true)
as
select *
from public.agency_commission_snapshots s
where public.agency_fit_is_staff_v1(auth.uid());

grant select on public.agency_fit_sales_agent_commissions to authenticated;
grant select on public.agency_fit_owner_commissions to authenticated;
grant select on public.agency_fit_admin_commissions to authenticated;
grant execute on function public.create_agency_commission_snapshot_v1(uuid, uuid, uuid, uuid, uuid, numeric, text, numeric, text, numeric, text, text, jsonb) to authenticated;

insert into storage.buckets (id, name, public)
values ('agency-fit-requests', 'agency-fit-requests', false)
on conflict (id) do update set public = false;

alter table public.agency_fit_requests enable row level security;
alter table public.agency_fit_request_messages enable row level security;
alter table public.agency_fit_request_files enable row level security;
alter table public.agency_fit_request_status_history enable row level security;
alter table public.agency_commission_snapshots enable row level security;

drop policy if exists "staff manage agency fit requests" on public.agency_fit_requests;
drop policy if exists "agency manage own fit requests" on public.agency_fit_requests;

drop policy if exists "agency fit staff select requests v1" on public.agency_fit_requests;
create policy "agency fit staff select requests v1"
on public.agency_fit_requests for select
using (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit staff insert requests v1" on public.agency_fit_requests;
create policy "agency fit staff insert requests v1"
on public.agency_fit_requests for insert
with check (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit staff update requests v1" on public.agency_fit_requests;
create policy "agency fit staff update requests v1"
on public.agency_fit_requests for update
using (public.agency_fit_is_staff_v1(auth.uid()))
with check (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit staff delete requests v1" on public.agency_fit_requests;
create policy "agency fit staff delete requests v1"
on public.agency_fit_requests for delete
using (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit owner manager select requests v1" on public.agency_fit_requests;
create policy "agency fit owner manager select requests v1"
on public.agency_fit_requests for select
using (public.agency_fit_is_owner_manager_v1(auth.uid(), organization_id));

drop policy if exists "agency fit finance select requests v1" on public.agency_fit_requests;
create policy "agency fit finance select requests v1"
on public.agency_fit_requests for select
using (public.agency_fit_is_finance_v1(auth.uid(), organization_id));

drop policy if exists "agency fit operations select requests v1" on public.agency_fit_requests;
create policy "agency fit operations select requests v1"
on public.agency_fit_requests for select
using (public.agency_fit_is_operations_v1(auth.uid(), organization_id));

drop policy if exists "agency fit sales select own requests v1" on public.agency_fit_requests;
create policy "agency fit sales select own requests v1"
on public.agency_fit_requests for select
using (
  public.agency_fit_is_sales_agent_v1(auth.uid(), organization_id)
  and (
    requested_by = auth.uid()
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or assigned_sales_agent_id = auth.uid()
    or sales_agent_id = auth.uid()
  )
);

drop policy if exists "agency fit owner manager insert requests v1" on public.agency_fit_requests;
create policy "agency fit owner manager insert requests v1"
on public.agency_fit_requests for insert
with check (
  public.agency_fit_is_owner_manager_v1(auth.uid(), organization_id)
  and coalesce(created_by, requested_by, auth.uid()) = auth.uid()
);

drop policy if exists "agency fit sales insert own requests v1" on public.agency_fit_requests;
create policy "agency fit sales insert own requests v1"
on public.agency_fit_requests for insert
with check (
  public.agency_fit_is_sales_agent_v1(auth.uid(), organization_id)
  and coalesce(created_by, requested_by, auth.uid()) = auth.uid()
  and coalesce(assigned_sales_agent_id, assigned_to, sales_agent_id, auth.uid()) = auth.uid()
);

drop policy if exists "agency fit owner manager update requests v1" on public.agency_fit_requests;
create policy "agency fit owner manager update requests v1"
on public.agency_fit_requests for update
using (public.agency_fit_is_owner_manager_v1(auth.uid(), organization_id))
with check (public.agency_fit_is_owner_manager_v1(auth.uid(), organization_id));

drop policy if exists "agency fit sales update own editable requests v1" on public.agency_fit_requests;
create policy "agency fit sales update own editable requests v1"
on public.agency_fit_requests for update
using (
  public.agency_fit_is_sales_agent_v1(auth.uid(), organization_id)
  and status in ('draft', 'information_required', 'revision_requested', 'missing_info')
  and (
    requested_by = auth.uid()
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or assigned_sales_agent_id = auth.uid()
    or sales_agent_id = auth.uid()
  )
)
with check (
  public.agency_fit_is_sales_agent_v1(auth.uid(), organization_id)
  and status in ('draft', 'information_required', 'revision_requested', 'missing_info')
  and (
    requested_by = auth.uid()
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or assigned_sales_agent_id = auth.uid()
    or sales_agent_id = auth.uid()
  )
);

drop policy if exists "agency fit owner manager delete draft requests v1" on public.agency_fit_requests;
create policy "agency fit owner manager delete draft requests v1"
on public.agency_fit_requests for delete
using (
  public.agency_fit_is_owner_manager_v1(auth.uid(), organization_id)
  and status in ('draft', 'cancelled', 'archived')
);

drop policy if exists "agency fit sales delete own draft requests v1" on public.agency_fit_requests;
create policy "agency fit sales delete own draft requests v1"
on public.agency_fit_requests for delete
using (
  public.agency_fit_is_sales_agent_v1(auth.uid(), organization_id)
  and status = 'draft'
  and (
    requested_by = auth.uid()
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or assigned_sales_agent_id = auth.uid()
    or sales_agent_id = auth.uid()
  )
);

drop policy if exists "staff manage agency fit messages" on public.agency_fit_request_messages;
drop policy if exists "agency manage own fit messages" on public.agency_fit_request_messages;

drop policy if exists "agency fit staff manage messages v1" on public.agency_fit_request_messages;
create policy "agency fit staff manage messages v1"
on public.agency_fit_request_messages for all
using (public.agency_fit_is_staff_v1(auth.uid()))
with check (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit org select messages v1" on public.agency_fit_request_messages;
create policy "agency fit org select messages v1"
on public.agency_fit_request_messages for select
using (
  visibility in ('agency', 'all')
  and exists (
    select 1
    from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and (
        public.agency_fit_is_owner_manager_v1(auth.uid(), r.organization_id)
        or public.agency_fit_is_finance_v1(auth.uid(), r.organization_id)
        or public.agency_fit_is_operations_v1(auth.uid(), r.organization_id)
        or (
          public.agency_fit_is_sales_agent_v1(auth.uid(), r.organization_id)
          and (
            r.requested_by = auth.uid()
            or r.created_by = auth.uid()
            or r.assigned_to = auth.uid()
            or r.assigned_sales_agent_id = auth.uid()
            or r.sales_agent_id = auth.uid()
          )
        )
      )
  )
);

drop policy if exists "agency fit org insert messages v1" on public.agency_fit_request_messages;
create policy "agency fit org insert messages v1"
on public.agency_fit_request_messages for insert
with check (
  visibility in ('agency', 'all')
  and exists (
    select 1
    from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "agency fit author update messages v1" on public.agency_fit_request_messages;
create policy "agency fit author update messages v1"
on public.agency_fit_request_messages for update
using (
  sender_id = auth.uid()
  and visibility in ('agency', 'all')
  and exists (
    select 1 from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
)
with check (
  sender_id = auth.uid()
  and visibility in ('agency', 'all')
  and exists (
    select 1 from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "agency fit author delete messages v1" on public.agency_fit_request_messages;
create policy "agency fit author delete messages v1"
on public.agency_fit_request_messages for delete
using (
  sender_id = auth.uid()
  and exists (
    select 1 from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "staff manage agency fit files" on public.agency_fit_request_files;
drop policy if exists "agency manage own fit files" on public.agency_fit_request_files;

drop policy if exists "agency fit staff manage files v1" on public.agency_fit_request_files;
create policy "agency fit staff manage files v1"
on public.agency_fit_request_files for all
using (public.agency_fit_is_staff_v1(auth.uid()))
with check (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit org select files v1" on public.agency_fit_request_files;
create policy "agency fit org select files v1"
on public.agency_fit_request_files for select
using (
  visibility in ('agency', 'all')
  and exists (
    select 1 from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "agency fit org insert files v1" on public.agency_fit_request_files;
create policy "agency fit org insert files v1"
on public.agency_fit_request_files for insert
with check (
  visibility in ('agency', 'all')
  and exists (
    select 1 from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "agency fit uploader delete draft files v1" on public.agency_fit_request_files;
create policy "agency fit uploader delete draft files v1"
on public.agency_fit_request_files for delete
using (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and r.status = 'draft'
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "staff read agency fit status history" on public.agency_fit_request_status_history;
drop policy if exists "agency read own fit status history" on public.agency_fit_request_status_history;

drop policy if exists "agency fit staff read status history v1" on public.agency_fit_request_status_history;
create policy "agency fit staff read status history v1"
on public.agency_fit_request_status_history for select
using (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit org read status history v1" on public.agency_fit_request_status_history;
create policy "agency fit org read status history v1"
on public.agency_fit_request_status_history for select
using (
  exists (
    select 1 from public.agency_fit_requests r
    where r.id = request_id
      and r.organization_id = organization_id
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "staff manage agency commission snapshots" on public.agency_commission_snapshots;
drop policy if exists "agency read permitted commission snapshots" on public.agency_commission_snapshots;

drop policy if exists "agency fit staff manage commission snapshots v1" on public.agency_commission_snapshots;
create policy "agency fit staff manage commission snapshots v1"
on public.agency_commission_snapshots for all
using (public.agency_fit_is_staff_v1(auth.uid()))
with check (public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit owner finance read commission snapshots v1" on public.agency_commission_snapshots;
create policy "agency fit owner finance read commission snapshots v1"
on public.agency_commission_snapshots for select
using (
  public.agency_fit_is_owner_manager_v1(auth.uid(), organization_id)
  or public.agency_fit_is_finance_v1(auth.uid(), organization_id)
);

drop policy if exists "staff manage agency fit request storage" on storage.objects;
drop policy if exists "agency manage own fit request storage" on storage.objects;

drop policy if exists "agency fit staff manage request storage v1" on storage.objects;
create policy "agency fit staff manage request storage v1"
on storage.objects for all
using (bucket_id = 'agency-fit-requests' and public.agency_fit_is_staff_v1(auth.uid()))
with check (bucket_id = 'agency-fit-requests' and public.agency_fit_is_staff_v1(auth.uid()));

drop policy if exists "agency fit org read request storage v1" on storage.objects;
create policy "agency fit org read request storage v1"
on storage.objects for select
using (
  bucket_id = 'agency-fit-requests'
  and array_length(storage.foldername(name), 1) >= 2
  and exists (
    select 1
    from public.agency_fit_requests r
    where r.organization_id::text = (storage.foldername(name))[1]
      and r.id::text = (storage.foldername(name))[2]
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "agency fit org insert request storage v1" on storage.objects;
create policy "agency fit org insert request storage v1"
on storage.objects for insert
with check (
  bucket_id = 'agency-fit-requests'
  and array_length(storage.foldername(name), 1) >= 2
  and exists (
    select 1
    from public.agency_fit_requests r
    where r.organization_id::text = (storage.foldername(name))[1]
      and r.id::text = (storage.foldername(name))[2]
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "agency fit org update request storage v1" on storage.objects;
create policy "agency fit org update request storage v1"
on storage.objects for update
using (
  bucket_id = 'agency-fit-requests'
  and array_length(storage.foldername(name), 1) >= 2
  and exists (
    select 1
    from public.agency_fit_requests r
    where r.organization_id::text = (storage.foldername(name))[1]
      and r.id::text = (storage.foldername(name))[2]
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
)
with check (
  bucket_id = 'agency-fit-requests'
  and array_length(storage.foldername(name), 1) >= 2
  and exists (
    select 1
    from public.agency_fit_requests r
    where r.organization_id::text = (storage.foldername(name))[1]
      and r.id::text = (storage.foldername(name))[2]
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

drop policy if exists "agency fit org delete draft request storage v1" on storage.objects;
create policy "agency fit org delete draft request storage v1"
on storage.objects for delete
using (
  bucket_id = 'agency-fit-requests'
  and array_length(storage.foldername(name), 1) >= 2
  and exists (
    select 1
    from public.agency_fit_requests r
    where r.organization_id::text = (storage.foldername(name))[1]
      and r.id::text = (storage.foldername(name))[2]
      and r.status = 'draft'
      and public.agency_fit_is_org_member_v1(auth.uid(), r.organization_id)
  )
);

notify pgrst, 'reload schema';
