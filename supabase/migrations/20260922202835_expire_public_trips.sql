-- Public trips expire automatically at the end of their commercial date.
-- Staff and assigned suppliers keep their existing independent SELECT policies,
-- so historical and archived dossiers remain readable in their authenticated UI.

drop policy if exists "public read open trips" on public.trips;

create policy "public read open trips"
on public.trips
for select
to anon
using (
  archived_at is null
  and status = 'open'
  and end_date >= ((now() at time zone 'Africa/Casablanca')::date)
);

-- Preserve the existing authenticated catalogue access used by client, visa,
-- supplier and staff workspaces. Their UI and specific policies determine the
-- historical records they expose; this migration only expires anonymous sales.
drop policy if exists "authenticated read non-archived catalogue trips" on public.trips;

create policy "authenticated read non-archived catalogue trips"
on public.trips
for select
to authenticated
using (
  archived_at is null
  and status in ('open', 'completed')
);

-- Rollback, if required, restores the previous catalogue condition without
-- mutating any trip row:
-- drop policy if exists "public read open trips" on public.trips;
-- drop policy if exists "authenticated read non-archived catalogue trips" on public.trips;
-- create policy "public read open trips" on public.trips for select
-- to anon, authenticated
-- using (archived_at is null and status in ('open', 'completed'));
