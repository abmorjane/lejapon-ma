-- LOCAL ONLY: run after applying 20260924150000_operation_task_engine_v2_phase1.sql
-- to an isolated Supabase database. Every mutation is rolled back.
begin;

create or replace function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'FAIL: %', p_message;
  end if;
  raise notice 'PASS: %', p_message;
end;
$$;

select pg_temp.assert_true(
  public.calculate_operation_task_deadline_v2(
    'trip_start', -90, 24, date '2027-01-01', null, timestamptz '2026-01-01 00:00:00+00'
  ) = timestamptz '2026-10-03 00:00:00+00',
  'J-90 uses the trip start date when the target remains in the future'
);

select pg_temp.assert_true(
  public.calculate_operation_task_deadline_v2(
    'trip_start', -90, 24, date '2026-02-01', null, timestamptz '2026-01-15 10:00:00+00'
  ) = timestamptz '2026-01-16 10:00:00+00',
  'late booking receives the 24-hour grace period instead of an overdue deadline'
);

select pg_temp.assert_true(
  public.calculate_operation_task_deadline_v2(
    'payment_event', 1, 24, null, timestamptz '2026-01-10 09:30:00+00', timestamptz '2026-01-10 09:30:00+00'
  ) = timestamptz '2026-01-11 09:30:00+00',
  'payment event plus one day is exactly 24 hours'
);

select pg_temp.assert_true(
  public.operation_task_deduplication_key_v2(
    'reserve_flight', 'reservation', '00000000-0000-0000-0000-000000000001', 'payment_received', 'v2'
  ) = 'reserve_flight:reservation:00000000-0000-0000-0000-000000000001:payment_received:v2',
  'V2 deduplication key is deterministic'
);

select pg_temp.assert_true(
  public.operation_task_deduplication_key_v2(
    'reserve_flight', 'reservation', '00000000-0000-0000-0000-000000000001', 'payment_received', 'v2'
  ) <> public.operation_task_deduplication_key_v2(
    'reserve_flight', 'reservation', '00000000-0000-0000-0000-000000000002', 'payment_received', 'v2'
  ),
  'different business entities cannot share a V2 deduplication key'
);

select pg_temp.assert_true(
  (select count(*) = 6
   from public.operation_task_templates
   where scope_type = 'trip'
     and travel_type = 'organized'
     and template_key in (
       'hotel_confirmation_v2', 'rooming_final_v2', 'guide_confirmation_v2',
       'group_transport_v2', 'airport_transfers_v2', 'final_documents_v2'
     )),
  'all six group templates are organized-trip tasks'
);

select pg_temp.assert_true(
  not exists (
    select 1 from public.operation_task_templates
    where scope_type = 'trip' and travel_type = 'fit'
  ),
  'FIT does not receive group-level trip templates'
);

select pg_temp.assert_true(
  (select auto_completion_key = 'flight_reserved'
   from public.operation_task_templates where template_key = 'reserve_flight')
  and
  (select auto_completion_key = 'flight_ticket_delivered'
   from public.operation_task_templates where template_key = 'send_flight_ticket'),
  'flight reservation and ticket delivery use allowlisted completion keys'
);

select pg_temp.assert_true(
  (select auto_completion_key is null
   from public.operation_task_templates where template_key = 'passport_check_v2')
  and
  (select (conditions->>'human_verification_required')::boolean
   from public.operation_task_templates where template_key = 'passport_check_v2'),
  'passport presence is not treated as human verification'
);

do $$
declare
  v_before bigint;
  v_after bigint;
  v_result uuid;
begin
  select count(*) into v_before from public.operation_tasks;
  update public.operation_task_templates
  set is_active = false
  where template_key = 'insurance_check_v2';

  select public.ensure_operation_task_v2(
    'insurance_check_v2',
    '00000000-0000-0000-0000-000000000099',
    'booking_confirmed'
  ) into v_result;

  select count(*) into v_after from public.operation_tasks;
  perform pg_temp.assert_true(v_result is null and v_before = v_after,
    'disabled V2 template creates no task');
end;
$$;

update public.operation_task_templates
set is_active = true
where template_key = 'insurance_check_v2';

