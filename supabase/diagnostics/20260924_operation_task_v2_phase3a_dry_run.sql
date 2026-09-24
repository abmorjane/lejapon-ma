-- READ ONLY: production-equivalent Phase 3A dry-run before migrations apply.
-- Mirrors the canonical context, Japan Visa, group gate, and flight rules.
begin read only;

with params as (
  select statement_timestamp() as as_of
),
booking_context as (
  select b.*,
    case
      when b.originating_fit_quote_id is not null or b.fit_quote_acceptance_id is not null then 'fit'
      when b.trip_id is null then 'unclassified'
      when t.archived_at is not null then 'unclassified'
      when t.status::text not in ('open','closed') then 'unclassified'
      when t.start_date is null or t.start_date < (select as_of::date from params) then 'unclassified'
      else 'organized'
    end context_type,
    case
      when b.originating_fit_quote_id is not null or b.fit_quote_acceptance_id is not null then 'fit_explicit_link'
      when b.trip_id is null then 'missing_trip_context'
      when t.archived_at is not null then 'trip_archived'
      when t.status::text = 'draft' then 'trip_draft'
      when t.status::text not in ('open','closed') then 'trip_status_not_operational'
      when t.start_date is null then 'trip_start_missing'
      when t.start_date < (select as_of::date from params) then 'trip_departed'
      else 'organized_active_trip'
    end context_reason
  from public.bookings b
  left join public.trips t on t.id = b.trip_id
  where b.status::text in ('confirmed','paid')
),
visa_candidates as (
  select v.id,v.booking_id,v.booking_participant_id,
         coalesce(v.selected_trip_id,v.document_trip_id,b.trip_id) trip_id
  from public.visa_applications v
  left join public.bookings b on b.id = v.booking_id
  join public.trips t on t.id = coalesce(v.selected_trip_id,v.document_trip_id,b.trip_id)
  where v.status::text in ('draft','submitted','in_review','submitted_to_embassy')
    and t.archived_at is null
    and t.status::text in ('open','closed')
    and t.start_date >= (select as_of::date from params)
    and t.visa_japan_arrival_date is not null
    and t.visa_japan_departure_date is not null
    and t.visa_japan_departure_date >= t.visa_japan_arrival_date
),
group_ready as (
  select t.id
  from public.trips t
  where t.archived_at is null
    and t.status::text in ('open','closed')
    and t.start_date >= (select as_of::date from params)
    and exists (
      select 1 from public.supplier_trip_quotes q
      where q.trip_id = t.id and q.status::text = 'approved'
    )
),
candidates as (
  select 'passport_check_v2'::text template_key,bp.id entity_id,b.id booking_id,
         bp.id participant_id,b.trip_id,false completion_satisfied
  from booking_context b
  join public.booking_participants bp on bp.booking_id = b.id
  where b.context_type <> 'unclassified'

  union all
  select 'insurance_check_v2',b.id,b.id,null::uuid,b.trip_id,false
  from booking_context b where b.context_type <> 'unclassified'

  union all
  select 'reserve_flight',b.id,b.id,null::uuid,b.trip_id,
    exists (
      select 1 from public.booking_flight_reservations f
      where f.booking_id = b.id
        and f.status::text in ('booked','reserved','partially_ticketed','ticketed','delivered','ticket_sent')
    )
  from booking_context b
  where (b.context_type <> 'unclassified' or b.context_reason = 'missing_trip_context')
    and exists (
      select 1 from public.payments p
      where p.booking_id = b.id and p.status::text in ('received','paid','completed')
    )

  union all
  select 'send_flight_ticket',b.id,b.id,null::uuid,b.trip_id,
    exists (
      select 1 from public.booking_flight_reservations f
      where f.booking_id = b.id
        and (f.ticket_sent_to_customer or f.status::text in ('delivered','ticket_sent'))
    )
  from booking_context b
  where (b.context_type <> 'unclassified' or b.context_reason = 'missing_trip_context')
    and exists (
      select 1 from public.booking_flight_reservations f
      where f.booking_id = b.id
        and f.status::text in ('booked','reserved','partially_ticketed','ticketed','delivered','ticket_sent')
    )

  union all
  select 'visa_japan_v2',v.id,v.booking_id,v.booking_participant_id,v.trip_id,false
  from visa_candidates v

  union all
  select gt.template_key,g.id,null::uuid,null::uuid,g.id,false
  from group_ready g
  cross join (values
    ('hotel_confirmation_v2'),('rooming_final_v2'),('guide_confirmation_v2'),
    ('group_transport_v2'),('airport_transfers_v2'),('final_documents_v2')
  ) gt(template_key)
),
evaluated as (
  select c.*,
    exists (
      select 1
      from public.operation_tasks ot
      where (c.template_key='reserve_flight' and ot.booking_id=c.booking_id and ot.category='flight_reservation')
         or (c.template_key='send_flight_ticket' and ot.booking_id=c.booking_id and ot.category='flight_ticket_delivery')
         or (
           coalesce(ot.metadata->>'template_key','')=c.template_key
           and ot.booking_id is not distinct from c.booking_id
           and ot.trip_id is not distinct from c.trip_id
         )
    ) existing_task
  from candidates c
)
select jsonb_build_object(
  'by_template',coalesce((
    select jsonb_agg(to_jsonb(x) order by template_key)
    from (
      select template_key,count(*)::int candidates,
             count(*) filter(where existing_task)::int existing_tasks,
             count(*) filter(where completion_satisfied)::int completed_business,
             count(*) filter(where not existing_task and not completion_satisfied)::int would_create
      from evaluated group by template_key
    ) x
  ),'[]'::jsonb),
  'totals',(select jsonb_build_object(
    'candidates',count(*),
    'existing_tasks',count(*) filter(where existing_task),
    'completed_business',count(*) filter(where completion_satisfied),
    'would_create',count(*) filter(where not existing_task and not completion_satisfied)
  ) from evaluated),
  'contexts',coalesce((
    select jsonb_agg(to_jsonb(x) order by context_type,context_reason)
    from (
      select context_type,context_reason,count(*)::int bookings
      from booking_context group by context_type,context_reason
    ) x
  ),'[]'::jsonb),
  'visa_candidates',(select count(*) from visa_candidates),
  'group_ready_trips',(select count(*) from group_ready),
  'copy_context',(
    select jsonb_agg(jsonb_build_object('context_type',b.context_type,'reason',b.context_reason))
    from booking_context b
    join public.trips t on t.id=b.trip_id
    where t.title='VOYAGE EN NOVEMBRE 2026 (copie)'
  )
) result;

rollback;
