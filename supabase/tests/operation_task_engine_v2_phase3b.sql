-- LOCAL/ISOLATED DATABASE ONLY. Apply Phase 1, Phase 3A, then Phase 3B first.
-- Every fixture and mutation is rolled back.
begin;

create or replace function pg_temp.assert_true(p_ok boolean,p_message text)
returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %',p_message; end if;
  raise notice 'PASS: %',p_message;
end;
$$;

insert into public.clients(id,full_name)
values ('93000000-0000-0000-0000-000000000001','Phase 3B Test Client')
on conflict do nothing;

insert into public.trips(id,slug,title,destination,start_date,end_date,status,archived_at,updated_at)
values
 ('93000000-0000-0000-0000-000000000010','phase3b-group-ready','Group ready','Japan',date '2028-12-31',date '2029-01-15','open',null,now()),
 ('93000000-0000-0000-0000-000000000011','phase3b-gate-false','Gate false','Japan',date '2028-11-30',date '2028-12-15','open',null,now()),
 ('93000000-0000-0000-0000-000000000012','phase3b-copy','VOYAGE EN NOVEMBRE 2026 (copie)','Japan',date '2028-10-31',date '2028-11-15','draft',null,now()),
 ('93000000-0000-0000-0000-000000000013','phase3b-archived','Archived','Japan',date '2028-09-30',date '2028-10-15','open',now(),now()),
 ('93000000-0000-0000-0000-000000000014','phase3b-late','Late operations','Japan',current_date+1,current_date+10,'open',null,now()),
 ('93000000-0000-0000-0000-000000000015','phase3b-revision','Revision after approval','Japan',date '2028-08-31',date '2028-09-15','open',null,now())
on conflict do nothing;

insert into public.supplier_trip_quotes(id,trip_id,status,validation_status,supplier_execution_status)
values
 ('93000000-0000-0000-0000-000000000101','93000000-0000-0000-0000-000000000010','submitted','draft','to_book'),
 ('93000000-0000-0000-0000-000000000102','93000000-0000-0000-0000-000000000011','submitted','in_progress','to_book'),
 ('93000000-0000-0000-0000-000000000103','93000000-0000-0000-0000-000000000012','submitted','draft','to_book'),
 ('93000000-0000-0000-0000-000000000104','93000000-0000-0000-0000-000000000013','submitted','draft','to_book'),
 ('93000000-0000-0000-0000-000000000105','93000000-0000-0000-0000-000000000014','submitted','draft','to_book'),
 ('93000000-0000-0000-0000-000000000106','93000000-0000-0000-0000-000000000015','submitted','draft','to_book')
on conflict do nothing;

select pg_temp.assert_true(
  (select not eligible and reason='supplier_quote_not_ready'
   and quote_id='93000000-0000-0000-0000-000000000101'
   and quote_status='submitted' and validation_status='draft'
   from public.trip_group_operations_gate_v2('93000000-0000-0000-0000-000000000010')),
  'detailed gate returns the non-ready quote context'
);
select pg_temp.assert_true(
  (select not eligible and reason='trip_draft'
   from public.trip_group_operations_gate_v2('93000000-0000-0000-0000-000000000012')),
  'draft technical copy is excluded'
);
select pg_temp.assert_true(
  (select not eligible and reason='trip_archived'
   from public.trip_group_operations_gate_v2('93000000-0000-0000-0000-000000000013')),
  'archived trip is excluded'
);

-- Twenty organized bookings must not multiply group tasks.
insert into public.bookings(
  id,reference,trip_id,client_id,contact_name,contact_email,status,travel_start_date,updated_at
)
select
  ('93000000-0000-0001-0000-'||lpad(g::text,12,'0'))::uuid,
  'GROUP-'||g,
  '93000000-0000-0000-0000-000000000010',
  '93000000-0000-0000-0000-000000000001',
  'Traveler '||g,
  'group-'||g||'@example.invalid',
  'confirmed',date '2028-12-31',now()
from generate_series(1,20) g
on conflict do nothing;

insert into public.booking_participants(id,booking_id,trip_id,first_name,last_name)
select
  ('93000000-0000-0002-0000-'||lpad(g::text,12,'0'))::uuid,
  ('93000000-0000-0001-0000-'||lpad(g::text,12,'0'))::uuid,
  '93000000-0000-0000-0000-000000000010',
  'Traveler',g::text
from generate_series(1,20) g
on conflict do nothing;

