-- Partner request -> agency onboarding conversion flow.
-- This migration is defensive because several admin/agency screens already use these tables.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.partner_requests (
  id uuid primary key default gen_random_uuid(),
  agency_name text not null,
  manager_name text,
  email text,
  phone text,
  city_country text,
  website_social text,
  partnership_type text,
  message text,
  status text not null default 'new',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.partner_requests add column if not exists agency_name text;
alter table public.partner_requests add column if not exists manager_name text;
alter table public.partner_requests add column if not exists email text;
alter table public.partner_requests add column if not exists phone text;
alter table public.partner_requests add column if not exists city_country text;
alter table public.partner_requests add column if not exists website_social text;
alter table public.partner_requests add column if not exists partnership_type text;
alter table public.partner_requests add column if not exists message text;
alter table public.partner_requests add column if not exists status text not null default 'new';
alter table public.partner_requests add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.partner_requests add column if not exists reviewed_at timestamptz;
alter table public.partner_requests add column if not exists deleted_at timestamptz;
alter table public.partner_requests add column if not exists deleted_by uuid references auth.users(id) on delete set null;
alter table public.partner_requests add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.partner_requests add column if not exists created_at timestamptz not null default now();
alter table public.partner_requests add column if not exists updated_at timestamptz not null default now();

drop trigger if exists partner_requests_updated_at on public.partner_requests;
create trigger partner_requests_updated_at
before update on public.partner_requests
for each row execute function public.set_updated_at();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'agency',
  status text not null default 'pending',
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

alter table public.organizations add column if not exists type text not null default 'agency';
alter table public.organizations add column if not exists status text not null default 'pending';
alter table public.organizations add column if not exists display_name text;
alter table public.organizations add column if not exists legal_name text;
alter table public.organizations add column if not exists email text;
alter table public.organizations add column if not exists phone text;
alter table public.organizations add column if not exists website text;
alter table public.organizations add column if not exists address_line_1 text;
alter table public.organizations add column if not exists address_line_2 text;
alter table public.organizations add column if not exists city text;
alter table public.organizations add column if not exists postal_code text;
alter table public.organizations add column if not exists country text;
alter table public.organizations add column if not exists tax_identifier text;
alter table public.organizations add column if not exists notes text;
alter table public.organizations add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.organizations add column if not exists created_at timestamptz not null default now();
alter table public.organizations add column if not exists updated_at timestamptz not null default now();

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.agency_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  agency_code text,
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
  default_commission_type text,
  default_commission_value numeric,
  commission_currency text,
  commission_notes text,
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  commercial_notes text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agency_profiles add column if not exists agency_code text;
alter table public.agency_profiles add column if not exists commercial_name text;
alter table public.agency_profiles add column if not exists contact_name text;
alter table public.agency_profiles add column if not exists contact_email text;
alter table public.agency_profiles add column if not exists contact_phone text;
alter table public.agency_profiles add column if not exists website text;
alter table public.agency_profiles add column if not exists market_country text;
alter table public.agency_profiles add column if not exists preferred_language text;
alter table public.agency_profiles add column if not exists billing_legal_name text;
alter table public.agency_profiles add column if not exists billing_email text;
alter table public.agency_profiles add column if not exists billing_phone text;
alter table public.agency_profiles add column if not exists billing_address_line_1 text;
alter table public.agency_profiles add column if not exists billing_address_line_2 text;
alter table public.agency_profiles add column if not exists billing_city text;
alter table public.agency_profiles add column if not exists billing_postal_code text;
alter table public.agency_profiles add column if not exists billing_country text;
alter table public.agency_profiles add column if not exists tax_identifier text;
alter table public.agency_profiles add column if not exists payment_terms text;
alter table public.agency_profiles add column if not exists default_commission_type text;
alter table public.agency_profiles add column if not exists default_commission_value numeric;
alter table public.agency_profiles add column if not exists commission_currency text;
alter table public.agency_profiles add column if not exists commission_notes text;
alter table public.agency_profiles add column if not exists bank_name text;
alter table public.agency_profiles add column if not exists bank_account_name text;
alter table public.agency_profiles add column if not exists bank_account_number text;
alter table public.agency_profiles add column if not exists commercial_notes text;
alter table public.agency_profiles add column if not exists notes text;
alter table public.agency_profiles add column if not exists created_at timestamptz not null default now();
alter table public.agency_profiles add column if not exists updated_at timestamptz not null default now();

drop trigger if exists agency_profiles_updated_at on public.agency_profiles;
create trigger agency_profiles_updated_at
before update on public.agency_profiles
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'agency_profiles_agency_code_unique'
  ) and not exists (
    select 1
    from public.agency_profiles
    where agency_code is not null and agency_code <> ''
    group by agency_code
    having count(*) > 1
  ) then
    create unique index agency_profiles_agency_code_unique
    on public.agency_profiles (agency_code)
    where agency_code is not null and agency_code <> '';
  end if;
end;
$$;

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent',
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_members add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.organization_members add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.organization_members add column if not exists role text not null default 'agent';
alter table public.organization_members add column if not exists status text not null default 'active';
alter table public.organization_members add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.organization_members add column if not exists created_at timestamptz not null default now();
alter table public.organization_members add column if not exists updated_at timestamptz not null default now();

