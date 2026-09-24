-- READ ONLY: V1/V2 operation task comparison before V2 activation.
-- This diagnostic mirrors the Phase 1 dry-run without applying its migration.
-- It creates no function, view, trigger, template, task, or history row.
begin read only;

with
settings as (
  select statement_timestamp() as as_of
),
templates(
  template_key, scope_type, trigger_key, deadline_anchor,
  offset_days, grace_hours, priority, travel_type, auto_key
) as (
  values
    ('passport_check_v2','traveler','booking_confirmed','trip_start',-90,24,'high','all',null),
    ('visa_japan_v2','visa','visa_application_created','trip_start',-30,24,'high','all','visa_status_approved'),
    ('insurance_check_v2','reservation','booking_confirmed','trip_start',-14,24,'medium','all',null),
    ('reserve_flight','reservation','payment_received','payment_event',1,24,'high','all','flight_reserved'),
    ('send_flight_ticket','reservation','flight_reserved','event',1,24,'high','all','flight_ticket_delivered'),
    ('hotel_confirmation_v2','trip','trip_operational','trip_start',-45,24,'high','organized',null),
    ('rooming_final_v2','trip','trip_operational','trip_start',-30,24,'high','organized','rooming_complete'),
    ('guide_confirmation_v2','trip','trip_operational','trip_start',-30,24,'high','organized',null),
    ('group_transport_v2','trip','trip_operational','trip_start',-21,24,'high','organized',null),
    ('airport_transfers_v2','trip','trip_operational','trip_start',-7,24,'high','organized',null),
    ('final_documents_v2','trip','trip_operational','trip_start',-7,24,'critical','organized',null)
),
active_bookings as (
  select
    b.*,
    coalesce(tr.start_date, b.travel_start_date) as effective_start_date,
    tr.title as trip_title,
    tr.status::text as trip_status,
    tr.archived_at,
    case
      when b.originating_fit_quote_id is not null or b.fit_quote_acceptance_id is not null then 'fit'
      when b.trip_id is not null then 'organized'
      else 'unclassified'
    end as reliable_travel_type,
    case
      when b.originating_fit_quote_id is not null or b.fit_quote_acceptance_id is not null then 'fit'
      when b.trip_id is not null then 'organized'
      else 'fit'
    end as phase1_inferred_travel_type
  from public.bookings b
  left join public.trips tr on tr.id = b.trip_id
  where b.status::text in ('confirmed', 'paid')
    and (tr.id is null or tr.archived_at is null)
),
candidates as (
  select
    t.*, bp.id as scope_entity_id, b.id as booking_id, b.trip_id,
    bp.id as participant_id, null::uuid as visa_application_id,
    b.effective_start_date as trip_start, b.updated_at as event_at,
    b.reference as entity_label, b.trip_title, b.trip_status,
    b.reliable_travel_type,
    nullif(trim(coalesce(bp.passport_no, bp.passport_number, '')), '') is not null as passport_information_received
  from templates t
  join active_bookings b
    on t.scope_type = 'traveler' and t.trigger_key = 'booking_confirmed'
  join public.booking_participants bp on bp.booking_id = b.id
  where t.travel_type in ('all', b.phase1_inferred_travel_type)

  union all

  select
    t.*, b.id, b.id, b.trip_id, null::uuid, null::uuid,
    b.effective_start_date, b.updated_at, b.reference, b.trip_title, b.trip_status,
    b.reliable_travel_type, false
  from templates t
  join active_bookings b
    on t.scope_type = 'reservation' and t.trigger_key = 'booking_confirmed'
  where t.travel_type in ('all', b.phase1_inferred_travel_type)

  union all

  select
    t.*, b.id, b.id, b.trip_id, null::uuid, null::uuid,
    b.effective_start_date, p.event_at, b.reference, b.trip_title, b.trip_status,
    b.reliable_travel_type, false
  from templates t
  join active_bookings b
    on t.scope_type = 'reservation' and t.trigger_key = 'payment_received'
  join lateral (
    select max(coalesce(pay.paid_at, pay.created_at)) as event_at
    from public.payments pay
    where pay.booking_id = b.id
      and pay.status::text in ('received', 'paid', 'completed')
  ) p on p.event_at is not null
  where t.travel_type in ('all', b.phase1_inferred_travel_type)

  union all

  select
    t.*, b.id, b.id, b.trip_id, null::uuid, null::uuid,
    b.effective_start_date, f.updated_at, b.reference, b.trip_title, b.trip_status,
    b.reliable_travel_type, false
  from templates t
  join active_bookings b
    on t.scope_type = 'reservation' and t.trigger_key = 'flight_reserved'
  join lateral (
    select fr.*
    from public.booking_flight_reservations fr
    where fr.booking_id = b.id
      and fr.status in ('booked','reserved','partially_ticketed','ticketed','delivered','ticket_sent')
    order by fr.updated_at desc, fr.id
    limit 1
  ) f on true
  where t.travel_type in ('all', b.phase1_inferred_travel_type)

  union all

  select
    t.*, v.id, v.booking_id,
    coalesce(v.selected_trip_id, v.document_trip_id, b.trip_id),
    v.booking_participant_id, v.id, tr.start_date, v.created_at,
    v.reference, tr.title, tr.status::text,
    case when tr.id is null then 'unclassified' else 'organized' end,
    false
  from templates t
  join public.visa_applications v
    on t.scope_type = 'visa' and t.trigger_key = 'visa_application_created'
  left join public.bookings b on b.id = v.booking_id
  left join public.trips tr on tr.id = coalesce(v.selected_trip_id, v.document_trip_id, b.trip_id)
  where v.status::text not in ('approved', 'completed')
    and tr.id is not null
    and tr.archived_at is null
    and tr.start_date is not null
    and lower(coalesce(tr.title, '') || ' ' || coalesce(tr.destination, '')) ~ '(japon|japan)'

  union all

  select
    t.*, tr.id, null::uuid, tr.id, null::uuid, null::uuid,
    tr.start_date, tr.updated_at, tr.title, tr.title, tr.status::text,
    'organized', false
  from templates t
  join public.trips tr
    on t.scope_type = 'trip' and t.trigger_key = 'trip_operational'
  cross join settings s
  where t.travel_type in ('all', 'organized')
    and tr.archived_at is null
    and tr.status::text in ('open', 'closed')
    and tr.start_date >= s.as_of::date
),
deadlines as (
  select
    c.*,
    case
      when c.deadline_anchor = 'trip_start' then c.trip_start::timestamptz + make_interval(days => c.offset_days)
      else c.event_at + make_interval(days => c.offset_days)
    end as theoretical_deadline
  from candidates c
),
evaluated as (
  select
    d.*,
    case
      when d.theoretical_deadline is null then null
      when d.theoretical_deadline <= s.as_of then s.as_of + make_interval(hours => d.grace_hours)
      else d.theoretical_deadline
    end as deadline_v2,
    ot.id is not null as existing_operation_task,
    coalesce(ci.active_count, 0) > 0 as existing_checklist_item,
    coalesce(ci.completed_count, 0) > 0 as completed_checklist_item,
    case
      when d.template_key = 'passport_check_v2' then
        coalesce(ci.completed_count, 0) > 0 and d.passport_information_received
      when d.template_key = 'reserve_flight' then coalesce(business.flight_reserved, false)
      when d.template_key = 'send_flight_ticket' then coalesce(business.ticket_delivered, false)
      when d.template_key = 'visa_japan_v2' then coalesce(business.visa_completed, false)
      when d.template_key = 'hotel_confirmation_v2' then coalesce(business.hotels_confirmed, false)
      when d.template_key = 'guide_confirmation_v2' then coalesce(business.guides_confirmed, false)
      when d.template_key in ('group_transport_v2', 'airport_transfers_v2') then coalesce(business.transport_confirmed, false)
      when d.template_key = 'rooming_final_v2' then coalesce(business.rooming_complete, false)
      else false
    end as business_condition_satisfied,
    case
      when d.scope_type in ('reservation', 'traveler') then
        d.trip_start is not null
        and d.trip_start >= s.as_of::date
        and (
          d.reliable_travel_type = 'fit'
          or (d.reliable_travel_type = 'organized' and d.trip_status in ('open', 'closed'))
        )
      when d.scope_type = 'trip' then
        d.trip_start is not null and d.trip_start >= s.as_of::date and d.trip_status in ('open', 'closed')
      when d.scope_type = 'visa' then
        d.trip_start is not null and d.trip_start >= s.as_of::date and d.trip_status in ('open', 'closed')
      else false
    end as scope_is_reliable,
    coalesce(business.trip_operational, false) as trip_operational
  from deadlines d
  cross join settings s
  left join lateral (
    select task.id
    from public.operation_tasks task
    where task.status not in ('completed', 'cancelled')
      and (
        (d.template_key = 'reserve_flight' and task.booking_id = d.booking_id and task.category = 'flight_reservation')
        or (d.template_key = 'send_flight_ticket' and task.booking_id = d.booking_id and task.category = 'flight_ticket_delivery')
        or (d.template_key = 'passport_check_v2' and task.booking_id = d.booking_id and task.category in ('passport','passport_verification'))
        or (d.template_key = 'insurance_check_v2' and task.booking_id = d.booking_id and task.category = 'insurance')
        or (d.scope_type = 'trip' and task.trip_id = d.trip_id and task.category = case d.template_key
          when 'hotel_confirmation_v2' then 'hotel'
          when 'rooming_final_v2' then 'rooming'
          when 'guide_confirmation_v2' then 'guide'
          when 'group_transport_v2' then 'transport'
          when 'airport_transfers_v2' then 'airport_transfer'
          when 'final_documents_v2' then 'final_documents'
          else '__none__' end)
      )
    order by task.created_at
    limit 1
  ) ot on true
  left join lateral (
    select
      count(*) filter (where item.status not in ('completed','cancelled')) as active_count,
      count(*) filter (where item.status = 'completed') as completed_count
    from public.operation_checklist_items item
    join public.operation_checklists checklist on checklist.id = item.checklist_id
    left join public.bookings linked_booking on linked_booking.id = coalesce(checklist.booking_id, checklist.reservation_id)
    left join public.operation_checklist_templates legacy_template on legacy_template.id = item.template_id
    where coalesce(legacy_template.key, item.metadata->>'template_key') = case d.template_key
      when 'passport_check_v2' then 'passport_check'
      when 'insurance_check_v2' then 'insurance_check'
      when 'reserve_flight' then 'flight_reservation'
      when 'hotel_confirmation_v2' then 'hotel_rooming'
      when 'rooming_final_v2' then 'hotel_rooming'
      when 'airport_transfers_v2' then 'airport_transfer'
      when 'final_documents_v2' then 'final_documents'
      else '__none__'
    end
      and (
        (d.scope_type in ('reservation','traveler') and coalesce(checklist.booking_id,checklist.reservation_id) = d.booking_id)
        or (d.scope_type = 'trip' and coalesce(checklist.trip_id,linked_booking.trip_id) = d.trip_id)
      )
  ) ci on true
  left join lateral (
    select
      exists (
        select 1 from public.booking_flight_reservations f
        where f.booking_id = d.booking_id
          and f.status in ('booked','reserved','partially_ticketed','ticketed','delivered','ticket_sent')
      ) as flight_reserved,
      exists (
        select 1 from public.booking_flight_reservations f
        where f.booking_id = d.booking_id
          and (f.ticket_sent_to_customer or f.status in ('delivered','ticket_sent'))
      ) as ticket_delivered,
      exists (
        select 1 from public.visa_applications v
        where v.id = d.visa_application_id and v.status::text in ('approved','completed')
      ) as visa_completed,
      exists (
        select 1 from public.supplier_trip_quotes q
        where q.trip_id = d.trip_id and q.status = 'approved'
      ) as trip_operational,
      exists (
        select 1 from public.supplier_trip_quotes q
        where q.trip_id = d.trip_id and q.status = 'approved'
          and exists (select 1 from public.supplier_quote_hotel_rows r where r.quote_id=q.id and r.included_in_total)
          and not exists (select 1 from public.supplier_quote_hotel_rows r where r.quote_id=q.id and r.included_in_total and r.status <> 'confirmed')
      ) as hotels_confirmed,
      exists (
        select 1 from public.supplier_trip_quotes q
        where q.trip_id = d.trip_id and q.status = 'approved'
          and exists (select 1 from public.supplier_quote_guide_rows r where r.quote_id=q.id and r.included_in_total)
          and not exists (select 1 from public.supplier_quote_guide_rows r where r.quote_id=q.id and r.included_in_total and r.status <> 'confirmed')
      ) as guides_confirmed,
      exists (
        select 1 from public.supplier_trip_quotes q
        where q.trip_id = d.trip_id and q.status = 'approved'
          and exists (select 1 from public.supplier_quote_transport_rows r where r.quote_id=q.id and r.included_in_total)
          and not exists (select 1 from public.supplier_quote_transport_rows r where r.quote_id=q.id and r.included_in_total and r.status <> 'confirmed')
      ) as transport_confirmed,
      (
        exists (
          select 1 from public.booking_participants bp
          join public.bookings b on b.id = bp.booking_id
          where bp.trip_id = d.trip_id and b.status::text in ('confirmed','paid')
        )
        and not exists (
          select 1
          from public.booking_participants bp
          join public.bookings b on b.id = bp.booking_id
          where bp.trip_id = d.trip_id
            and b.status::text in ('confirmed','paid')
            and not exists (
              select 1
              from public.room_assignments ra
              join public.trip_rooms room on room.id = ra.room_id
              join public.trip_hotels hotel on hotel.id = room.trip_hotel_id
              where ra.participant_id = bp.id and hotel.trip_id = d.trip_id
            )
        )
      ) as rooming_complete
  ) business on true
),
classified as (
  select
    e.*,
    case
      when e.existing_operation_task then 'DUPLICATE_OPERATION_TASK'
      when e.business_condition_satisfied then 'BUSINESS_ALREADY_DONE'
      when not e.scope_is_reliable then 'WRONG_SCOPE'
      when e.existing_checklist_item then 'DUPLICATE_CHECKLIST'
      when e.template_key = 'passport_check_v2'
        and e.completed_checklist_item and not e.passport_information_received then 'NEEDS_REVIEW'
      when e.scope_type = 'trip' and not e.trip_operational then 'NEEDS_REVIEW'
      else 'NEW_VALID'
    end as classification
  from evaluated e
)
select
  c.template_key,
  c.scope_type,
  c.scope_entity_id,
  c.booking_id,
  c.trip_id,
  c.participant_id,
  c.deadline_v2,
  c.existing_operation_task,
  c.existing_checklist_item,
  c.business_condition_satisfied,
  c.classification,
  case
    when c.existing_operation_task then 'An active operation_tasks row already covers this business event.'
    when c.business_condition_satisfied and c.template_key = 'passport_check_v2'
      then 'Passport information is present and the legacy passport checklist was manually completed.'
    when c.business_condition_satisfied then 'The structured business completion condition is already satisfied.'
    when not c.scope_is_reliable then 'The booking/trip scope, operational status, or departure date is not reliable enough for automatic creation.'
    when c.existing_checklist_item then 'An active legacy checklist item already covers this need.'
    when c.template_key = 'passport_check_v2' and c.completed_checklist_item and not c.passport_information_received
      then 'Legacy passport checklist is completed but no passport number is stored; human review is required.'
    when c.scope_type = 'trip' and not c.trip_operational
      then 'Trip is commercial but the supplier quotation is not approved; operational phase has not started.'
    else 'No active operation task/checklist and no structured completion evidence were found.'
  end as reason
from classified c
order by c.template_key, c.deadline_v2 nulls last, c.scope_entity_id;

rollback;