insert into public.trip_hotels(id,trip_id,name,sort_order)
values ('93000000-0000-0000-0000-000000000201','93000000-0000-0000-0000-000000000010','Test hotel',1);
insert into public.trip_rooms(id,trip_hotel_id,room_number,room_type,capacity)
values ('93000000-0000-0000-0000-000000000202','93000000-0000-0000-0000-000000000201','A','twin',30);
insert into public.room_assignments(id,room_id,participant_id)
select
  ('93000000-0000-0003-0000-'||lpad(g::text,12,'0'))::uuid,
  '93000000-0000-0000-0000-000000000202',
  ('93000000-0000-0002-0000-'||lpad(g::text,12,'0'))::uuid
from generate_series(1,19) g;

select pg_temp.assert_true(
  not public.trip_group_business_condition_satisfied_v2(
    'rooming_complete','93000000-0000-0000-0000-000000000010'
  ),
  'rooming is incomplete while one active traveler has no room'
);

-- Actual staff approval is the only creation event.
update public.supplier_trip_quotes
set status='approved',approved_at=statement_timestamp()
where id='93000000-0000-0000-0000-000000000101';

select pg_temp.assert_true(
  (select eligible and reason='supplier_quote_approved'
    and quote_id='93000000-0000-0000-0000-000000000101'
    and supplier_execution_status='to_book'
   from public.trip_group_operations_gate_v2('93000000-0000-0000-0000-000000000010')),
  'commercial approval opens organized-trip operations'
);
select pg_temp.assert_true(
  (select count(*)=6 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010'
     and trigger_version='v2' and trigger_key='operations_started')
  and (select count(distinct scope_entity_id)=1 from public.operation_tasks
       where trip_id='93000000-0000-0000-0000-000000000010'
         and trigger_version='v2' and trigger_key='operations_started')
  and not exists (
    select 1 from public.operation_tasks
    where trip_id='93000000-0000-0000-0000-000000000010'
      and trigger_version='v2' and booking_id is not null
  ),
  'twenty bookings still create exactly six trip-scoped tasks'
);

select public.ensure_trip_group_operation_tasks_v2(
  '93000000-0000-0000-0000-000000000010',
  '93000000-0000-0000-0000-000000000101',statement_timestamp()
);
select pg_temp.assert_true(
  (select count(*)=6 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010'
     and trigger_version='v2' and trigger_key='operations_started'),
  'replaying the approval event creates no duplicate'
);

