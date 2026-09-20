alter table public.email_logs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_email_logs_created_at
  on public.email_logs(created_at desc);
create index if not exists idx_email_logs_event_type
  on public.email_logs(event_type, created_at desc);
create index if not exists idx_email_logs_status
  on public.email_logs(status, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_logs'::regclass
      and conname = 'email_logs_related_booking_id_fkey'
  ) then
    alter table public.email_logs
      add constraint email_logs_related_booking_id_fkey
      foreign key (related_booking_id)
      references public.bookings(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_logs'::regclass
      and conname = 'email_logs_related_payment_id_fkey'
  ) then
    alter table public.email_logs
      add constraint email_logs_related_payment_id_fkey
      foreign key (related_payment_id)
      references public.payments(id)
      on delete set null;
  end if;
end $$;

alter table public.email_logs enable row level security;

drop policy if exists "Staff can insert email logs" on public.email_logs;
drop policy if exists "Staff can read email logs" on public.email_logs;
drop policy if exists "Staff can update email logs" on public.email_logs;
drop policy if exists "staff read email_logs" on public.email_logs;
drop policy if exists "service manage email_logs" on public.email_logs;

create policy "staff read email_logs"
on public.email_logs
for select
to authenticated
using (public.is_staff((select auth.uid())));
