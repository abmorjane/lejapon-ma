create table if not exists public.admin_notification_logs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  channel text not null check (channel in ('email', 'push')),
  title text not null,
  message text,
  recipient text,
  status text not null check (status in ('sent', 'failed')),
  error_message text,
  related_id uuid,
  data jsonb not null default '{}'::jsonb,
  link text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_notification_logs_created_at
  on public.admin_notification_logs (created_at desc);

create index if not exists idx_admin_notification_logs_type
  on public.admin_notification_logs (type, created_at desc);

alter table public.admin_notification_logs enable row level security;

drop policy if exists "staff read admin notification logs" on public.admin_notification_logs;
create policy "staff read admin notification logs"
on public.admin_notification_logs
for select
using (public.is_staff(auth.uid()));

create table if not exists public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_push_subscriptions_user_id
  on public.admin_push_subscriptions (user_id);

create index if not exists idx_admin_push_subscriptions_enabled
  on public.admin_push_subscriptions (enabled);

alter table public.admin_push_subscriptions enable row level security;

drop policy if exists "staff read admin push subscriptions" on public.admin_push_subscriptions;
create policy "staff read admin push subscriptions"
on public.admin_push_subscriptions
for select
using (public.is_staff(auth.uid()));

drop policy if exists "staff create admin push subscriptions" on public.admin_push_subscriptions;
create policy "staff create admin push subscriptions"
on public.admin_push_subscriptions
for insert
with check (public.is_staff(auth.uid()) and (user_id is null or user_id = auth.uid()));

drop policy if exists "staff update admin push subscriptions" on public.admin_push_subscriptions;
create policy "staff update admin push subscriptions"
on public.admin_push_subscriptions
for update
using (public.is_staff(auth.uid()) and (user_id is null or user_id = auth.uid()))
with check (public.is_staff(auth.uid()) and (user_id is null or user_id = auth.uid()));

drop trigger if exists set_admin_push_subscriptions_updated_at on public.admin_push_subscriptions;
create trigger set_admin_push_subscriptions_updated_at
before update on public.admin_push_subscriptions
for each row execute function public.set_updated_at();
