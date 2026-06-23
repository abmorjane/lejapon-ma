-- FIT partner quote mode.
-- Additive model: partners use published/sanitized templates and partner pricing tables.
-- Internal FIT costs and LeJapon.ma margins stay in staff-only tables/fields.

alter type public.app_role add value if not exists 'sales_manager';
alter type public.app_role add value if not exists 'partner_agency_admin';
alter type public.app_role add value if not exists 'partner_agent';
alter type public.app_role add value if not exists 'client_viewer';

create or replace function public.is_fit_internal_user(_user_id uuid)
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
      and ur.role::text in ('super_admin', 'admin', 'manager', 'sales_manager')
  );
$$;

create or replace function public.is_partner_org_member(_organization_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = _organization_id
      and om.user_id = _user_id
      and om.status = 'active'
      and o.type = 'agency'
      and o.status = 'active'
  );
$$;

create or replace function public.is_partner_org_admin(_organization_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = _organization_id
      and om.user_id = _user_id
      and om.status = 'active'
      and om.role in ('owner', 'admin')
      and o.type = 'agency'
      and o.status = 'active'
  );
$$;

alter table public.fit_quotes
  add column if not exists quote_channel text not null default 'internal',
  add column if not exists partner_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists partner_branding_mode text not null default 'lejapon_primary',
  add column if not exists partner_contact_name text,
  add column if not exists requires_lejapon_approval boolean not null default false,
  add column if not exists approval_reason text;

alter table public.fit_quotes
  drop constraint if exists fit_quotes_quote_channel_check,
  add constraint fit_quotes_quote_channel_check check (quote_channel in ('internal', 'partner'));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_partner_branding_mode_check,
  add constraint fit_quotes_partner_branding_mode_check check (partner_branding_mode in ('white_label', 'co_branded', 'lejapon_primary'));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_status_check,
  add constraint fit_quotes_status_check check (status in (
    'draft',
    'pending_partner_review',
    'pending_lejapon_approval',
    'approved',
    'sent',
    'accepted',
    'modification_requested',
    'expired',
    'cancelled',
    'rejected',
    'converted_to_booking'
  ));

alter table public.fit_day_templates
  add column if not exists partner_publish_status text not null default 'internal',
  add column if not exists partner_net_price_mad numeric not null default 0,
  add column if not exists partner_allowed_organization_ids uuid[] not null default '{}'::uuid[];

alter table public.fit_day_templates
  drop constraint if exists fit_day_templates_partner_publish_status_check,
  add constraint fit_day_templates_partner_publish_status_check check (partner_publish_status in ('internal', 'published', 'archived'));

create table if not exists public.partner_organizations (
  id uuid primary key references public.organizations(id) on delete cascade,
  name text,
  slug text unique,
  logo_url text,
  primary_color text,
  branding_mode text not null default 'co_branded',
  contact_email text,
  contact_phone text,
  whatsapp text,
  website text,
  address text,
  commercial_name text,
  contact_person_name text,
  legal_name text,
  footer_text text,
  show_powered_by_lejapon boolean not null default true,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_organizations_branding_mode_check check (branding_mode in ('white_label', 'co_branded', 'lejapon_primary')),
  constraint partner_organizations_status_check check (status in ('active', 'suspended', 'archived'))
);

create table if not exists public.partner_quote_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  default_margin_type text not null default 'percent',
  default_margin_value numeric not null default 15,
  min_margin_value numeric not null default 0,
  max_discount_value numeric not null default 0,
  requires_approval_below_margin boolean not null default true,
  allow_manual_adjustment boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_quote_settings_margin_type_check check (default_margin_type in ('percent', 'fixed'))
);

