-- Operation task engine V2, phase 3B: organized-trip group operations.
--
-- This activation is intentionally event based:
-- - group tasks are created only when staff approval moves a supplier quote to
--   the approved commercial state;
-- - no existing quote or historical task is backfilled;
-- - all six tasks are scoped to the trip and use deterministic V2 keys;
-- - archived/completed trips cancel active pre-departure V2 tasks, never delete.

do $preflight$
begin
  if to_regprocedure(
    'public.ensure_operation_task_v2(text,uuid,text,timestamp with time zone,uuid,uuid,uuid,uuid,uuid,jsonb)'
  ) is null then
    raise exception 'operation_task_engine_v2_phase3a_required'
      using errcode = '55000';
  end if;
  if to_regprocedure('public.review_supplier_quote_v2(uuid,text,text)') is null then
    raise exception 'supplier_quote_workflow_required'
      using errcode = '55000';
  end if;
  if to_regprocedure('public.log_operation_task_history(uuid,text,text,text,jsonb)') is null then
    raise exception 'operation_task_history_required'
      using errcode = '55000';
  end if;
  if (
    select count(*)
    from public.operation_task_templates
    where template_key in (
      'hotel_confirmation_v2','guide_confirmation_v2','rooming_final_v2',
      'group_transport_v2','airport_transfers_v2','final_documents_v2'
    )
  ) <> 6 then
    raise exception 'operation_task_engine_v2_group_templates_required'
      using errcode = '55000';
  end if;
end
$preflight$;

