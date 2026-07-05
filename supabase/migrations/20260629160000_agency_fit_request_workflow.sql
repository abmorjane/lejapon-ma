create table if not exists public.agency_fit_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in (
    'new',
    'in_progress',
    'missing_info',
    'quote_preparing',
    'quote_sent_to_agency',
    'accepted',
    'declined',
    'archived'
  )),
  client_full_name text not null,
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
  agency_margin_type text not null default 'fixed' check (agency_margin_type in ('fixed', 'percentage')),
  agency_margin_value numeric not null default 0,
  final_client_price numeric,
  quoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agency_fit_requests_org_created_idx
  on public.agency_fit_requests (organization_id, created_at desc);

create index if not exists agency_fit_requests_status_idx
  on public.agency_fit_requests (status, created_at desc);

create index if not exists agency_fit_requests_destination_idx
  on public.agency_fit_requests (destination_country, created_at desc);

drop trigger if exists agency_fit_requests_updated_at on public.agency_fit_requests;
create trigger agency_fit_requests_updated_at
before update on public.agency_fit_requests
for each row execute function public.set_updated_at();

create table if not exists public.agency_fit_request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.agency_fit_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_type text not null default 'agency' check (sender_type in ('agency', 'admin')),
  visibility text not null default 'agency' check (visibility in ('agency', 'admin_internal')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists agency_fit_request_messages_request_idx
  on public.agency_fit_request_messages (request_id, created_at asc);

create table if not exists public.agency_fit_request_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.agency_fit_requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  file_name text not null,
  file_path text not null,
  mime_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create index if not exists agency_fit_request_files_request_idx
  on public.agency_fit_request_files (request_id, created_at desc);

alter table public.agency_fit_requests enable row level security;
alter table public.agency_fit_request_messages enable row level security;
alter table public.agency_fit_request_files enable row level security;

drop policy if exists "staff manage agency fit requests" on public.agency_fit_requests;
create policy "staff manage agency fit requests"
on public.agency_fit_requests for all
using (public.has_any_role(auth.uid(), array['super_admin','admin','manager','sales','sales_user','sales_manager']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','manager','sales','sales_user','sales_manager']::public.app_role[]));

drop policy if exists "agency manage own fit requests" on public.agency_fit_requests;
create policy "agency manage own fit requests"
on public.agency_fit_requests for all
using (public.is_org_member(auth.uid(), organization_id))
with check (public.is_org_member(auth.uid(), organization_id));

drop policy if exists "staff manage agency fit request messages" on public.agency_fit_request_messages;
create policy "staff manage agency fit request messages"
on public.agency_fit_request_messages for all
using (public.has_any_role(auth.uid(), array['super_admin','admin','manager','sales','sales_user','sales_manager']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','manager','sales','sales_user','sales_manager']::public.app_role[]));

drop policy if exists "agency read visible fit request messages" on public.agency_fit_request_messages;
create policy "agency read visible fit request messages"
on public.agency_fit_request_messages for select
using (public.is_org_member(auth.uid(), organization_id) and visibility = 'agency');

drop policy if exists "agency create own fit request messages" on public.agency_fit_request_messages;
create policy "agency create own fit request messages"
on public.agency_fit_request_messages for insert
with check (public.is_org_member(auth.uid(), organization_id) and sender_type = 'agency' and visibility = 'agency');

drop policy if exists "staff manage agency fit request files" on public.agency_fit_request_files;
create policy "staff manage agency fit request files"
on public.agency_fit_request_files for all
using (public.has_any_role(auth.uid(), array['super_admin','admin','manager','sales','sales_user','sales_manager']::public.app_role[]))
with check (public.has_any_role(auth.uid(), array['super_admin','admin','manager','sales','sales_user','sales_manager']::public.app_role[]));

drop policy if exists "agency manage own fit request files" on public.agency_fit_request_files;
create policy "agency manage own fit request files"
on public.agency_fit_request_files for all
using (public.is_org_member(auth.uid(), organization_id))
with check (public.is_org_member(auth.uid(), organization_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('agency-fit-requests', 'agency-fit-requests', false, 52428800)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists "staff read agency fit request files storage" on storage.objects;
create policy "staff read agency fit request files storage"
on storage.objects for select
using (
  bucket_id = 'agency-fit-requests'
  and public.has_any_role(auth.uid(), array['super_admin','admin','manager','sales','sales_user','sales_manager']::public.app_role[])
);

drop policy if exists "agency manage own agency fit request files storage" on storage.objects;
create policy "agency manage own agency fit request files storage"
on storage.objects for all
using (
  bucket_id = 'agency-fit-requests'
  and public.is_org_member(auth.uid(), (storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'agency-fit-requests'
  and public.is_org_member(auth.uid(), (storage.foldername(name))[1]::uuid)
);
