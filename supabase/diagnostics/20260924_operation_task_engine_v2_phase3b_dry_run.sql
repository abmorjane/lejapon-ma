-- READ ONLY: Phase 3B organized-trip group task simulation.
-- Safe before Phase 3B is installed; it mirrors the detailed gate and never
-- inserts, updates, completes, or cancels a task.
begin read only;

with params as (
  select statement_timestamp() as as_of
),
target_trips as (
  select t.*
  from public.trips t
  where lower(t.title) like '%novembre 2026%'
     or lower(t.title) like '%avril 2027%'
     or lower(t.title) like '%juillet 2027%'
),
quote_context as (
  select
    t.id trip_id,
    approved.id approved_quote_id,
    approved.status approved_quote_status,
    approved.validation_status approved_validation_status,
    approved.supplier_execution_status approved_execution_status,
    approved.approved_at,
    current_quote.id current_quote_id,
    current_quote.status current_quote_status,
    current_quote.validation_status current_validation_status,
    current_quote.supplier_execution_status current_execution_status
  from target_trips t
  left join lateral (
    select q.*
    from public.supplier_trip_quotes q
    where q.trip_id=t.id and q.status='approved'
    order by q.approved_at desc nulls last,q.version_number desc,q.updated_at desc,q.id
    limit 1
  ) approved on true
  left join lateral (
    select q.*
    from public.supplier_trip_quotes q
    where q.trip_id=t.id and q.status<>'archived'
    order by q.version_number desc,q.updated_at desc,q.id
    limit 1
  ) current_quote on true
),
trip_gate as (
  select
    t.*,
    q.approved_quote_id,
    coalesce(q.approved_quote_id,q.current_quote_id) quote_id,
    coalesce(q.approved_quote_status,q.current_quote_status) quote_status,
    coalesce(q.approved_validation_status,q.current_validation_status) validation_status,
    coalesce(q.approved_execution_status,q.current_execution_status) supplier_execution_status,
    q.approved_at,
    case
      when t.archived_at is not null then false
      when t.status::text='draft' then false
      when t.status::text not in ('open','closed') then false
      when t.start_date is null or t.start_date < (select as_of::date from params) then false
      when q.approved_quote_id is null then false
      else true
    end eligible,
    case
      when t.archived_at is not null then 'trip_archived'
      when t.status::text='draft' then 'trip_draft'
      when t.status::text not in ('open','closed')
        or t.start_date is null
        or t.start_date < (select as_of::date from params) then 'trip_not_operational'
      when q.approved_quote_id is not null then 'supplier_quote_approved'
      when q.current_quote_id is null then 'no_supplier_quote'
      else 'supplier_quote_not_ready'
    end gate_reason
  from target_trips t
  join quote_context q on q.trip_id=t.id
),
templates(template_key,category,priority,offset_days,completion_key,legacy_key) as (
  values
    ('hotel_confirmation_v2','hotel','high',-45,'group_hotels_confirmed','hotel_rooming'),
    ('guide_confirmation_v2','guide','high',-30,'group_guides_confirmed',null),
    ('rooming_final_v2','rooming','high',-30,'rooming_complete','hotel_rooming'),
    ('group_transport_v2','transport','high',-21,'group_transport_confirmed',null),
    ('airport_transfers_v2','airport_transfer','high',-7,null,'airport_transfer'),
    ('final_documents_v2','final_documents','critical',-7,null,'final_documents')
),
candidates as (
  select g.*,t.*,
    public.calculate_operation_task_deadline_v2(
      'trip_start',t.offset_days,24,g.start_date,
      coalesce(g.approved_at,(select as_of from params)),
      (select as_of from params)
    ) deadline,
    public.operation_task_deduplication_key_v2(
      t.template_key,'trip',g.id,'operations_started','v2'
    ) deduplication_key
  from trip_gate g cross join templates t
),
evaluated as (
  select c.*,
    exists (
      select 1 from public.operation_tasks ot
      where ot.deduplication_key=c.deduplication_key
         or (
           ot.template_key=c.template_key
           and ot.trip_id=c.id
           and ot.status not in ('completed','cancelled')
         )
    ) existing_operation_task,
    coalesce(legacy.item_count,0)::int legacy_item_count,
    coalesce(legacy.active_count,0)::int legacy_active_count,
    coalesce(legacy.booking_count,0)::int legacy_booking_count,
    case c.completion_key
      when 'group_hotels_confirmed' then
        c.approved_quote_id is not null
        and exists (
          select 1 from public.supplier_quote_hotel_rows r
          where r.quote_id=c.approved_quote_id and r.included_in_total
        )
        and not exists (
          select 1 from public.supplier_quote_hotel_rows r
          where r.quote_id=c.approved_quote_id and r.included_in_total and r.status<>'confirmed'
        )
      when 'group_guides_confirmed' then
        c.approved_quote_id is not null
        and exists (
          select 1 from public.supplier_quote_guide_rows r
          where r.quote_id=c.approved_quote_id and r.included_in_total
        )
        and not exists (
          select 1 from public.supplier_quote_guide_rows r
          where r.quote_id=c.approved_quote_id and r.included_in_total and r.status<>'confirmed'
        )
      when 'group_transport_confirmed' then
        c.approved_quote_id is not null
        and exists (
          select 1 from public.supplier_quote_transport_rows r
          where r.quote_id=c.approved_quote_id and r.included_in_total
        )
        and not exists (
          select 1 from public.supplier_quote_transport_rows r
          where r.quote_id=c.approved_quote_id and r.included_in_total and r.status<>'confirmed'
        )
      when 'rooming_complete' then
        exists (
          select 1
          from public.booking_participants bp
          join public.bookings b on b.id=bp.booking_id
          where b.trip_id=c.id and b.status::text in ('confirmed','paid')
        )
        and not exists (
          select 1
          from public.booking_participants bp
          join public.bookings b on b.id=bp.booking_id
          where b.trip_id=c.id
            and b.status::text in ('confirmed','paid')
            and not exists (
              select 1
              from public.room_assignments ra
              join public.trip_rooms room on room.id=ra.room_id
              join public.trip_hotels hotel on hotel.id=room.trip_hotel_id
              where ra.participant_id=bp.id and hotel.trip_id=c.id
            )
        )
      else false
    end business_condition_satisfied
  from candidates c
  left join lateral (
    select
      count(*)::int item_count,
      count(*) filter(where i.status not in ('completed','cancelled'))::int active_count,
      count(distinct coalesce(cl.booking_id,cl.reservation_id))::int booking_count
    from public.operation_checklist_items i
    join public.operation_checklists cl on cl.id=i.checklist_id
    left join public.bookings b on b.id=coalesce(cl.booking_id,cl.reservation_id)
    left join public.operation_checklist_templates lt on lt.id=i.template_id
    where c.legacy_key is not null
      and coalesce(lt.key,i.metadata->>'template_key')=c.legacy_key
      and coalesce(cl.trip_id,b.trip_id)=c.id
  ) legacy on true
)
select
  id trip_id,
  title,
  status::text trip_status,
  start_date,
  eligible gate_eligible,
  gate_reason,
  quote_id,
  quote_status,
  validation_status,
  supplier_execution_status,
  template_key,
  priority,
  deadline,
  existing_operation_task,
  legacy_item_count,
  legacy_active_count,
  legacy_booking_count,
  business_condition_satisfied,
  eligible and not existing_operation_task would_create,
  eligible and not existing_operation_task and business_condition_satisfied would_auto_complete
from evaluated
order by start_date,title,template_key;

rollback;
