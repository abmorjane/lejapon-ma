create table if not exists public.japan_partner_settings (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null default 'Tapis Volant LLC',
  address text,
  email text,
  phone text,
  registration_number text,
  corporate_number text,
  bank_name text,
  bank_code text,
  branch_code text,
  branch_name text,
  account_type text,
  account_number text,
  account_name text,
  logo_path text,
  logo_url text,
  stamp_path text,
  stamp_url text,
  default_contract_path text,
  default_contract_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.international_payment_files (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  supplier_name text not null default '',
  payment_reference text,
  invoice_number text,
  issue_date date,
  due_date date,
  currency text not null default 'JPY',
  total_invoice_amount numeric not null default 0,
  payment_percentage numeric not null default 100,
  amount_to_pay_now numeric not null default 0,
  amount_already_paid numeric not null default 0,
  remaining_balance numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','created','submitted_to_bank','waiting_payment','paid','rejected','cancelled')),
  notes text,
  participants_count int not null default 0,
  checklist jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.international_payment_file_documents (
  id uuid primary key default gen_random_uuid(),
  payment_file_id uuid not null references public.international_payment_files(id) on delete cascade,
  document_type text not null,
  file_name text not null,
  storage_path text not null,
  public_url text,
  mime_type text,
  size_bytes bigint,
  participant_id uuid references public.booking_participants(id) on delete set null,
  version int not null default 1,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.international_payment_subrogations (
  id uuid primary key default gen_random_uuid(),
  payment_file_id uuid not null references public.international_payment_files(id) on delete cascade,
  participant_id uuid references public.booking_participants(id) on delete set null,
  participant_name text not null,
  amount_mad numeric not null default 0,
  place text,
  signature_date date,
  storage_path text,
  public_url text,
  status text not null default 'generated' check (status in ('draft','generated','signed','cancelled')),
  notes text,
  generated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.international_payment_history (
  id uuid primary key default gen_random_uuid(),
  payment_file_id uuid not null references public.international_payment_files(id) on delete cascade,
  action text not null,
  actor_id uuid references auth.users(id) on delete set null,
  old_value jsonb,
  new_value jsonb,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_international_payment_files_trip on public.international_payment_files(trip_id);
create index if not exists idx_international_payment_files_status on public.international_payment_files(status);
create index if not exists idx_international_payment_files_due_date on public.international_payment_files(due_date);
create index if not exists idx_ipfd_payment_file on public.international_payment_file_documents(payment_file_id);
create index if not exists idx_ipfd_type on public.international_payment_file_documents(document_type);
create index if not exists idx_ip_subrogations_payment_file on public.international_payment_subrogations(payment_file_id);
create index if not exists idx_ip_history_payment_file on public.international_payment_history(payment_file_id);

create or replace function public.set_international_payment_file_amounts()
returns trigger
language plpgsql
as $$
begin
  new.amount_to_pay_now := round(coalesce(new.total_invoice_amount, 0) * coalesce(new.payment_percentage, 0) / 100, 0);
  new.remaining_balance := greatest(0, coalesce(new.total_invoice_amount, 0) - coalesce(new.amount_already_paid, 0));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_international_payment_file_amounts on public.international_payment_files;
create trigger trg_international_payment_file_amounts
before insert or update on public.international_payment_files
for each row execute function public.set_international_payment_file_amounts();

create or replace function public.set_international_payment_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_japan_partner_settings_updated_at on public.japan_partner_settings;
create trigger trg_japan_partner_settings_updated_at
before update on public.japan_partner_settings
for each row execute function public.set_international_payment_updated_at();

drop trigger if exists trg_international_payment_subrogations_updated_at on public.international_payment_subrogations;
create trigger trg_international_payment_subrogations_updated_at
before update on public.international_payment_subrogations
for each row execute function public.set_international_payment_updated_at();

alter table public.japan_partner_settings enable row level security;
alter table public.international_payment_files enable row level security;
alter table public.international_payment_file_documents enable row level security;
alter table public.international_payment_subrogations enable row level security;
alter table public.international_payment_history enable row level security;

drop policy if exists "staff read japan partner settings" on public.japan_partner_settings;
create policy "staff read japan partner settings" on public.japan_partner_settings
for select using (
  public.is_staff(auth.uid())
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('sales','sales_user')
  )
);

drop policy if exists "admin manage japan partner settings" on public.japan_partner_settings;
create policy "admin manage japan partner settings" on public.japan_partner_settings
for all using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

drop policy if exists "staff read international payment files" on public.international_payment_files;
create policy "staff read international payment files" on public.international_payment_files
for select using (
  public.is_staff(auth.uid())
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('sales','sales_user')
  )
);

drop policy if exists "admin manage international payment files" on public.international_payment_files;
create policy "admin manage international payment files" on public.international_payment_files
for all using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

drop policy if exists "staff read international payment documents" on public.international_payment_file_documents;
create policy "staff read international payment documents" on public.international_payment_file_documents
for select using (
  public.is_staff(auth.uid())
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('sales','sales_user')
  )
);

drop policy if exists "admin manage international payment documents" on public.international_payment_file_documents;
create policy "admin manage international payment documents" on public.international_payment_file_documents
for all using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

drop policy if exists "staff read international payment subrogations" on public.international_payment_subrogations;
create policy "staff read international payment subrogations" on public.international_payment_subrogations
for select using (
  public.is_staff(auth.uid())
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('sales','sales_user')
  )
);

drop policy if exists "admin manage international payment subrogations" on public.international_payment_subrogations;
create policy "admin manage international payment subrogations" on public.international_payment_subrogations
for all using (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

drop policy if exists "staff read international payment history" on public.international_payment_history;
create policy "staff read international payment history" on public.international_payment_history
for select using (
  public.is_staff(auth.uid())
  or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role::text in ('sales','sales_user')
  )
);

drop policy if exists "admin insert international payment history" on public.international_payment_history;
create policy "admin insert international payment history" on public.international_payment_history
for insert with check (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'));

insert into storage.buckets (id, name, public)
values ('international-payments', 'international-payments', false)
on conflict (id) do nothing;

drop policy if exists "staff read international payment files storage" on storage.objects;
create policy "staff read international payment files storage" on storage.objects
for select using (
  bucket_id = 'international-payments'
  and (
    public.is_staff(auth.uid())
    or exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role::text in ('sales','sales_user')
    )
  )
);

drop policy if exists "admin upload international payment files storage" on storage.objects;
create policy "admin upload international payment files storage" on storage.objects
for insert with check (
  bucket_id = 'international-payments'
  and (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
);

drop policy if exists "admin update international payment files storage" on storage.objects;
create policy "admin update international payment files storage" on storage.objects
for update using (
  bucket_id = 'international-payments'
  and (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
)
with check (
  bucket_id = 'international-payments'
  and (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
);

drop policy if exists "admin delete international payment files storage" on storage.objects;
create policy "admin delete international payment files storage" on storage.objects
for delete using (
  bucket_id = 'international-payments'
  and (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager'))
);

insert into public.japan_partner_settings (partner_name, email, metadata)
select 'Tapis Volant LLC', null, jsonb_build_object('seeded_by', 'international_payments_v1')
where not exists (select 1 from public.japan_partner_settings);

notify pgrst, 'reload schema';