create table if not exists public.fit_partner_day_templates (
  id uuid primary key default gen_random_uuid(),
  source_template_id uuid references public.fit_day_templates(id) on delete set null,
  title text not null,
  city text,
  theme text,
  day_pace text,
  sales_summary text,
  description_client text,
  optimized_client_description text,
  client_highlights jsonb not null default '[]'::jsonb,
  client_inclusions jsonb not null default '[]'::jsonb,
  client_options jsonb not null default '[]'::jsonb,
  transport_modes jsonb not null default '[]'::jsonb,
  meal_plan jsonb not null default '[]'::jsonb,
  image_urls jsonb not null default '[]'::jsonb,
  partner_net_price_mad numeric not null default 0,
  min_travelers integer not null default 1,
  max_travelers integer,
  valid_from date,
  valid_until date,
  allowed_organization_ids uuid[] not null default '{}'::uuid[],
  is_published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fit_partner_day_template_components (
  id uuid primary key default gen_random_uuid(),
  partner_template_id uuid not null references public.fit_partner_day_templates(id) on delete cascade,
  sort_order integer not null default 0,
  component_type text not null default 'activity',
  title text not null,
  description_client text,
  category text,
  is_required boolean not null default false,
  can_partner_disable boolean not null default true,
  partner_visible boolean not null default true,
  affects_partner_net_price boolean not null default true,
  net_price_impact numeric not null default 0,
  client_text_when_enabled text,
  client_text_when_disabled text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fit_partner_template_components_type_check check (component_type in (
    'guide','transport','activity','entry','meal','luggage_transfer','option','assistance','hotel','train','shinkansen','other'
  ))
);

create table if not exists public.fit_quote_access (
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  role_scope text not null default 'partner_owner',
  created_at timestamptz not null default now(),
  primary key (quote_id, organization_id),
  constraint fit_quote_access_role_scope_check check (role_scope in ('internal_owner','partner_owner','partner_collaborator','client_viewer'))
);

create table if not exists public.fit_quote_partner_pricing (
  quote_id uuid primary key references public.fit_quotes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  net_partner_total numeric not null default 0,
  partner_margin_type text not null default 'percent',
  partner_margin_value numeric not null default 0,
  partner_margin_total numeric not null default 0,
  manual_adjustment_mad numeric not null default 0,
  client_sale_total numeric not null default 0,
  client_sale_per_person numeric not null default 0,
  approval_required boolean not null default false,
  approval_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fit_partner_pricing_margin_type_check check (partner_margin_type in ('percent', 'fixed'))
);

create table if not exists public.fit_quote_day_components (
  id uuid primary key default gen_random_uuid(),
  quote_day_id uuid not null references public.fit_quote_days(id) on delete cascade,
  source_component_id uuid references public.fit_partner_day_template_components(id) on delete set null,
  component_type text not null default 'activity',
  title text not null,
  description_client text,
  category text,
  net_price_impact numeric not null default 0,
  is_required boolean not null default false,
  can_partner_disable boolean not null default true,
  enabled boolean not null default true,
  partner_visible boolean not null default true,
  affects_partner_net_price boolean not null default true,
  client_text_when_enabled text,
  client_text_when_disabled text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fit_quote_day_components_type_check check (component_type in (
    'guide','transport','activity','entry','meal','luggage_transfer','option','assistance','hotel','train','shinkansen','other'
  ))
);

create table if not exists public.quote_audit_logs (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.fit_quotes(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fit_quotes_partner_org_idx on public.fit_quotes(partner_organization_id, updated_at desc);
create index if not exists fit_quotes_channel_idx on public.fit_quotes(quote_channel);
create index if not exists fit_partner_day_templates_published_idx on public.fit_partner_day_templates(is_published, city, title);
create unique index if not exists fit_partner_day_templates_source_template_uidx on public.fit_partner_day_templates(source_template_id);
create index if not exists fit_partner_template_components_template_idx on public.fit_partner_day_template_components(partner_template_id, sort_order);
create index if not exists fit_quote_partner_pricing_org_idx on public.fit_quote_partner_pricing(organization_id, updated_at desc);
create index if not exists fit_quote_day_components_day_idx on public.fit_quote_day_components(quote_day_id, created_at);
create index if not exists quote_audit_logs_quote_idx on public.quote_audit_logs(quote_id, created_at desc);
create index if not exists quote_audit_logs_org_idx on public.quote_audit_logs(organization_id, created_at desc);

drop trigger if exists partner_organizations_updated_at on public.partner_organizations;
create trigger partner_organizations_updated_at
before update on public.partner_organizations
for each row execute function public.set_updated_at();

drop trigger if exists partner_quote_settings_updated_at on public.partner_quote_settings;
create trigger partner_quote_settings_updated_at
before update on public.partner_quote_settings
for each row execute function public.set_updated_at();

drop trigger if exists fit_partner_day_templates_updated_at on public.fit_partner_day_templates;
create trigger fit_partner_day_templates_updated_at
before update on public.fit_partner_day_templates
for each row execute function public.set_updated_at();

drop trigger if exists fit_partner_day_template_components_updated_at on public.fit_partner_day_template_components;
create trigger fit_partner_day_template_components_updated_at
before update on public.fit_partner_day_template_components
for each row execute function public.set_updated_at();

drop trigger if exists fit_quote_partner_pricing_updated_at on public.fit_quote_partner_pricing;
create trigger fit_quote_partner_pricing_updated_at
before update on public.fit_quote_partner_pricing
for each row execute function public.set_updated_at();

drop trigger if exists fit_quote_day_components_updated_at on public.fit_quote_day_components;
create trigger fit_quote_day_components_updated_at
before update on public.fit_quote_day_components
for each row execute function public.set_updated_at();

alter table public.partner_organizations enable row level security;
alter table public.partner_quote_settings enable row level security;
alter table public.fit_partner_day_templates enable row level security;
alter table public.fit_partner_day_template_components enable row level security;
alter table public.fit_quote_access enable row level security;
alter table public.fit_quote_partner_pricing enable row level security;
alter table public.fit_quote_day_components enable row level security;
alter table public.quote_audit_logs enable row level security;

drop policy if exists "staff manage partner organizations" on public.partner_organizations;
create policy "staff manage partner organizations" on public.partner_organizations
for all using (public.is_fit_internal_user(auth.uid()))
with check (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partner read own partner organization" on public.partner_organizations;
create policy "partner read own partner organization" on public.partner_organizations
for select using (public.is_partner_org_member(id));

drop policy if exists "partner admin update own partner organization" on public.partner_organizations;
create policy "partner admin update own partner organization" on public.partner_organizations
for update using (public.is_partner_org_admin(id))
with check (public.is_partner_org_admin(id));

drop policy if exists "staff manage partner quote settings" on public.partner_quote_settings;
create policy "staff manage partner quote settings" on public.partner_quote_settings
for all using (public.is_fit_internal_user(auth.uid()))
with check (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partner read own quote settings" on public.partner_quote_settings;
create policy "partner read own quote settings" on public.partner_quote_settings
for select using (public.is_partner_org_member(organization_id));

drop policy if exists "partner admin update own quote settings" on public.partner_quote_settings;
create policy "partner admin update own quote settings" on public.partner_quote_settings
for update using (public.is_partner_org_admin(organization_id))
with check (public.is_partner_org_admin(organization_id));

drop policy if exists "staff manage partner fit templates" on public.fit_partner_day_templates;
create policy "staff manage partner fit templates" on public.fit_partner_day_templates
for all using (public.is_fit_internal_user(auth.uid()))
with check (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partners read published fit templates" on public.fit_partner_day_templates;
create policy "partners read published fit templates" on public.fit_partner_day_templates
for select using (
  is_published = true
  and exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.user_id = auth.uid()
      and om.status = 'active'
      and o.type = 'agency'
      and o.status = 'active'
      and (
        coalesce(array_length(allowed_organization_ids, 1), 0) = 0
        or om.organization_id = any(allowed_organization_ids)
      )
  )
);

drop policy if exists "staff manage partner fit template components" on public.fit_partner_day_template_components;
create policy "staff manage partner fit template components" on public.fit_partner_day_template_components
for all using (public.is_fit_internal_user(auth.uid()))
with check (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partners read published fit template components" on public.fit_partner_day_template_components;
create policy "partners read published fit template components" on public.fit_partner_day_template_components
for select using (
  exists (
    select 1
    from public.fit_partner_day_templates t
    where t.id = fit_partner_day_template_components.partner_template_id
      and t.is_published = true
      and exists (
        select 1
        from public.organization_members om
        join public.organizations o on o.id = om.organization_id
        where om.user_id = auth.uid()
          and om.status = 'active'
          and o.type = 'agency'
          and o.status = 'active'
          and (
            coalesce(array_length(t.allowed_organization_ids, 1), 0) = 0
            or om.organization_id = any(t.allowed_organization_ids)
          )
      )
  )
);

drop policy if exists "partner manage own fit quotes" on public.fit_quotes;
create policy "partner manage own fit quotes" on public.fit_quotes
for all using (
  quote_channel = 'partner'
  and partner_organization_id is not null
  and public.is_partner_org_member(partner_organization_id)
)
with check (
  quote_channel = 'partner'
  and partner_organization_id is not null
  and public.is_partner_org_member(partner_organization_id)
);

drop policy if exists "partner manage own fit quote days" on public.fit_quote_days;
create policy "partner manage own fit quote days" on public.fit_quote_days
for all using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_days.quote_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
)
with check (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_days.quote_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
);

drop policy if exists "partner manage own fit hotel lines" on public.fit_quote_hotel_lines;
create policy "partner manage own fit hotel lines" on public.fit_quote_hotel_lines
for all using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_hotel_lines.quote_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
)
with check (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_hotel_lines.quote_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
);

drop policy if exists "partner manage own fit flight lines" on public.fit_quote_flight_lines;
create policy "partner manage own fit flight lines" on public.fit_quote_flight_lines
for all using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_flight_lines.quote_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
)
with check (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_flight_lines.quote_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
);

drop policy if exists "staff manage fit quote access" on public.fit_quote_access;
create policy "staff manage fit quote access" on public.fit_quote_access
for all using (public.is_fit_internal_user(auth.uid()))
with check (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partner read own fit quote access" on public.fit_quote_access;
create policy "partner read own fit quote access" on public.fit_quote_access
for select using (public.is_partner_org_member(organization_id));

drop policy if exists "partner insert own fit quote access" on public.fit_quote_access;
create policy "partner insert own fit quote access" on public.fit_quote_access
for insert with check (
  public.is_partner_org_member(organization_id)
  and exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_access.quote_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id = fit_quote_access.organization_id
  )
);

drop policy if exists "staff manage partner quote pricing" on public.fit_quote_partner_pricing;
create policy "staff manage partner quote pricing" on public.fit_quote_partner_pricing
for all using (public.is_fit_internal_user(auth.uid()))
with check (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partner manage own quote pricing" on public.fit_quote_partner_pricing;
create policy "partner manage own quote pricing" on public.fit_quote_partner_pricing
for all using (public.is_partner_org_member(organization_id))
with check (public.is_partner_org_member(organization_id));

drop policy if exists "staff manage fit quote day components" on public.fit_quote_day_components;
create policy "staff manage fit quote day components" on public.fit_quote_day_components
for all using (public.is_fit_internal_user(auth.uid()))
with check (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partner manage own fit quote day components" on public.fit_quote_day_components;
create policy "partner manage own fit quote day components" on public.fit_quote_day_components
for all using (
  exists (
    select 1
    from public.fit_quote_days d
    join public.fit_quotes q on q.id = d.quote_id
    where d.id = fit_quote_day_components.quote_day_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
)
with check (
  exists (
    select 1
    from public.fit_quote_days d
    join public.fit_quotes q on q.id = d.quote_id
    where d.id = fit_quote_day_components.quote_day_id
      and q.quote_channel = 'partner'
      and q.partner_organization_id is not null
      and public.is_partner_org_member(q.partner_organization_id)
  )
);

drop policy if exists "staff read quote audit logs" on public.quote_audit_logs;
create policy "staff read quote audit logs" on public.quote_audit_logs
for select using (public.is_fit_internal_user(auth.uid()));

drop policy if exists "partner read own quote audit logs" on public.quote_audit_logs;
create policy "partner read own quote audit logs" on public.quote_audit_logs
for select using (organization_id is not null and public.is_partner_org_member(organization_id));

drop policy if exists "partner insert own quote audit logs" on public.quote_audit_logs;
create policy "partner insert own quote audit logs" on public.quote_audit_logs
for insert with check (
  organization_id is not null
  and user_id = auth.uid()
  and public.is_partner_org_member(organization_id)
);

drop policy if exists "staff insert quote audit logs" on public.quote_audit_logs;
create policy "staff insert quote audit logs" on public.quote_audit_logs
for insert with check (public.is_fit_internal_user(auth.uid()));

grant select, insert, update on public.partner_organizations to authenticated;
grant select, insert, update on public.partner_quote_settings to authenticated;
grant select on public.fit_partner_day_templates, public.fit_partner_day_template_components to authenticated;
grant insert, update, delete on public.fit_partner_day_templates, public.fit_partner_day_template_components to authenticated;
grant select, insert, update, delete on public.fit_quote_access, public.fit_quote_partner_pricing, public.fit_quote_day_components, public.quote_audit_logs to authenticated;

insert into public.partner_organizations (
  id, name, slug, logo_url, primary_color, branding_mode, contact_email, contact_phone,
  whatsapp, website, address, commercial_name, contact_person_name, legal_name, footer_text, show_powered_by_lejapon, status
)
select
  o.id,
  o.display_name,
  lower(regexp_replace(coalesce(o.display_name, o.id::text), '[^a-zA-Z0-9]+', '-', 'g')),
  nullif(o.metadata->>'agency_logo_url', ''),
  coalesce(nullif(o.metadata->>'primary_color', ''), '#f15a24'),
  coalesce(nullif(o.metadata->>'branding_mode', ''), 'co_branded'),
  o.email,
  o.phone,
  o.phone,
  o.website,
  concat_ws(', ', o.address_line_1, o.address_line_2, o.city, o.country),
  o.display_name,
  null,
  o.legal_name,
  null,
  true,
  case when o.status = 'active' then 'active' else 'suspended' end
from public.organizations o
where o.type = 'agency'
on conflict (id) do nothing;

insert into public.partner_quote_settings (organization_id)
select o.id
from public.organizations o
where o.type = 'agency'
on conflict (organization_id) do nothing;

notify pgrst, 'reload schema';