-- Detailed, read-only business gate. Commercial approval is the canonical
-- transition into operations. validation_status is dossier progress and
-- supplier_execution_status is the post-approval execution progress; neither
-- replaces staff commercial approval.
create or replace function public.trip_group_operations_gate_v2(
  p_trip_id uuid,
  p_as_of timestamptz default statement_timestamp()
)
returns table(
  eligible boolean,
  reason text,
  quote_id uuid,
  quote_status text,
  validation_status text,
  supplier_execution_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_trip public.trips%rowtype;
  v_quote public.supplier_trip_quotes%rowtype;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_trip from public.trips where id = p_trip_id;
  if not found then
    return query select false, 'trip_not_found'::text, null::uuid, null::text, null::text, null::text;
    return;
  elsif v_trip.archived_at is not null then
    return query select false, 'trip_archived'::text, null::uuid, null::text, null::text, null::text;
    return;
  elsif v_trip.status::text = 'draft' then
    return query select false, 'trip_draft'::text, null::uuid, null::text, null::text, null::text;
    return;
  elsif v_trip.status::text not in ('open', 'closed')
     or v_trip.start_date is null
     or v_trip.start_date < p_as_of::date then
    return query select false, 'trip_not_operational'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  select * into v_quote
  from public.supplier_trip_quotes q
  where q.trip_id = p_trip_id
    and q.status = 'approved'
  order by q.approved_at desc nulls last, q.version_number desc, q.updated_at desc, q.id
  limit 1;

  if found then
    return query select
      true,
      'supplier_quote_approved'::text,
      v_quote.id,
      v_quote.status,
      v_quote.validation_status,
      v_quote.supplier_execution_status;
    return;
  end if;

  select * into v_quote
  from public.supplier_trip_quotes q
  where q.trip_id = p_trip_id
    and q.status <> 'archived'
  order by q.version_number desc, q.updated_at desc, q.id
  limit 1;

  if not found then
    return query select false, 'no_supplier_quote'::text, null::uuid, null::text, null::text, null::text;
  else
    return query select
      false,
      'supplier_quote_not_ready'::text,
      v_quote.id,
      v_quote.status,
      v_quote.validation_status,
      v_quote.supplier_execution_status;
  end if;
end;
$$;

-- Compatibility wrapper retained for Phase 3A callers.
create or replace function public.is_trip_ready_for_group_operations_v2(
  p_trip_id uuid,
  p_as_of timestamptz default statement_timestamp()
)
returns table(eligible boolean, reason text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select g.eligible, g.reason
  from public.trip_group_operations_gate_v2(p_trip_id, p_as_of) g
$$;

-- Canonical event and completion rules for the six trip-scoped templates.
update public.operation_task_templates
set trigger_key = 'operations_started',
    priority = case template_key
      when 'airport_transfers_v2' then 'high'
      else priority
    end,
    auto_completion_key = case template_key
      when 'hotel_confirmation_v2' then 'group_hotels_confirmed'
      when 'guide_confirmation_v2' then 'group_guides_confirmed'
      when 'group_transport_v2' then 'group_transport_confirmed'
      when 'rooming_final_v2' then 'rooming_complete'
      else null
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'engine', 'operation_tasks_v2',
      'activation', 'supplier_quote_approved',
      'scope', 'one_per_trip'
    ),
    updated_at = statement_timestamp()
where template_key in (
  'hotel_confirmation_v2',
  'guide_confirmation_v2',
  'rooming_final_v2',
  'group_transport_v2',
  'airport_transfers_v2',
  'final_documents_v2'
);

create or replace function public.trip_group_business_condition_satisfied_v2(
  p_completion_key text,
  p_trip_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote_id uuid;
  v_participant_count integer;
  v_assigned_count integer;
begin
  if p_trip_id is null then return false; end if;

  if p_completion_key = 'rooming_complete' then
    select
      count(distinct bp.id),
      count(distinct bp.id) filter (
        where exists (
          select 1
          from public.room_assignments ra
          join public.trip_rooms room on room.id = ra.room_id
          join public.trip_hotels hotel on hotel.id = room.trip_hotel_id
          where ra.participant_id = bp.id
            and hotel.trip_id = p_trip_id
        )
      )
    into v_participant_count, v_assigned_count
    from public.booking_participants bp
    join public.bookings b on b.id = bp.booking_id
    where b.trip_id = p_trip_id
      and b.status::text in ('confirmed', 'paid');

    return coalesce(v_participant_count, 0) > 0
      and v_assigned_count = v_participant_count;
  end if;

  select q.id into v_quote_id
  from public.supplier_trip_quotes q
  where q.trip_id = p_trip_id and q.status = 'approved'
  order by q.approved_at desc nulls last, q.version_number desc, q.updated_at desc, q.id
  limit 1;
  if v_quote_id is null then return false; end if;

  if p_completion_key = 'group_hotels_confirmed' then
    return exists (
      select 1 from public.supplier_quote_hotel_rows r
      where r.quote_id = v_quote_id and r.included_in_total
    ) and not exists (
      select 1 from public.supplier_quote_hotel_rows r
      where r.quote_id = v_quote_id and r.included_in_total and r.status <> 'confirmed'
    );
  elsif p_completion_key = 'group_guides_confirmed' then
    return exists (
      select 1 from public.supplier_quote_guide_rows r
      where r.quote_id = v_quote_id and r.included_in_total
    ) and not exists (
      select 1 from public.supplier_quote_guide_rows r
      where r.quote_id = v_quote_id and r.included_in_total and r.status <> 'confirmed'
    );
  elsif p_completion_key = 'group_transport_confirmed' then
    return exists (
      select 1 from public.supplier_quote_transport_rows r
      where r.quote_id = v_quote_id and r.included_in_total
    ) and not exists (
      select 1 from public.supplier_quote_transport_rows r
      where r.quote_id = v_quote_id and r.included_in_total and r.status <> 'confirmed'
    );
  end if;

  -- Transfers and final documents stay manual: there is no complete structured
  -- proof in the current schema for either business condition.
  return false;
end;
$$;

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
      where v.id = v_task.visa_application_id
        and v.status::text in ('approved', 'completed')
    );
  elsif v_completion_key in (
    'group_hotels_confirmed',
    'group_guides_confirmed',
    'group_transport_confirmed',
    'rooming_complete'
  ) then
    return public.trip_group_business_condition_satisfied_v2(v_completion_key, v_task.trip_id);
  end if;
  return false;
end;
$$;

-- Trigger-only privileged refresh. It is never exposed as an RPC. Supplier
-- users may update reservation statuses through the existing guarded RPC; the
-- trigger then records completion only when the structured condition is true.
create or replace function public.auto_complete_trip_group_tasks_internal_v2(p_trip_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task record;
  v_count integer := 0;
begin
  for v_task in
    select ot.id,ot.status
    from public.operation_tasks ot
    where ot.trip_id=p_trip_id
      and ot.trigger_version='v2'
      and ot.template_key in (
        'hotel_confirmation_v2','guide_confirmation_v2','rooming_final_v2',
        'group_transport_v2','airport_transfers_v2','final_documents_v2'
      )
      and ot.status in ('todo','in_progress','waiting')
    for update of ot
  loop
    if public.operation_task_auto_completion_satisfied_v2(v_task.id) then
      update public.operation_tasks
      set status='completed',completed_at=statement_timestamp(),completed_by=auth.uid(),
          updated_at=statement_timestamp(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'auto_completed_by','operation_tasks_v2_group_condition'
          )
      where id=v_task.id;

      perform public.log_operation_task_history(
        v_task.id,'completed',v_task.status,'completed',
        jsonb_build_object('engine','operation_tasks_v2','source','structured_group_condition')
      );
      update public.operation_task_notifications
      set read_at=coalesce(read_at,statement_timestamp())
      where task_id=v_task.id and read_at is null;
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.ensure_trip_group_operation_tasks_v2(
  p_trip_id uuid,
  p_quote_id uuid default null,
  p_event_at timestamptz default statement_timestamp()
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_gate record;
  v_template_key text;
  v_task_id uuid;
  v_ensured integer := 0;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_gate
  from public.trip_group_operations_gate_v2(p_trip_id, p_event_at)
  limit 1;
  if not coalesce(v_gate.eligible, false) then return 0; end if;
  if p_quote_id is not null and p_quote_id is distinct from v_gate.quote_id then return 0; end if;

  foreach v_template_key in array array[
    'hotel_confirmation_v2',
    'guide_confirmation_v2',
    'rooming_final_v2',
    'group_transport_v2',
    'airport_transfers_v2',
    'final_documents_v2'
  ]
  loop
    v_task_id := public.ensure_operation_task_v2(
      v_template_key,
      p_trip_id,
      'operations_started',
      p_event_at,
      null,
      null,
      p_trip_id,
      null,
      null,
      jsonb_build_object(
        'source', 'supplier_quote_approved',
        'supplier_quote_id', v_gate.quote_id,
        'workflow', 'organized_trip_group_operations'
      )
    );
    if v_task_id is not null then
      v_ensured := v_ensured + 1;
      perform public.complete_operation_task_if_satisfied_v2(v_task_id);
    end if;
  end loop;
  return v_ensured;
end;
$$;

create or replace function public.handle_supplier_quote_group_operations_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status then
    perform public.ensure_trip_group_operation_tasks_v2(
      new.trip_id,
      new.id,
      coalesce(new.approved_at, statement_timestamp())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_quote_group_operations_v2_after_approval
  on public.supplier_trip_quotes;
create trigger supplier_quote_group_operations_v2_after_approval
after update of status on public.supplier_trip_quotes
for each row execute function public.handle_supplier_quote_group_operations_v2();

create or replace function public.handle_supplier_group_task_completion_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quote_id uuid;
  v_trip_id uuid;
begin
  v_quote_id:=case when tg_op='DELETE' then old.quote_id else new.quote_id end;
  select q.trip_id into v_trip_id from public.supplier_trip_quotes q where q.id=v_quote_id;
  if v_trip_id is not null then
    perform public.auto_complete_trip_group_tasks_internal_v2(v_trip_id);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists supplier_hotel_group_task_completion_v2 on public.supplier_quote_hotel_rows;
create trigger supplier_hotel_group_task_completion_v2
after insert or delete or update of status,included_in_total on public.supplier_quote_hotel_rows
for each row execute function public.handle_supplier_group_task_completion_v2();

drop trigger if exists supplier_guide_group_task_completion_v2 on public.supplier_quote_guide_rows;
create trigger supplier_guide_group_task_completion_v2
after insert or delete or update of status,included_in_total on public.supplier_quote_guide_rows
for each row execute function public.handle_supplier_group_task_completion_v2();

drop trigger if exists supplier_transport_group_task_completion_v2 on public.supplier_quote_transport_rows;
create trigger supplier_transport_group_task_completion_v2
after insert or delete or update of status,included_in_total on public.supplier_quote_transport_rows
for each row execute function public.handle_supplier_group_task_completion_v2();

create or replace function public.handle_rooming_group_task_completion_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old_trip_id uuid;
  v_new_trip_id uuid;
begin
  if tg_op<>'INSERT' then
    select h.trip_id into v_old_trip_id
    from public.trip_rooms r join public.trip_hotels h on h.id=r.trip_hotel_id
    where r.id=old.room_id;
  end if;
  if tg_op<>'DELETE' then
    select h.trip_id into v_new_trip_id
    from public.trip_rooms r join public.trip_hotels h on h.id=r.trip_hotel_id
    where r.id=new.room_id;
  end if;
  if v_old_trip_id is not null then
    perform public.auto_complete_trip_group_tasks_internal_v2(v_old_trip_id);
  end if;
  if v_new_trip_id is not null and v_new_trip_id is distinct from v_old_trip_id then
    perform public.auto_complete_trip_group_tasks_internal_v2(v_new_trip_id);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists rooming_group_task_completion_v2 on public.room_assignments;
create trigger rooming_group_task_completion_v2
after insert or delete or update of room_id,participant_id on public.room_assignments
for each row execute function public.handle_rooming_group_task_completion_v2();

create or replace function public.handle_trip_operation_tasks_lifecycle_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.archived_at is not null and old.archived_at is distinct from new.archived_at then
    perform public.cancel_operation_tasks_for_lifecycle_v2(
      'trip_archived', null, new.id, 'trip_archived'
    );
  elsif new.status::text = 'completed' and old.status::text is distinct from new.status::text then
    perform public.cancel_operation_tasks_for_lifecycle_v2(
      'trip_completed', null, new.id, 'trip_completed'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trip_operation_tasks_lifecycle_v2 on public.trips;
create trigger trip_operation_tasks_lifecycle_v2
after update of status, archived_at on public.trips
for each row execute function public.handle_trip_operation_tasks_lifecycle_v2();

comment on function public.trip_group_operations_gate_v2(uuid,timestamptz) is
  'Detailed read-only gate: organized-trip group operations start only after staff commercial supplier-quote approval.';
comment on function public.ensure_trip_group_operation_tasks_v2(uuid,uuid,timestamptz) is
  'Idempotently ensures at most six trip-scoped V2 tasks after the supplier quote enters approved state.';
comment on function public.trip_group_business_condition_satisfied_v2(text,uuid) is
  'Structured completion evidence for group hotel, guide, transport, and rooming tasks. Transfers/documents remain manual.';

revoke all on function public.trip_group_operations_gate_v2(uuid,timestamptz) from public, anon;
revoke all on function public.trip_group_business_condition_satisfied_v2(text,uuid) from public, anon, authenticated;
revoke all on function public.auto_complete_trip_group_tasks_internal_v2(uuid) from public, anon, authenticated, service_role;
revoke all on function public.ensure_trip_group_operation_tasks_v2(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.handle_supplier_quote_group_operations_v2() from public, anon, authenticated;
revoke all on function public.handle_supplier_group_task_completion_v2() from public, anon, authenticated, service_role;
revoke all on function public.handle_rooming_group_task_completion_v2() from public, anon, authenticated, service_role;
revoke all on function public.handle_trip_operation_tasks_lifecycle_v2() from public, anon, authenticated;

grant execute on function public.trip_group_operations_gate_v2(uuid,timestamptz) to authenticated, service_role;
grant execute on function public.trip_group_business_condition_satisfied_v2(text,uuid) to service_role;
grant execute on function public.ensure_trip_group_operation_tasks_v2(uuid,uuid,timestamptz) to service_role;

notify pgrst, 'reload schema';