select pg_temp.assert_true(
  (select deadline='2028-11-16'::date::timestamptz from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010' and template_key='hotel_confirmation_v2')
  and (select count(*)=2 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010'
     and template_key in ('guide_confirmation_v2','rooming_final_v2')
     and deadline='2028-12-01'::date::timestamptz)
  and (select deadline='2028-12-10'::date::timestamptz from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010' and template_key='group_transport_v2')
  and (select count(*)=2 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010'
     and template_key in ('airport_transfers_v2','final_documents_v2')
     and deadline='2028-12-24'::date::timestamptz),
  'deadlines use J-45, J-30, J-21, and J-7'
);

-- Structured confirmation evidence.
insert into public.supplier_quote_hotel_rows(quote_id,status,included_in_total)
values ('93000000-0000-0000-0000-000000000101','confirmed',true);
insert into public.supplier_quote_guide_rows(quote_id,status,included_in_total)
values ('93000000-0000-0000-0000-000000000101','confirmed',true);
insert into public.supplier_quote_transport_rows(quote_id,status,included_in_total)
values ('93000000-0000-0000-0000-000000000101','confirmed',true);

select pg_temp.assert_true(
  public.trip_group_business_condition_satisfied_v2('group_hotels_confirmed','93000000-0000-0000-0000-000000000010')
  and public.trip_group_business_condition_satisfied_v2('group_guides_confirmed','93000000-0000-0000-0000-000000000010')
  and public.trip_group_business_condition_satisfied_v2('group_transport_confirmed','93000000-0000-0000-0000-000000000010')
  and not public.trip_group_business_condition_satisfied_v2('airport_transfers_confirmed','93000000-0000-0000-0000-000000000010')
  and not public.trip_group_business_condition_satisfied_v2('final_documents_complete','93000000-0000-0000-0000-000000000010'),
  'only reliable hotel, guide, and transport evidence auto-completes'
);

select pg_temp.assert_true(
  (select count(*)=3 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010'
     and template_key in ('hotel_confirmation_v2','guide_confirmation_v2','group_transport_v2')
     and status='completed'),
  'supplier reservation-status events auto-complete the three structured supplier tasks'
);

insert into public.room_assignments(id,room_id,participant_id)
values (
  '93000000-0000-0003-0000-000000000020',
  '93000000-0000-0000-0000-000000000202',
  '93000000-0000-0002-0000-000000000020'
);
select pg_temp.assert_true(
  public.trip_group_business_condition_satisfied_v2('rooming_complete','93000000-0000-0000-0000-000000000010'),
  'rooming is complete only when every active traveler has a valid trip room assignment'
);
select pg_temp.assert_true(
  (select status='completed' from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010'
     and template_key='rooming_final_v2'),
  'the final room assignment auto-completes the trip rooming task'
);

select pg_temp.assert_true(
  (select count(*)=4 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010' and status='completed')
  and (select count(*)=2 from public.operation_tasks
       where trip_id='93000000-0000-0000-0000-000000000010' and status='todo'),
  'four structured tasks complete while transfers and final documents remain manual'
);

-- Gate false, draft, archived, and FIT contexts create no group task.
update public.supplier_trip_quotes set status='approved',approved_at=statement_timestamp()
where id in (
  '93000000-0000-0000-0000-000000000103',
  '93000000-0000-0000-0000-000000000104'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.operation_tasks
    where trip_id in (
      '93000000-0000-0000-0000-000000000011',
      '93000000-0000-0000-0000-000000000012',
      '93000000-0000-0000-0000-000000000013'
    ) and trigger_key='operations_started'
  ),
  'non-approved, draft, and archived trips create zero group tasks'
);

insert into public.fit_quotes(id,quote_number,client_id,status)
values (
  '93000000-0000-0000-0000-000000000999','FIT-GROUP-NONE',
  '93000000-0000-0000-0000-000000000001','accepted'
);
insert into public.bookings(
  id,reference,trip_id,client_id,contact_name,contact_email,status,travel_start_date,originating_fit_quote_id,updated_at
) values (
  '93000000-0000-0000-0000-000000000301','FIT-GROUP-NONE',null,
  '93000000-0000-0000-0000-000000000001','FIT traveler','fit@example.invalid',
  'confirmed',date '2028-12-31','93000000-0000-0000-0000-000000000999',now()
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.operation_tasks
    where booking_id='93000000-0000-0000-0000-000000000301'
      and template_key in (
        'hotel_confirmation_v2','guide_confirmation_v2','rooming_final_v2',
        'group_transport_v2','airport_transfers_v2','final_documents_v2'
      )
  ),
  'explicit FIT booking creates zero organized-trip group tasks'
);

-- A late operational approval uses the Phase 1 grace deadline.
update public.supplier_trip_quotes set status='approved',approved_at=statement_timestamp()
where id='93000000-0000-0000-0000-000000000105';
select pg_temp.assert_true(
  (select count(*)=6 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000014' and trigger_key='operations_started')
  and not exists (
    select 1 from public.operation_tasks
    where trip_id='93000000-0000-0000-0000-000000000014'
      and deadline not between statement_timestamp()+interval '23 hours 59 minutes'
                           and statement_timestamp()+interval '24 hours 1 minute'
  ),
  'passed milestones use the 24-hour late-booking grace'
);

-- A commercial revision never removes or cancels existing operational tasks.
update public.supplier_trip_quotes set status='approved',approved_at=statement_timestamp()
where id='93000000-0000-0000-0000-000000000106';
update public.supplier_trip_quotes set status='revision_requested'
where id='93000000-0000-0000-0000-000000000106';
select pg_temp.assert_true(
  (select count(*)=6 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000015'
     and status not in ('completed','cancelled')),
  'quote revision preserves existing trip tasks for human review'
);

-- Lifecycle transitions cancel remaining active pre-departure tasks, never delete.
update public.trips set archived_at=statement_timestamp()
where id='93000000-0000-0000-0000-000000000010';
select pg_temp.assert_true(
  (select count(*)=6 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000010')
  and (select count(*)=2 from public.operation_tasks
       where trip_id='93000000-0000-0000-0000-000000000010' and status='cancelled')
  and not exists (
    select 1 from public.operation_tasks
    where trip_id='93000000-0000-0000-0000-000000000010'
      and status in ('todo','in_progress','waiting')
  ),
  'archiving cancels remaining active pre-departure tasks without deleting history'
);

update public.trips set status='completed'
where id='93000000-0000-0000-0000-000000000014';
select pg_temp.assert_true(
  (select count(*)=6 from public.operation_tasks
   where trip_id='93000000-0000-0000-0000-000000000014')
  and (select count(*)=6 from public.operation_tasks
       where trip_id='93000000-0000-0000-0000-000000000014' and status='cancelled'),
  'completed trip cancels all remaining pre-departure tasks without deleting them'
);

select pg_temp.assert_true(
  position('delete from public.operation_tasks' in lower(pg_get_functiondef(
    'public.cancel_operation_tasks_for_lifecycle_v2(text,uuid,uuid,text)'::regprocedure
  )))=0,
  'lifecycle implementation contains no operation_tasks delete'
);

rollback;
