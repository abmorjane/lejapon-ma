-- Singleton-like table to store SMTP configuration editable from the admin
create table if not exists public.email_settings (
  id uuid primary key default gen_random_uuid(),
  smtp_host text not null default '',
  smtp_port integer not null default 465,
  smtp_secure text not null default 'ssl', -- 'ssl' | 'starttls' | 'none'
  smtp_username text not null default '',
  smtp_password text not null default '',
  from_email text not null default '',
  from_name text not null default '',
  reply_to text,
  is_active boolean not null default false,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_settings enable row level security;

-- Only super_admin can read/write SMTP credentials
drop policy if exists "super_admin read email_settings" on public.email_settings;
create policy "super_admin read email_settings"
on public.email_settings for select
using (public.has_role(auth.uid(), 'super_admin'));

drop policy if exists "super_admin manage email_settings" on public.email_settings;
create policy "super_admin manage email_settings"
on public.email_settings for all
using (public.has_role(auth.uid(), 'super_admin'))
with check (public.has_role(auth.uid(), 'super_admin'));

-- Updated_at trigger
drop trigger if exists set_email_settings_updated_at on public.email_settings;
create trigger set_email_settings_updated_at
before update on public.email_settings
for each row execute function public.set_updated_at();

-- Seed an empty row so admins can edit instead of insert (idempotent)
insert into public.email_settings (smtp_host, smtp_port, smtp_secure, from_email, from_name, is_active)
select '', 465, 'ssl', '', '', false
where not exists (select 1 from public.email_settings);