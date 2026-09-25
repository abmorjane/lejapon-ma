-- Run only against an isolated/local database with Phase 3A and the hotfix applied.
-- The transaction rollback guarantees that no payment, reservation, or task persists.
begin;

create or replace function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL: %', p_message;
  end if;
  raise notice 'PASS: %', p_message;
end;
$$;

do $$
begin
  if position(
    'on conflict do nothing'
    in lower(pg_get_functiondef(
      'public.ensure_flight_reservation_task_v2(uuid,timestamp with time zone)'::regprocedure
    ))
  ) = 0 then
    raise exception 'FAIL: targetless ON CONFLICT is missing';
  end if;
  if position(
    'on conflict (booking_id)'
    in lower(pg_get_functiondef(
      'public.ensure_flight_reservation_task_v2(uuid,timestamp with time zone)'::regprocedure
    ))
  ) > 0 then
    raise exception 'FAIL: invalid booking_id conflict target remains';
  end if;
end;
$$;

-- The transactional integration scenarios are exercised by the hotfix harness:
-- 1. no reservation -> one empty active reservation;
-- 2. existing empty reservation -> no duplicate;
-- 3. several active PNR rows remain supported;
-- 4. replayed payment event -> one reserve_flight task;
-- 5. payment INSERT completes without SQLSTATE 42P10.

select pg_temp.assert_true(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'booking_flight_reservations'
      and indexname = 'booking_flight_reservations_booking_empty_active_unique'
      and indexdef ilike '%where%pnr_normalized is null%'
  ),
  'empty active reservation partial unique index remains present'
);

select pg_temp.assert_true(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'booking_flight_reservations'
      and indexname = 'booking_flight_reservations_booking_pnr_active_unique'
      and indexdef ilike '%booking_id, pnr_normalized%'
  ),
  'multi-PNR partial unique index remains present'
);

rollback;
