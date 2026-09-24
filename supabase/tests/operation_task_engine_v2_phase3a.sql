-- LOCAL ONLY: apply Phase 1 then Phase 3A to an isolated database first.
-- All fixtures and mutations are rolled back.
begin;

create or replace function pg_temp.assert_true(p_ok boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %', p_message; end if;
  raise notice 'PASS: %', p_message;
end;
$$;

insert into public.clients(id) values ('92000000-0000-0000-0000-000000000001') on conflict do nothing;

insert into public.trips(
  id,title,destination,start_date,status,archived_at,updated_at,
  visa_japan_arrival_date,visa_japan_departure_date
) values
 ('92000000-0000-0000-0000-000000000010','Organized open','',date '2027-04-01','open',null,now(),date '2027-04-02',date '2027-04-15'),
 ('92000000-0000-0000-0000-000000000011','Organized closed','',date '2027-05-01','closed',null,now(),date '2027-05-02',date '2027-05-15'),
 ('92000000-0000-0000-0000-000000000012','VOYAGE EN NOVEMBRE 2026 (copie)','',date '2027-06-01','draft',null,now(),date '2027-06-02',date '2027-06-15'),
 ('92000000-0000-0000-0000-000000000013','Archived trip','',date '2027-07-01','open',now(),now(),date '2027-07-02',date '2027-07-15'),
 ('92000000-0000-0000-0000-000000000014','No Japan dates','',date '2027-08-01','open',null,now(),null,null)
on conflict do nothing;

insert into public.bookings(
  id,reference,status,trip_id,client_id,contact_name,updated_at,travel_start_date,
  originating_fit_quote_id,fit_quote_acceptance_id
) values
 ('92000000-0000-0000-0000-000000000101','CTX-OPEN','confirmed','92000000-0000-0000-0000-000000000010','92000000-0000-0000-0000-000000000001','Open',now(),date '2027-04-01',null,null),
 ('92000000-0000-0000-0000-000000000102','CTX-CLOSED','confirmed','92000000-0000-0000-0000-000000000011','92000000-0000-0000-0000-000000000001','Closed',now(),date '2027-05-01',null,null),
 ('92000000-0000-0000-0000-000000000103','CTX-COPY','confirmed','92000000-0000-0000-0000-000000000012','92000000-0000-0000-0000-000000000001','Copy',now(),date '2027-06-01',null,null),
 ('92000000-0000-0000-0000-000000000104','CTX-ARCHIVED','confirmed','92000000-0000-0000-0000-000000000013','92000000-0000-0000-0000-000000000001','Archived',now(),date '2027-07-01',null,null),
 ('92000000-0000-0000-0000-000000000105','CTX-FIT','confirmed',null,'92000000-0000-0000-0000-000000000001','FIT',now(),date '2027-06-01','92000000-0000-0000-0000-000000000901',null),
 ('92000000-0000-0000-0000-000000000106','CTX-NONE','confirmed',null,'92000000-0000-0000-0000-000000000001','No context',now(),null,null,null),
 ('92000000-0000-0000-0000-000000000107','LEGACY-FLIGHT','confirmed','92000000-0000-0000-0000-000000000010','92000000-0000-0000-0000-000000000001','Legacy',now(),date '2027-04-01',null,null),
 ('92000000-0000-0000-0000-000000000108','DISABLED-FLIGHT','confirmed','92000000-0000-0000-0000-000000000010','92000000-0000-0000-0000-000000000001','Disabled',now(),date '2027-04-01',null,null),
 ('92000000-0000-0000-0000-000000000109','DISABLED-SEND','confirmed','92000000-0000-0000-0000-000000000010','92000000-0000-0000-0000-000000000001','Disabled send',now(),date '2027-04-01',null,null)
on conflict do nothing;

select pg_temp.assert_true(
  (select context_type='organized' and reason='organized_active_trip' from public.operation_context_type_v2('92000000-0000-0000-0000-000000000101')),
  'future open trip is organized'
);
select pg_temp.assert_true(
  (select context_type='organized' from public.operation_context_type_v2('92000000-0000-0000-0000-000000000102')),
  'future closed trip is organized'
);
select pg_temp.assert_true(
  (select context_type='unclassified' and reason='trip_draft' from public.operation_context_type_v2('92000000-0000-0000-0000-000000000103')),
  'draft technical copy is unclassified'
);
select pg_temp.assert_true(
  (select context_type='unclassified' and reason='trip_archived' from public.operation_context_type_v2('92000000-0000-0000-0000-000000000104')),
  'archived trip is unclassified'
);
select pg_temp.assert_true(
  (select context_type='fit' and reason='fit_explicit_link' from public.operation_context_type_v2('92000000-0000-0000-0000-000000000105')),
  'explicit FIT relation is classified as FIT'
);
select pg_temp.assert_true(
  (select context_type='unclassified' and reason='missing_trip_context' from public.operation_context_type_v2('92000000-0000-0000-0000-000000000106')),
  'booking without a trip or FIT relation is unclassified'
);

insert into public.supplier_trip_quotes(id,trip_id,status)
values ('92000000-0000-0000-0000-000000000201','92000000-0000-0000-0000-000000000010','submitted');
select pg_temp.assert_true(
  (select not eligible and reason='supplier_quote_not_approved' from public.is_trip_ready_for_group_operations_v2('92000000-0000-0000-0000-000000000010')),
  'submitted supplier quote does not open group operations'
);
update public.supplier_trip_quotes set status='approved' where id='92000000-0000-0000-0000-000000000201';
select pg_temp.assert_true(
  (select eligible and reason='supplier_quote_approved' from public.is_trip_ready_for_group_operations_v2('92000000-0000-0000-0000-000000000010')),
  'approved supplier quote opens group operations'
);

insert into public.visa_applications(
  id,reference,status,booking_id,selected_trip_id,given_names,surname,created_at
) values
 ('92000000-0000-0000-0000-000000000301','VISA-JP','draft','92000000-0000-0000-0000-000000000101','92000000-0000-0000-0000-000000000010','Test','Japan',now()),
 ('92000000-0000-0000-0000-000000000302','VISA-NO-SIGNAL','draft',null,'92000000-0000-0000-0000-000000000014','Test','Unknown',now());
select pg_temp.assert_true(
  (select eligible and reason='japan_operational_dates_present' from public.is_japan_visa_candidate_v2('92000000-0000-0000-0000-000000000301')),
  'open Visa with operational Japan dates is eligible'
);
select pg_temp.assert_true(
  (select not eligible and reason='japan_operational_dates_missing' from public.is_japan_visa_candidate_v2('92000000-0000-0000-0000-000000000302')),
  'Visa without a reliable Japan signal is not eligible'
);

-- Case 1: payment creates one V2 reserve-flight task with an event +24h deadline.
insert into public.payments(id,booking_id,status,paid_at,created_at)
values ('92000000-0000-0000-0000-000000000401','92000000-0000-0000-0000-000000000101','received',statement_timestamp(),statement_timestamp());
select pg_temp.assert_true(
  (select count(*)=1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000101' and category='flight_reservation')
  and (
    select t.deadline=p.paid_at+interval '1 day'
    from public.operation_tasks t
    join public.payments p on p.booking_id=t.booking_id
    where t.booking_id='92000000-0000-0000-0000-000000000101'
      and t.category='flight_reservation'
  ),
  'payment creates exactly one reserve-flight task due in 24 hours'
);

-- Case 2: replaying the same business event remains idempotent.
update public.payments set status='paid' where id='92000000-0000-0000-0000-000000000401';
select pg_temp.assert_true(
  (select count(*)=1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000101' and category='flight_reservation'),
  'replayed payment event keeps one reserve-flight task'
);

-- Case 3: an active legacy task is reused, not duplicated.
insert into public.operation_tasks(
  id,title,priority,status,reservation_id,booking_id,trip_id,customer_id,category,deduplication_key,metadata
) values (
  '92000000-0000-0000-0000-000000000501','Legacy reserve flight','high','todo',
  '92000000-0000-0000-0000-000000000107','92000000-0000-0000-0000-000000000107',
  '92000000-0000-0000-0000-000000000010','92000000-0000-0000-0000-000000000001',
  'flight_reservation','legacy-flight-case','{}'
);
insert into public.payments(id,booking_id,status,paid_at,created_at)
values ('92000000-0000-0000-0000-000000000402','92000000-0000-0000-0000-000000000107','received',statement_timestamp(),statement_timestamp());
select pg_temp.assert_true(
  (select count(*)=1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000107' and category='flight_reservation'),
  'legacy reserve-flight task is reused without duplication'
);

-- Cases 4 and 5: reserved flight completes reserve task and creates one send task.
update public.booking_flight_reservations
set status='reserved',pnr_normalized='ABC123'
where booking_id='92000000-0000-0000-0000-000000000101';
select pg_temp.assert_true(
  (select status='completed' from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000101' and category='flight_reservation')
  and (select count(*)=1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000101' and category='flight_ticket_delivery'),
  'reserved flight completes reserve task and creates one send-ticket task'
);
update public.booking_flight_reservations
set status='partially_ticketed'
where booking_id='92000000-0000-0000-0000-000000000101';
select pg_temp.assert_true(
  (select count(*)=1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000101' and category='flight_ticket_delivery'),
  'replayed reserved status keeps one send-ticket task'
);

-- Case 6: explicit customer delivery completes send-ticket even without a status change.
update public.booking_flight_reservations
set ticket_sent_to_customer=true
where booking_id='92000000-0000-0000-0000-000000000101';
select pg_temp.assert_true(
  (select status='completed' from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000101' and category='flight_ticket_delivery')
  and exists(select 1 from public.operation_task_history h join public.operation_tasks t on t.id=h.task_id
             where t.booking_id='92000000-0000-0000-0000-000000000101' and t.category='flight_ticket_delivery' and h.event_type='completed'),
  'ticket delivery auto-completes and audits the send-ticket task'
);

-- Case 7: strict V2 template disablement prevents new task creation.
update public.operation_task_templates set is_active=false where template_key='reserve_flight';
insert into public.payments(id,booking_id,status,paid_at,created_at)
values ('92000000-0000-0000-0000-000000000403','92000000-0000-0000-0000-000000000108','received',statement_timestamp(),statement_timestamp());
select pg_temp.assert_true(
  not exists(select 1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000108' and category='flight_reservation'),
  'disabled reserve-flight template creates no V2 task'
);
update public.operation_task_templates set is_active=true where template_key='reserve_flight';

insert into public.payments(id,booking_id,status,paid_at,created_at)
values ('92000000-0000-0000-0000-000000000405','92000000-0000-0000-0000-000000000109','received',statement_timestamp(),statement_timestamp());
update public.operation_task_templates set is_active=false where template_key='send_flight_ticket';
update public.booking_flight_reservations
set status='reserved',pnr_normalized='NO-SEND'
where booking_id='92000000-0000-0000-0000-000000000109';
select pg_temp.assert_true(
  (select status='completed' from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000109' and category='flight_reservation')
  and not exists(select 1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000109' and category='flight_ticket_delivery'),
  'disabled send-ticket template creates no V2 task'
);
update public.operation_task_templates set is_active=true where template_key='send_flight_ticket';

-- Case 8: a payment is an explicit event; a booking with no historical trip
-- context remains supported, while its diagnostic context stays unclassified.
insert into public.payments(id,booking_id,status,paid_at,created_at)
values ('92000000-0000-0000-0000-000000000404','92000000-0000-0000-0000-000000000106','received',statement_timestamp(),statement_timestamp());
select pg_temp.assert_true(
  (select context_type='unclassified' from public.operation_context_type_v2('92000000-0000-0000-0000-000000000106'))
  and exists(select 1 from public.operation_tasks where booking_id='92000000-0000-0000-0000-000000000106' and category='flight_reservation'),
  'explicit payment keeps legacy flight behavior for a missing trip context'
);

select pg_temp.assert_true(
  (select count(*)=1 from pg_trigger where tgrelid='public.payments'::regclass and tgname='payments_create_flight_task' and not tgisinternal)
  and (select count(*)=1 from pg_trigger where tgrelid='public.booking_flight_reservations'::regclass and tgname='booking_flight_status_tasks' and not tgisinternal),
  'Phase 3A leaves one creation trigger per flight event source'
);
select pg_temp.assert_true(
  position('ensure_operation_task(' in pg_get_functiondef('public.ensure_flight_reservation_task(uuid)'::regprocedure))=0
  and position('ensure_operation_task_v2' in pg_get_functiondef('public.ensure_flight_reservation_task_v2(uuid,timestamp with time zone)'::regprocedure))>0,
  'flight workflow has no simultaneous legacy insert and V2 ensure path'
);

rollback;
