-- Operation task engine V2, phase 3A.
--
-- Activates only the existing flight workflow on the V2 idempotence helpers.
-- Visa and organized-trip templates remain dry-run only. No backfill is run.

do $$
begin
  if to_regprocedure(
    'public.ensure_operation_task_v2(text,uuid,text,timestamp with time zone,uuid,uuid,uuid,uuid,uuid,jsonb)'
  ) is null then
    raise exception 'operation_task_engine_v2_phase1_required'
      using errcode = '55000';
  end if;
end $$;

-- Explicit flight events remain eligible when an old booking has no trip/FIT
-- relation. Other unclassified contexts remain blocked from V2 automation.
update public.operation_task_templates
set conditions = coalesce(conditions, '{}'::jsonb) || jsonb_build_object(
      'allow_unclassified_reasons', jsonb_build_array('missing_trip_context')
    ),
    updated_at = statement_timestamp()
where template_key in ('reserve_flight', 'send_flight_ticket');

create or replace function public.operation_context_type_v2(
  p_booking_id uuid,
  p_as_of timestamptz default statement_timestamp()
)
returns table(context_type text, reason text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking public.bookings%rowtype;
  v_trip public.trips%rowtype;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id;

  if not found then
    return query select 'unclassified'::text, 'booking_not_found'::text;
    return;
  end if;

  if v_booking.originating_fit_quote_id is not null
     or v_booking.fit_quote_acceptance_id is not null then
    return query select 'fit'::text, 'fit_explicit_link'::text;
    return;
  end if;

  if v_booking.trip_id is null then
    return query select 'unclassified'::text, 'missing_trip_context'::text;
    return;
  end if;

  select * into v_trip
  from public.trips
  where id = v_booking.trip_id;

  if not found then
    return query select 'unclassified'::text, 'trip_not_found'::text;
  elsif v_trip.archived_at is not null then
    return query select 'unclassified'::text, 'trip_archived'::text;
  elsif v_trip.status::text = 'draft' then
    return query select 'unclassified'::text, 'trip_draft'::text;
  elsif v_trip.status::text not in ('open', 'closed') then
    return query select 'unclassified'::text, 'trip_status_not_operational'::text;
  elsif v_trip.start_date is null then
    return query select 'unclassified'::text, 'trip_start_missing'::text;
  elsif v_trip.start_date < p_as_of::date then
    return query select 'unclassified'::text, 'trip_departed'::text;
  else
    return query select 'organized'::text, 'organized_active_trip'::text;
  end if;
end;
$$;

create or replace function public.is_trip_ready_for_group_operations_v2(
  p_trip_id uuid,
  p_as_of timestamptz default statement_timestamp()
)
returns table(eligible boolean, reason text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_trip public.trips%rowtype;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    return query select false, 'trip_not_found'::text;
  elsif v_trip.archived_at is not null then
    return query select false, 'trip_archived'::text;
  elsif v_trip.status::text = 'draft' then
    return query select false, 'trip_draft'::text;
  elsif v_trip.status::text not in ('open', 'closed') then
    return query select false, 'trip_status_not_operational'::text;
  elsif v_trip.start_date is null then
    return query select false, 'trip_start_missing'::text;
  elsif v_trip.start_date < p_as_of::date then
    return query select false, 'trip_departed'::text;
  elsif not exists (
    select 1
    from public.supplier_trip_quotes q
    where q.trip_id = p_trip_id
      and q.status::text = 'approved'
  ) then
    return query select false, 'supplier_quote_not_approved'::text;
  else
    return query select true, 'supplier_quote_approved'::text;
  end if;
end;
$$;

create or replace function public.is_japan_visa_candidate_v2(
  p_visa_application_id uuid,
  p_as_of timestamptz default statement_timestamp()
)
returns table(eligible boolean, reason text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_visa public.visa_applications%rowtype;
  v_booking public.bookings%rowtype;
  v_trip public.trips%rowtype;
  v_trip_id uuid;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_visa
  from public.visa_applications
  where id = p_visa_application_id;

  if not found then
    return query select false, 'visa_application_not_found'::text;
    return;
  elsif v_visa.status::text not in ('draft', 'submitted', 'in_review', 'submitted_to_embassy') then
    return query select false, 'visa_status_not_open'::text;
    return;
  end if;

  if v_visa.booking_id is not null then
    select * into v_booking from public.bookings where id = v_visa.booking_id;
  end if;
  v_trip_id := coalesce(v_visa.selected_trip_id, v_visa.document_trip_id, v_booking.trip_id);

  if v_trip_id is null then
    return query select false, 'visa_trip_missing'::text;
    return;
  end if;

  select * into v_trip from public.trips where id = v_trip_id;
  if not found then
    return query select false, 'visa_trip_not_found'::text;
  elsif v_trip.archived_at is not null then
    return query select false, 'visa_trip_archived'::text;
  elsif v_trip.status::text not in ('open', 'closed') then
    return query select false, 'visa_trip_not_operational'::text;
  elsif v_trip.start_date is null or v_trip.start_date < p_as_of::date then
    return query select false, 'visa_trip_not_future'::text;
  elsif v_trip.visa_japan_arrival_date is null
     or v_trip.visa_japan_departure_date is null
     or v_trip.visa_japan_departure_date < v_trip.visa_japan_arrival_date then
    return query select false, 'japan_operational_dates_missing'::text;
  else
    return query select true, 'japan_operational_dates_present'::text;
  end if;
end;
$$;

create or replace function public.is_flight_reserved_status_v2(p_status text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(p_status, '') in (
    'booked', 'reserved', 'partially_ticketed', 'ticketed', 'delivered', 'ticket_sent'
  )
$$;

create or replace function public.is_flight_ticket_delivered_v2(
  p_status text,
  p_ticket_sent_to_customer boolean
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(p_ticket_sent_to_customer, false)
    or coalesce(p_status, '') in ('delivered', 'ticket_sent')
$$;

-- Replace the Phase 1 implementation with canonical context checks. The only
-- unclassified exception is an explicit event allowlisted by the template.
create or replace function public.ensure_operation_task_v2(
  p_template_key text,
  p_entity_id uuid,
  p_event_key text,
  p_event_at timestamptz default statement_timestamp(),
  p_booking_id uuid default null,
  p_participant_id uuid default null,
  p_trip_id uuid default null,
  p_visa_application_id uuid default null,
  p_customer_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_template record;
  v_booking public.bookings%rowtype;
  v_participant public.booking_participants%rowtype;
  v_visa public.visa_applications%rowtype;
  v_trip_start date;
  v_context_type text := 'unclassified';
  v_context_reason text := 'missing_trip_context';
  v_gate_eligible boolean;
  v_gate_reason text;
  v_allow_unclassified boolean := false;
  v_dedup text;
  v_existing_id uuid;
  v_task_id uuid;
  v_deadline timestamptz;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_template
  from public.operation_task_template_v2(p_template_key)
  limit 1;
  if not found then return null; end if;

  if p_event_key is distinct from v_template.trigger_key then
    raise exception 'operation_task_trigger_mismatch'
      using errcode = '22023', detail = concat(p_event_key, ' <> ', v_template.trigger_key);
  end if;

  case v_template.scope_type
    when 'reservation' then
      if p_entity_id is distinct from p_booking_id and p_booking_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      select * into v_booking from public.bookings where id = p_entity_id;
      if not found then raise exception 'operation_task_scope_entity_not_found' using errcode = 'P0002'; end if;
      p_booking_id := p_entity_id;
    when 'traveler' then
      if p_entity_id is distinct from p_participant_id and p_participant_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      select * into v_participant from public.booking_participants where id = p_entity_id;
      if not found then raise exception 'operation_task_scope_entity_not_found' using errcode = 'P0002'; end if;
      p_participant_id := p_entity_id;
      p_booking_id := coalesce(p_booking_id, v_participant.booking_id);
      p_trip_id := coalesce(p_trip_id, v_participant.trip_id);
      p_customer_id := coalesce(p_customer_id, v_participant.client_id);
      select * into v_booking from public.bookings where id = p_booking_id;
    when 'trip' then
      if p_entity_id is distinct from p_trip_id and p_trip_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      p_trip_id := p_entity_id;
    when 'visa' then
      if p_entity_id is distinct from p_visa_application_id and p_visa_application_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      select * into v_visa from public.visa_applications where id = p_entity_id;
      if not found then raise exception 'operation_task_scope_entity_not_found' using errcode = 'P0002'; end if;
      p_visa_application_id := p_entity_id;
      p_booking_id := coalesce(p_booking_id, v_visa.booking_id);
      p_trip_id := coalesce(p_trip_id, v_visa.selected_trip_id, v_visa.document_trip_id);
      p_customer_id := coalesce(p_customer_id, v_visa.client_id, v_visa.linked_client_id);
      if p_booking_id is not null then
        select * into v_booking from public.bookings where id = p_booking_id;
      end if;
    when 'client' then
      p_customer_id := p_entity_id;
    else
      raise exception 'unsupported_operation_task_scope' using errcode = '22023';
  end case;

  if p_booking_id is not null and v_booking.id is null then
    select * into v_booking from public.bookings where id = p_booking_id;
  end if;
  p_trip_id := coalesce(p_trip_id, v_booking.trip_id);
  p_customer_id := coalesce(p_customer_id, v_booking.client_id);

  if v_template.scope_type = 'trip' then
    select g.eligible, g.reason into v_gate_eligible, v_gate_reason
    from public.is_trip_ready_for_group_operations_v2(p_trip_id) g;
    if not coalesce(v_gate_eligible, false) then return null; end if;
    v_context_type := 'organized';
    v_context_reason := v_gate_reason;
  elsif v_template.scope_type = 'visa' then
    select j.eligible, j.reason into v_gate_eligible, v_gate_reason
    from public.is_japan_visa_candidate_v2(p_visa_application_id) j;
    if not coalesce(v_gate_eligible, false) then return null; end if;
    v_context_type := 'organized';
    v_context_reason := v_gate_reason;
  elsif p_booking_id is not null then
    select c.context_type, c.reason into v_context_type, v_context_reason
    from public.operation_context_type_v2(p_booking_id) c;
  end if;

  if v_context_type = 'unclassified' then
    select exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(v_template.conditions->'allow_unclassified_reasons', '[]'::jsonb)
      ) allowed(reason)
      where allowed.reason = v_context_reason
    ) into v_allow_unclassified;
    if not v_allow_unclassified then return null; end if;
  elsif v_template.travel_type not in ('all', v_context_type) then
    return null;
  end if;

  select t.start_date into v_trip_start from public.trips t where t.id = p_trip_id;
  v_trip_start := coalesce(v_trip_start, v_booking.travel_start_date);

  v_dedup := public.operation_task_deduplication_key_v2(
    p_template_key, v_template.scope_type, p_entity_id, p_event_key, v_template.trigger_version
  );
  v_existing_id := public.operation_task_existing_id_v2(
    p_template_key, v_dedup, p_booking_id, p_trip_id, p_visa_application_id, p_participant_id
  );
  if v_existing_id is not null then return v_existing_id; end if;

  v_deadline := public.calculate_operation_task_deadline_v2(
    v_template.deadline_anchor,
    v_template.deadline_offset_days,
    v_template.late_booking_grace_hours,
    v_trip_start,
    p_event_at,
    statement_timestamp()
  );

  insert into public.operation_tasks (
    title, description, priority, status, assigned_to,
    reservation_id, booking_id, participant_id, trip_id,
    visa_application_id, customer_id, category, deadline,
    created_by, deduplication_key, template_key, scope_type,
    scope_entity_id, trigger_key, trigger_version, metadata
  ) values (
    v_template.title, v_template.description, v_template.priority, 'todo', null,
    p_booking_id, p_booking_id, p_participant_id, p_trip_id,
    p_visa_application_id, p_customer_id, v_template.category, v_deadline,
    auth.uid(), v_dedup, p_template_key, v_template.scope_type,
    p_entity_id, p_event_key, v_template.trigger_version,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'engine', 'operation_tasks_v2',
      'deadline_anchor', v_template.deadline_anchor,
      'context_type', v_context_type,
      'context_reason', v_context_reason,
      'default_assignee_role', v_template.default_assignee_role
    )
  )
  on conflict (deduplication_key) where deduplication_key is not null
  do nothing
  returning id into v_task_id;

  if v_task_id is null then
    select id into v_task_id from public.operation_tasks where deduplication_key = v_dedup limit 1;
    return v_task_id;
  end if;

  perform public.log_operation_task_history(
    v_task_id, 'created', null, 'todo',
    jsonb_build_object('engine', 'operation_tasks_v2', 'template_key', p_template_key, 'trigger_key', p_event_key)
  );

  insert into public.operation_task_notifications(
    task_id, notification_type, title, message, scheduled_for, metadata
  ) values (
    v_task_id, 'deadline_reminder', v_template.title,
    coalesce(v_template.description, v_template.title), v_deadline,
    jsonb_build_object('booking_id', p_booking_id, 'category', v_template.category, 'template_key', p_template_key)
  );

  return v_task_id;
end;
$$;

-- Legacy flight tasks do not have template_key columns populated. Infer only
-- the two established flight templates from their historical categories.
create or replace function public.operation_task_auto_completion_satisfied_v2(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task public.operation_tasks%rowtype;
  v_template_key text;
  v_completion_key text;
  v_participant_count integer;
  v_assigned_count integer;
begin
  select * into v_task from public.operation_tasks where id = p_task_id;
  if not found then return false; end if;

  v_template_key := coalesce(
    v_task.template_key,
    case v_task.category
      when 'flight_reservation' then 'reserve_flight'
      when 'flight_ticket_delivery' then 'send_flight_ticket'
      else null
    end
  );
  select t.auto_completion_key into v_completion_key
  from public.operation_task_templates t
  where t.template_key = v_template_key;

  if v_completion_key = 'flight_reserved' then
    return exists (
      select 1 from public.booking_flight_reservations f
      where f.booking_id = v_task.booking_id
        and public.is_flight_reserved_status_v2(f.status)
    );
  elsif v_completion_key = 'flight_ticket_delivered' then
    return exists (
      select 1 from public.booking_flight_reservations f
      where f.booking_id = v_task.booking_id
        and public.is_flight_ticket_delivered_v2(f.status, f.ticket_sent_to_customer)
    );
  elsif v_completion_key = 'visa_status_approved' then
    return exists (
      select 1 from public.visa_applications v
      where v.id = v_task.visa_application_id and v.status::text in ('approved', 'completed')
    );
  elsif v_completion_key = 'rooming_complete' then
    select count(distinct bp.id), count(distinct ra.participant_id) filter (where ra.id is not null)
    into v_participant_count, v_assigned_count
    from public.booking_participants bp
    join public.bookings b on b.id = bp.booking_id
    left join public.trip_hotels th on th.trip_id = v_task.trip_id
    left join public.trip_rooms tr on tr.trip_hotel_id = th.id
    left join public.room_assignments ra on ra.room_id = tr.id and ra.participant_id = bp.id
    where bp.trip_id = v_task.trip_id and b.status::text in ('confirmed', 'paid');
    return coalesce(v_participant_count, 0) > 0 and v_assigned_count = v_participant_count;
  end if;
  return false;
end;
$$;

create or replace function public.complete_operation_task_if_satisfied_v2(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old_status text;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not public.operation_task_auto_completion_satisfied_v2(p_task_id) then return false; end if;

  select status into v_old_status
  from public.operation_tasks
  where id = p_task_id and status not in ('completed', 'cancelled')
  for update;
  if not found then return false; end if;

  update public.operation_tasks
  set status = 'completed', completed_at = statement_timestamp(),
      completed_by = auth.uid(), updated_at = statement_timestamp(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('auto_completed_by', 'operation_tasks_v2')
  where id = p_task_id;

  perform public.log_operation_task_history(
    p_task_id, 'completed', v_old_status, 'completed', jsonb_build_object('engine', 'operation_tasks_v2')
  );
  update public.operation_task_notifications
  set read_at = coalesce(read_at, statement_timestamp())
  where task_id = p_task_id and read_at is null;
  return true;
end;
$$;

create or replace function public.ensure_flight_reservation_task_v2(
  p_booking_id uuid,
  p_event_at timestamptz default statement_timestamp()
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then return null; end if;

  insert into public.booking_flight_reservations(
    booking_id, status, created_by, updated_by, required_traveler_count
  ) values (
    p_booking_id, 'not_booked', auth.uid(), auth.uid(),
    (select count(*)::integer from public.booking_participants where booking_id = p_booking_id)
  ) on conflict (booking_id) do nothing;

  return public.ensure_operation_task_v2(
    'reserve_flight', p_booking_id, 'payment_received', p_event_at,
    p_booking_id, null, v_booking.trip_id, null, v_booking.client_id,
    jsonb_build_object('source', 'payment_confirmation', 'workflow', 'reserve_customer_flight', 'booking_reference', v_booking.reference)
  );
end;
$$;

-- Compatibility wrapper retained for every existing caller.
create or replace function public.ensure_flight_reservation_task(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return public.ensure_flight_reservation_task_v2(p_booking_id, statement_timestamp());
end;
$$;

create or replace function public.create_flight_task_after_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.booking_id is not null
     and lower(coalesce(new.status::text, '')) in ('received', 'paid', 'completed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.ensure_flight_reservation_task_v2(
      new.booking_id,
      coalesce(new.paid_at, new.created_at, statement_timestamp())
    );
  end if;
  return new;
end;
$$;

create or replace function public.handle_booking_flight_status_tasks()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task_id uuid;
  v_dedup text;
  v_status_became_reserved boolean;
  v_ticket_became_delivered boolean;
begin
  v_status_became_reserved := public.is_flight_reserved_status_v2(new.status)
    and (tg_op = 'INSERT' or old.status is distinct from new.status);
  v_ticket_became_delivered := public.is_flight_ticket_delivered_v2(new.status, new.ticket_sent_to_customer)
    and (
      tg_op = 'INSERT'
      or old.status is distinct from new.status
      or old.ticket_sent_to_customer is distinct from new.ticket_sent_to_customer
    );

  if v_status_became_reserved then
    v_dedup := public.operation_task_deduplication_key_v2(
      'reserve_flight', 'reservation', new.booking_id, 'payment_received', 'v2'
    );
    v_task_id := public.operation_task_existing_id_v2(
      'reserve_flight', v_dedup, new.booking_id, null, null, null
    );
    if v_task_id is not null then
      perform public.complete_operation_task_if_satisfied_v2(v_task_id);
    end if;

    if new.status in ('booked', 'reserved', 'partially_ticketed', 'ticketed') then
      v_task_id := public.ensure_operation_task_v2(
        'send_flight_ticket', new.booking_id, 'flight_reserved', statement_timestamp(),
        new.booking_id, null, null, null, null,
        jsonb_build_object('flight_reservation_id', new.id, 'pnr', new.pnr_normalized)
      );
    end if;
  end if;

  if v_ticket_became_delivered then
    v_dedup := public.operation_task_deduplication_key_v2(
      'send_flight_ticket', 'reservation', new.booking_id, 'flight_reserved', 'v2'
    );
    v_task_id := public.operation_task_existing_id_v2(
      'send_flight_ticket', v_dedup, new.booking_id, null, null, null
    );
    if v_task_id is not null then
      perform public.complete_operation_task_if_satisfied_v2(v_task_id);
    end if;
  end if;
  return new;
end;
$$;

-- Keep exactly one payment trigger and one flight-state trigger. No trigger is
-- installed for Visa, passports, insurance, or organized-trip templates.
drop trigger if exists booking_flight_complete_task on public.booking_flight_reservations;
drop trigger if exists booking_flight_status_tasks on public.booking_flight_reservations;
create trigger booking_flight_status_tasks
after insert or update of status, ticket_sent_to_customer on public.booking_flight_reservations
for each row execute function public.handle_booking_flight_status_tasks();

create or replace function public.dry_run_operation_tasks_v2(
  p_as_of timestamptz default statement_timestamp()
)
returns table(
  template_key text,
  template_title text,
  scope_type text,
  entity_id uuid,
  entity_label text,
  trigger_key text,
  deadline timestamptz,
  priority text,
  existing_task boolean,
  completion_satisfied boolean,
  would_create boolean,
  deduplication_key text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
  with active_templates as (
    select t.* from public.operation_task_templates t
    where t.is_active and t.archived_at is null and t.allow_auto_trigger
      and t.scope_type is not null and t.trigger_key is not null and t.deadline_anchor is not null
      and coalesce(t.trigger_version, 'v2') = 'v2'
  ),
  active_bookings as (
    select b.*, coalesce(tr.start_date, b.travel_start_date) effective_start_date,
           ctx.context_type, ctx.reason context_reason
    from public.bookings b
    left join public.trips tr on tr.id = b.trip_id
    cross join lateral public.operation_context_type_v2(b.id, p_as_of) ctx
    where b.status::text in ('confirmed', 'paid')
  ),
  candidates as (
    select t.template_key,t.title,t.priority,t.scope_type,t.trigger_key,coalesce(t.trigger_version,'v2') trigger_version,
           t.deadline_anchor,t.deadline_offset_days,coalesce(t.late_booking_grace_hours,24) late_booking_grace_hours,
           bp.id entity_id,concat_ws(' · ',nullif(trim(concat_ws(' ',bp.first_name,bp.last_name)),''),b.reference) entity_label,
           b.id booking_id,bp.id participant_id,b.trip_id,null::uuid visa_application_id,b.updated_at event_at,false completion_satisfied
    from active_templates t join active_bookings b on t.scope_type='traveler' and t.trigger_key='booking_confirmed'
    join public.booking_participants bp on bp.booking_id=b.id
    where b.context_type <> 'unclassified' and t.travel_type in ('all',b.context_type)

    union all
    select t.template_key,t.title,t.priority,t.scope_type,t.trigger_key,coalesce(t.trigger_version,'v2'),
           t.deadline_anchor,t.deadline_offset_days,coalesce(t.late_booking_grace_hours,24),
           b.id,concat_ws(' · ',b.reference,b.contact_name),b.id,null::uuid,b.trip_id,null::uuid,b.updated_at,false
    from active_templates t join active_bookings b on t.scope_type='reservation' and t.trigger_key='booking_confirmed'
    where b.context_type <> 'unclassified' and t.travel_type in ('all',b.context_type)

    union all
    select t.template_key,t.title,t.priority,t.scope_type,t.trigger_key,coalesce(t.trigger_version,'v2'),
           t.deadline_anchor,t.deadline_offset_days,coalesce(t.late_booking_grace_hours,24),
           b.id,concat_ws(' · ',b.reference,b.contact_name),b.id,null::uuid,b.trip_id,null::uuid,p.last_paid_at,
           exists(select 1 from public.booking_flight_reservations f where f.booking_id=b.id and public.is_flight_reserved_status_v2(f.status))
    from active_templates t join active_bookings b on t.scope_type='reservation' and t.trigger_key='payment_received'
    join lateral (
      select max(coalesce(pay.paid_at,pay.created_at)) last_paid_at from public.payments pay
      where pay.booking_id=b.id and pay.status::text in ('received','paid','completed')
    ) p on p.last_paid_at is not null
    where t.travel_type in ('all',b.context_type)
      and (
        b.context_type <> 'unclassified'
        or exists (
          select 1 from jsonb_array_elements_text(coalesce(t.conditions->'allow_unclassified_reasons','[]'::jsonb)) a(reason)
          where a.reason=b.context_reason
        )
      )

    union all
    select t.template_key,t.title,t.priority,t.scope_type,t.trigger_key,coalesce(t.trigger_version,'v2'),
           t.deadline_anchor,t.deadline_offset_days,coalesce(t.late_booking_grace_hours,24),
           b.id,concat_ws(' · ',b.reference,b.contact_name),b.id,null::uuid,b.trip_id,null::uuid,f.updated_at,
           public.is_flight_ticket_delivered_v2(f.status,f.ticket_sent_to_customer)
    from active_templates t join active_bookings b on t.scope_type='reservation' and t.trigger_key='flight_reserved'
    join lateral (
      select fr.* from public.booking_flight_reservations fr
      where fr.booking_id=b.id and public.is_flight_reserved_status_v2(fr.status)
      order by fr.updated_at desc,fr.id limit 1
    ) f on true
    where t.travel_type in ('all',b.context_type)
      and (
        b.context_type <> 'unclassified'
        or exists (
          select 1 from jsonb_array_elements_text(coalesce(t.conditions->'allow_unclassified_reasons','[]'::jsonb)) a(reason)
          where a.reason=b.context_reason
        )
      )

    union all
    select t.template_key,t.title,t.priority,t.scope_type,t.trigger_key,coalesce(t.trigger_version,'v2'),
           t.deadline_anchor,t.deadline_offset_days,coalesce(t.late_booking_grace_hours,24),
           v.id,concat_ws(' · ',v.reference,trim(concat_ws(' ',v.given_names,v.surname))),v.booking_id,v.booking_participant_id,
           coalesce(v.selected_trip_id,v.document_trip_id,b.trip_id),v.id,v.created_at,v.status::text in ('approved','completed')
    from active_templates t join public.visa_applications v on t.scope_type='visa' and t.trigger_key='visa_application_created'
    left join public.bookings b on b.id=v.booking_id
    cross join lateral public.is_japan_visa_candidate_v2(v.id,p_as_of) visa_gate
    where visa_gate.eligible

    union all
    select t.template_key,t.title,t.priority,t.scope_type,t.trigger_key,coalesce(t.trigger_version,'v2'),
           t.deadline_anchor,t.deadline_offset_days,coalesce(t.late_booking_grace_hours,24),
           tr.id,tr.title,null::uuid,null::uuid,tr.id,null::uuid,tr.updated_at,
           case when t.auto_completion_key='rooming_complete' then
             exists(select 1 from public.booking_participants bp join public.bookings b on b.id=bp.booking_id
                    where bp.trip_id=tr.id and b.status::text in ('confirmed','paid'))
             and not exists(
               select 1 from public.booking_participants bp join public.bookings b on b.id=bp.booking_id
               where bp.trip_id=tr.id and b.status::text in ('confirmed','paid') and not exists(
                 select 1 from public.room_assignments ra join public.trip_rooms room on room.id=ra.room_id
                 join public.trip_hotels hotel on hotel.id=room.trip_hotel_id
                 where ra.participant_id=bp.id and hotel.trip_id=tr.id
               )
             ) else false end
    from active_templates t join public.trips tr on t.scope_type='trip' and t.trigger_key='trip_operational'
    cross join lateral public.is_trip_ready_for_group_operations_v2(tr.id,p_as_of) group_gate
    where t.travel_type in ('all','organized') and group_gate.eligible
  ),
  prepared as (
    select c.*,
      public.operation_task_deduplication_key_v2(c.template_key,c.scope_type,c.entity_id,c.trigger_key,c.trigger_version) deduplication_key,
      public.calculate_operation_task_deadline_v2(
        c.deadline_anchor,c.deadline_offset_days,c.late_booking_grace_hours,
        coalesce(tr.start_date,b.travel_start_date),c.event_at,p_as_of
      ) calculated_deadline
    from candidates c left join public.bookings b on b.id=c.booking_id left join public.trips tr on tr.id=c.trip_id
  ),
  evaluated as (
    select p.*, public.operation_task_existing_id_v2(
      p.template_key,p.deduplication_key,p.booking_id,p.trip_id,p.visa_application_id,p.participant_id
    ) is not null existing_task
    from prepared p
  )
  select e.template_key,e.title,e.scope_type,e.entity_id,e.entity_label,e.trigger_key,e.calculated_deadline,e.priority,
         e.existing_task,e.completion_satisfied,not e.existing_task and not e.completion_satisfied,e.deduplication_key
  from evaluated e
  order by e.calculated_deadline nulls last,e.priority desc,e.template_key,e.entity_label;
end;
$$;

comment on function public.operation_context_type_v2(uuid,timestamptz) is
  'Canonical V2 booking context. Missing or unsafe context is unclassified and cannot auto-generate tasks.';
comment on function public.is_trip_ready_for_group_operations_v2(uuid,timestamptz) is
  'Read-only group-operation gate. A future open/closed trip requires an approved supplier quotation.';
comment on function public.is_japan_visa_candidate_v2(uuid,timestamptz) is
  'Read-only Japan Visa eligibility based on linked trip operational Japan dates, never the commercial title.';

revoke all on function public.operation_context_type_v2(uuid,timestamptz) from public, anon;
revoke all on function public.is_trip_ready_for_group_operations_v2(uuid,timestamptz) from public, anon;
revoke all on function public.is_japan_visa_candidate_v2(uuid,timestamptz) from public, anon;
revoke all on function public.is_flight_reserved_status_v2(text) from public, anon;
revoke all on function public.is_flight_ticket_delivered_v2(text,boolean) from public, anon;
revoke all on function public.ensure_flight_reservation_task_v2(uuid,timestamptz) from public, anon;

grant execute on function public.operation_context_type_v2(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.is_trip_ready_for_group_operations_v2(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.is_japan_visa_candidate_v2(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.is_flight_reserved_status_v2(text) to authenticated, service_role;
grant execute on function public.is_flight_ticket_delivered_v2(text,boolean) to authenticated, service_role;
grant execute on function public.ensure_flight_reservation_task_v2(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.ensure_flight_reservation_task(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