drop trigger if exists organization_members_updated_at on public.organization_members;
create trigger organization_members_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'organization_members_org_user_unique'
  ) and not exists (
    select 1
    from public.organization_members
    where organization_id is not null and user_id is not null
    group by organization_id, user_id
    having count(*) > 1
  ) then
    create unique index organization_members_org_user_unique
    on public.organization_members (organization_id, user_id);
  end if;
end;
$$;

create table if not exists public.organization_member_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_member_id uuid not null references public.organization_members(id) on delete cascade,
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

alter table public.organization_member_profiles add column if not exists organization_member_id uuid references public.organization_members(id) on delete cascade;
alter table public.organization_member_profiles add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.organization_member_profiles add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.organization_member_profiles add column if not exists full_name text;
alter table public.organization_member_profiles add column if not exists email text;
alter table public.organization_member_profiles add column if not exists phone text;
alter table public.organization_member_profiles add column if not exists secondary_phone text;
alter table public.organization_member_profiles add column if not exists secondary_email text;
alter table public.organization_member_profiles add column if not exists position_title text;
alter table public.organization_member_profiles add column if not exists point_of_sale text;
alter table public.organization_member_profiles add column if not exists notes text;
alter table public.organization_member_profiles add column if not exists created_at timestamptz not null default now();
alter table public.organization_member_profiles add column if not exists updated_at timestamptz not null default now();

drop trigger if exists organization_member_profiles_updated_at on public.organization_member_profiles;
create trigger organization_member_profiles_updated_at
before update on public.organization_member_profiles
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'organization_member_profiles_member_unique'
  ) and not exists (
    select 1
    from public.organization_member_profiles
    where organization_member_id is not null
    group by organization_member_id
    having count(*) > 1
  ) then
    create unique index organization_member_profiles_member_unique
    on public.organization_member_profiles (organization_member_id);
  end if;
end;
$$;

create table if not exists public.partner_onboarding_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_request_id uuid references public.partner_requests(id) on delete set null,
  status text not null default 'draft',
  form_data jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  review_notes text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.partner_onboarding_cases add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.partner_onboarding_cases add column if not exists partner_request_id uuid references public.partner_requests(id) on delete set null;
alter table public.partner_onboarding_cases add column if not exists status text not null default 'draft';
alter table public.partner_onboarding_cases add column if not exists form_data jsonb not null default '{}'::jsonb;
alter table public.partner_onboarding_cases add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.partner_onboarding_cases add column if not exists review_notes text;
alter table public.partner_onboarding_cases add column if not exists submitted_at timestamptz;
alter table public.partner_onboarding_cases add column if not exists reviewed_at timestamptz;
alter table public.partner_onboarding_cases add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.partner_onboarding_cases add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.partner_onboarding_cases add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.partner_onboarding_cases add column if not exists created_at timestamptz not null default now();
alter table public.partner_onboarding_cases add column if not exists updated_at timestamptz not null default now();

drop trigger if exists partner_onboarding_cases_updated_at on public.partner_onboarding_cases;
create trigger partner_onboarding_cases_updated_at
before update on public.partner_onboarding_cases
for each row execute function public.set_updated_at();

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'partner_onboarding_cases_partner_request_unique'
  ) and not exists (
    select 1
    from public.partner_onboarding_cases
    where partner_request_id is not null
    group by partner_request_id
    having count(*) > 1
  ) then
    create unique index partner_onboarding_cases_partner_request_unique
    on public.partner_onboarding_cases (partner_request_id)
    where partner_request_id is not null;
  end if;
end;
$$;

create index if not exists partner_onboarding_cases_organization_idx
on public.partner_onboarding_cases (organization_id, created_at desc);

create table if not exists public.partner_onboarding_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  onboarding_case_id uuid references public.partner_onboarding_cases(id) on delete cascade,
  document_type text not null,
  file_name text,
  file_path text not null,
  mime_type text,
  file_size bigint,
  status text not null default 'received',
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.partner_onboarding_documents add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.partner_onboarding_documents add column if not exists onboarding_case_id uuid references public.partner_onboarding_cases(id) on delete cascade;
alter table public.partner_onboarding_documents add column if not exists document_type text;
alter table public.partner_onboarding_documents add column if not exists file_name text;
alter table public.partner_onboarding_documents add column if not exists file_path text;
alter table public.partner_onboarding_documents add column if not exists mime_type text;
alter table public.partner_onboarding_documents add column if not exists file_size bigint;
alter table public.partner_onboarding_documents add column if not exists status text not null default 'received';
alter table public.partner_onboarding_documents add column if not exists uploaded_by uuid references auth.users(id) on delete set null;
alter table public.partner_onboarding_documents add column if not exists created_at timestamptz not null default now();
alter table public.partner_onboarding_documents add column if not exists updated_at timestamptz not null default now();

drop trigger if exists partner_onboarding_documents_updated_at on public.partner_onboarding_documents;
create trigger partner_onboarding_documents_updated_at
before update on public.partner_onboarding_documents
for each row execute function public.set_updated_at();

