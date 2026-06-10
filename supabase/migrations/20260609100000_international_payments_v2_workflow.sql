create table if not exists public.japan_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'other',
  address text,
  email text,
  phone text,
  website text,
  notes text,
  bank_name text,
  branch_name text,
  bank_code text,
  branch_code text,
  account_type text,
  account_number text,
  account_holder text,
  logo_path text,
  logo_url text,
  stamp_path text,
  stamp_url text,
  contract_path text,
  contract_url text,
  invoice_template_path text,
  invoice_template_url text,
  status text not null default 'active' check (status in ('active','inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.international_payment_files
  add column if not exists supplier_id uuid references public.japan_suppliers(id) on delete set null,
  add column if not exists supplier_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists unit_price_jpy numeric not null default 0,
  add column if not exists tax_percent numeric not null default 0;

do $$
begin
  alter table public.international_payment_files drop constraint if exists international_payment_files_status_check;
  alter table public.international_payment_files
    add constraint international_payment_files_status_check
    check (status in ('draft','created','submitted_to_bank','bank_review','approved','partially_paid','paid','rejected','cancelled','waiting_payment'));
exception when duplicate_object then
  null;
end $$;

create table if not exists public.international_payment_participants (
  id uuid primary key default gen_random_uuid(),
  payment_file_id uuid not null references public.international_payment_files(id) on delete cascade,
  source_participant_id uuid references public.booking_participants(id) on delete set null,
  full_name text not null default '',
  passport_no text,
  nationality text,
  birth_date date,
  room_type text,
  booking_reference text,
  cin text,
  address text,
  city text,
  passport_copy_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_ipp_unique_source
  on public.international_payment_participants(payment_file_id, source_participant_id)
  where source_participant_id is not null;
create index if not exists idx_japan_suppliers_status on public.japan_suppliers(status);
create index if not exists idx_japan_suppliers_category on public.japan_suppliers(category);
create index if not exists idx_ip_files_supplier on public.international_payment_files(supplier_id);
create index if not exists idx_ip_participants_file on public.international_payment_participants(payment_file_id);

drop trigger if exists trg_japan_suppliers_updated_at on public.japan_suppliers;
create trigger trg_japan_suppliers_updated_at
before update on public.japan_suppliers
for each row execute function public.set_international_payment_updated_at();

drop trigger if exists trg_international_payment_participants_updated_at on public.international_payment_participants;
create trigger trg_international_payment_participants_updated_at
before update on public.international_payment_participants
for each row execute function public.set_international_payment_updated_at();

alter table public.japan_suppliers enable row level security;
alter table public.international_payment_participants enable row level security;

drop policy if exists "staff read japan suppliers" on public.japan_suppliers;
create policy "staff read japan suppliers" on public.japan_suppliers
for select using (
  public.is_staff(auth.uid())
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('sales','sales_user')
  )
);

drop policy if exists "admin manage japan suppliers" on public.japan_suppliers;
create policy "admin manage japan suppliers" on public.japan_suppliers
for all using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

drop policy if exists "staff read international payment participants" on public.international_payment_participants;
create policy "staff read international payment participants" on public.international_payment_participants
for select using (
  public.is_staff(auth.uid())
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('sales','sales_user')
  )
);

drop policy if exists "admin manage international payment participants" on public.international_payment_participants;
create policy "admin manage international payment participants" on public.international_payment_participants
for all using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

insert into public.japan_suppliers (
  name,
  category,
  address,
  email,
  phone,
  bank_name,
  branch_name,
  bank_code,
  branch_code,
  account_type,
  account_number,
  account_holder,
  logo_path,
  logo_url,
  stamp_path,
  stamp_url,
  contract_path,
  contract_url,
  status,
  metadata
)
select
  coalesce(nullif(partner_name, ''), 'Tapis Volant LLC'),
  'main_partner',
  address,
  email,
  phone,
  bank_name,
  branch_name,
  bank_code,
  branch_code,
  account_type,
  account_number,
  account_name,
  logo_path,
  logo_url,
  stamp_path,
  stamp_url,
  default_contract_path,
  default_contract_url,
  'active',
  jsonb_build_object('seeded_from', 'japan_partner_settings', 'source_id', id)
from public.japan_partner_settings
where not exists (
  select 1 from public.japan_suppliers s
  where lower(s.name) = lower(coalesce(nullif(public.japan_partner_settings.partner_name, ''), 'Tapis Volant LLC'))
);

update public.international_payment_files f
set
  supplier_id = s.id,
  supplier_snapshot = coalesce(nullif(f.supplier_snapshot, '{}'::jsonb), to_jsonb(s))
from public.japan_suppliers s
where f.supplier_id is null
  and lower(coalesce(f.supplier_name, '')) = lower(s.name);

notify pgrst, 'reload schema';
