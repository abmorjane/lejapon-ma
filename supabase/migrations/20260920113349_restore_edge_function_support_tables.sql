create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  subject text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists "staff read contact_messages" on public.contact_messages;
create policy "staff read contact_messages"
on public.contact_messages
for select
to authenticated
using (public.is_staff((select auth.uid())));

create table if not exists public.crm_export_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  ip_address text,
  exported_count integer not null default 0,
  export_type text not null check (export_type in ('CSV', 'XLSX')),
  scope text,
  include_passport_data boolean not null default false,
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('completed', 'denied', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.crm_export_logs enable row level security;

drop policy if exists "super_admin read crm export logs" on public.crm_export_logs;
create policy "super_admin read crm export logs"
on public.crm_export_logs
for select
to authenticated
using (public.has_role((select auth.uid()), 'super_admin'));

drop policy if exists "super_admin insert crm export logs" on public.crm_export_logs;
create policy "super_admin insert crm export logs"
on public.crm_export_logs
for insert
to authenticated
with check (public.has_role((select auth.uid()), 'super_admin'));

create index if not exists idx_crm_export_logs_user_id
  on public.crm_export_logs(user_id);
create index if not exists idx_crm_export_logs_created_at
  on public.crm_export_logs(created_at desc);
create index if not exists idx_crm_export_logs_status
  on public.crm_export_logs(status);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.email_logs'::regclass
      and conname = 'email_logs_related_contact_id_fkey'
  ) then
    alter table public.email_logs
      add constraint email_logs_related_contact_id_fkey
      foreign key (related_contact_id)
      references public.contact_messages(id)
      on delete set null;
  end if;
end $$;