create index if not exists partner_onboarding_documents_case_idx
on public.partner_onboarding_documents (onboarding_case_id, created_at desc);

create or replace function public.is_org_member(_user_id uuid, _organization_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where user_id = _user_id
      and organization_id = _organization_id
      and status = 'active'
  )
$$;

create or replace function public.submit_partner_request(
  p_agency_name text,
  p_manager_name text,
  p_email text,
  p_phone text,
  p_city_country text default null,
  p_website_social text default null,
  p_partnership_type text default null,
  p_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if nullif(trim(p_agency_name), '') is null
    or nullif(trim(p_manager_name), '') is null
    or nullif(trim(p_email), '') is null
    or nullif(trim(p_phone), '') is null then
    raise exception 'agency_name, manager_name, email and phone are required'
      using errcode = '22023';
  end if;

  insert into public.partner_requests (
    agency_name,
    manager_name,
    email,
    phone,
    city_country,
    website_social,
    partnership_type,
    message,
    status
  )
  values (
    trim(p_agency_name),
    trim(p_manager_name),
    lower(trim(p_email)),
    trim(p_phone),
    nullif(trim(coalesce(p_city_country, '')), ''),
    nullif(trim(coalesce(p_website_social, '')), ''),
    nullif(trim(coalesce(p_partnership_type, '')), ''),
    nullif(trim(coalesce(p_message, '')), ''),
    'new'
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_partner_request(text, text, text, text, text, text, text, text)
to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('partner-onboarding', 'partner-onboarding', false)
on conflict (id) do nothing;

alter table public.partner_requests enable row level security;
alter table public.organizations enable row level security;
alter table public.agency_profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_member_profiles enable row level security;
alter table public.partner_onboarding_cases enable row level security;
alter table public.partner_onboarding_documents enable row level security;

drop policy if exists "staff manage partner requests" on public.partner_requests;
create policy "staff manage partner requests"
on public.partner_requests for all
using (
  public.has_role(auth.uid(), 'super_admin')
  or public.has_role(auth.uid(), 'admin')
  or public.has_role(auth.uid(), 'manager')
)
with check (
  public.has_role(auth.uid(), 'super_admin')
  or public.has_role(auth.uid(), 'admin')
  or public.has_role(auth.uid(), 'manager')
);

drop policy if exists "staff manage organizations" on public.organizations;
create policy "staff manage organizations"
on public.organizations for all
using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'));

drop policy if exists "agency read own organization" on public.organizations;
create policy "agency read own organization"
on public.organizations for select
using (public.is_org_member(auth.uid(), id));

drop policy if exists "staff manage agency profiles" on public.agency_profiles;
create policy "staff manage agency profiles"
on public.agency_profiles for all
using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'));

drop policy if exists "agency read own agency profile" on public.agency_profiles;
create policy "agency read own agency profile"
on public.agency_profiles for select
using (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "staff manage organization members" on public.organization_members;
create policy "staff manage organization members"
on public.organization_members for all
using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'));

drop policy if exists "agency read own organization memberships" on public.organization_members;
create policy "agency read own organization memberships"
on public.organization_members for select
using (user_id = auth.uid() or public.is_org_member(auth.uid(), organization_id));

drop policy if exists "staff manage organization member profiles" on public.organization_member_profiles;
create policy "staff manage organization member profiles"
on public.organization_member_profiles for all
using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'));

drop policy if exists "agency read own organization member profiles" on public.organization_member_profiles;
create policy "agency read own organization member profiles"
on public.organization_member_profiles for select
using (user_id = auth.uid() or public.is_org_member(auth.uid(), organization_id));

drop policy if exists "staff manage partner onboarding cases" on public.partner_onboarding_cases;
create policy "staff manage partner onboarding cases"
on public.partner_onboarding_cases for all
using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'));

drop policy if exists "agency manage own partner onboarding cases" on public.partner_onboarding_cases;
create policy "agency manage own partner onboarding cases"
on public.partner_onboarding_cases for all
using (public.is_org_member(auth.uid(), organization_id))
with check (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "staff manage partner onboarding documents" on public.partner_onboarding_documents;
create policy "staff manage partner onboarding documents"
on public.partner_onboarding_documents for all
using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'));

drop policy if exists "agency manage own partner onboarding documents" on public.partner_onboarding_documents;
create policy "agency manage own partner onboarding documents"
on public.partner_onboarding_documents for all
using (public.is_org_member(auth.uid(), organization_id))
with check (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "staff read partner onboarding storage" on storage.objects;
create policy "staff read partner onboarding storage"
on storage.objects for select
using (
  bucket_id = 'partner-onboarding'
  and (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin'))
);

drop policy if exists "agency manage own partner onboarding storage" on storage.objects;
create policy "agency manage own partner onboarding storage"
on storage.objects for all
using (
  bucket_id = 'partner-onboarding'
  and public.is_org_member(auth.uid(), (storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'partner-onboarding'
  and public.is_org_member(auth.uid(), (storage.foldername(name))[1]::uuid)
);