-- Synthetic V2 tasks validate idempotence, flight completion, ticket delivery,
-- and lifecycle cancellation. The enclosing transaction rolls everything back.
insert into public.clients(id)
values ('91000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.trips(id, title, destination, start_date, status, updated_at)
values (
  '91000000-0000-0000-0000-000000000002',
  'Voyage test moteur V2', 'Japon', date '2027-04-01', 'open', statement_timestamp()
)
on conflict do nothing;

insert into public.bookings(
  id, reference, status, trip_id, client_id, contact_name,
  updated_at, travel_start_date
)
values (
  '91000000-0000-0000-0000-000000000003', 'V2-TEST-BOOKING', 'confirmed',
  '91000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  'Voyageur Test', statement_timestamp(), date '2027-04-01'
)
on conflict do nothing;

do $$
declare
  v_reserve_task uuid;
  v_reserve_task_again uuid;
  v_send_task uuid;
  v_insurance_task uuid;
  v_flight uuid := '91000000-0000-0000-0000-000000000004';
  v_completed boolean;
  v_cancelled integer;
begin
  v_reserve_task := public.ensure_operation_task_v2(
    'reserve_flight',
    '91000000-0000-0000-0000-000000000003',
    'payment_received',
    timestamptz '2026-09-24 10:00:00+00',
    '91000000-0000-0000-0000-000000000003'
  );
  v_reserve_task_again := public.ensure_operation_task_v2(
    'reserve_flight',
    '91000000-0000-0000-0000-000000000003',
    'payment_received',
    timestamptz '2026-09-24 10:00:00+00',
    '91000000-0000-0000-0000-000000000003'
  );
  perform pg_temp.assert_true(
    v_reserve_task is not null and v_reserve_task = v_reserve_task_again,
    'replaying one business event returns the existing V2 task'
  );
  perform pg_temp.assert_true(
    (select count(*) = 1 from public.operation_tasks
     where deduplication_key = public.operation_task_deduplication_key_v2(
       'reserve_flight', 'reservation',
       '91000000-0000-0000-0000-000000000003', 'payment_received', 'v2'
     )),
    'deduplication leaves one physical task for one event'
  );

  insert into public.booking_flight_reservations(id, booking_id, status, ticket_sent_to_customer)
  values (v_flight, '91000000-0000-0000-0000-000000000003', 'not_booked', false);
  perform pg_temp.assert_true(
    not public.operation_task_auto_completion_satisfied_v2(v_reserve_task),
    'unreserved flight does not auto-complete the reservation task'
  );

  update public.booking_flight_reservations set status = 'reserved' where id = v_flight;
  v_completed := public.complete_operation_task_if_satisfied_v2(v_reserve_task);
  perform pg_temp.assert_true(
    v_completed
    and (select status = 'completed' from public.operation_tasks where id = v_reserve_task),
    'reserved flight auto-completes the reservation task'
  );

  v_send_task := public.ensure_operation_task_v2(
    'send_flight_ticket',
    '91000000-0000-0000-0000-000000000003',
    'flight_reserved',
    statement_timestamp(),
    '91000000-0000-0000-0000-000000000003'
  );
  perform pg_temp.assert_true(
    not public.operation_task_auto_completion_satisfied_v2(v_send_task),
    'reserved flight without delivery does not complete ticket sending'
  );
  update public.booking_flight_reservations
  set status = 'delivered', ticket_sent_to_customer = true
  where id = v_flight;
  v_completed := public.complete_operation_task_if_satisfied_v2(v_send_task);
  perform pg_temp.assert_true(
    v_completed
    and (select status = 'completed' from public.operation_tasks where id = v_send_task),
    'ticket delivery auto-completes the send-ticket task'
  );

  v_insurance_task := public.ensure_operation_task_v2(
    'insurance_check_v2',
    '91000000-0000-0000-0000-000000000003',
    'booking_confirmed',
    statement_timestamp(),
    '91000000-0000-0000-0000-000000000003'
  );
  v_cancelled := public.cancel_operation_tasks_for_lifecycle_v2(
    'booking_cancelled',
    '91000000-0000-0000-0000-000000000003',
    null,
    'test cancellation'
  );
  perform pg_temp.assert_true(
    v_cancelled = 1
    and (select status = 'cancelled' from public.operation_tasks where id = v_insurance_task)
    and exists (
      select 1 from public.operation_task_history
      where task_id = v_insurance_task and event_type = 'lifecycle_cancelled_v2'
    ),
    'booking cancellation cancels active V2 tasks and records history'
  );
end;
$$;

update public.operation_task_templates
set is_active = false
where template_key = 'reserve_flight';

select pg_temp.assert_true(
  not exists (select 1 from public.operation_task_template_v2('reserve_flight')),
  'strict V2 lookup never falls back for a disabled template'
);

select pg_temp.assert_true(
  exists (select 1 from public.operation_task_template_defaults('reserve_flight')),
  'Phase 1 preserves the historical legacy fallback behavior'
);

select pg_temp.assert_true(
  position(
    'delete from public.operation_tasks'
    in lower(pg_get_functiondef('public.cancel_operation_tasks_for_lifecycle_v2(text,uuid,uuid,text)'::regprocedure))
  ) = 0,
  'lifecycle function never deletes operation tasks'
);

select pg_temp.assert_true(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'bookings_operation_checklist_after_insert'
      and tgenabled <> 'D'
  ),
  'legacy booking checklist trigger remains installed and enabled'
);

select pg_temp.assert_true(
  not exists (
    select 1
    from pg_trigger tr
    join pg_proc p on p.oid = tr.tgfoid
    where not tr.tgisinternal
      and p.proname in (
        'ensure_operation_task_v2',
        'cancel_operation_tasks_for_lifecycle_v2',
        'complete_operation_task_if_satisfied_v2'
      )
  ),
  'phase 1 installs no V2 automation trigger'
);

do $$
declare
  v_tasks_before bigint;
  v_tasks_after bigint;
  v_history_before bigint;
  v_history_after bigint;
begin
  select count(*) into v_tasks_before from public.operation_tasks;
  select count(*) into v_history_before from public.operation_task_history;
  perform count(*) from public.dry_run_operation_tasks_v2(timestamptz '2026-09-24 12:00:00+00');
  select count(*) into v_tasks_after from public.operation_tasks;
  select count(*) into v_history_after from public.operation_task_history;
  perform pg_temp.assert_true(
    v_tasks_before = v_tasks_after and v_history_before = v_history_after,
    'dry-run does not change tasks or history'
  );
end;
$$;

rollback;
