-- Activity assignment integrity diagnostics and targeted repair.
-- Keeps booking extras as the commercial source and participant assignments as explicit operational data.

create or replace function public.validate_booking_participant_activity_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_booking_id uuid;
  v_participant_trip_id uuid;
  v_booking_trip_id uuid;
  v_booking_extra record;
  v_extra record;
  v_purchased_count integer := 0;
  v_selected_count integer := 0;
begin
  select bp.booking_id, bp.trip_id
  into v_participant_booking_id, v_participant_trip_id
  from public.booking_participants bp
  where bp.id = new.participant_id;

  if v_participant_booking_id is null then
    raise exception 'participant_not_found'
      using errcode = '23503';
  end if;

  select b.trip_id
  into v_booking_trip_id
  from public.bookings b
  where b.id = coalesce(new.booking_id, v_participant_booking_id);

  if v_booking_trip_id is null then
    raise exception 'booking_not_found'
      using errcode = '23503';
  end if;

  if coalesce(new.booking_id, v_participant_booking_id) is distinct from v_participant_booking_id then
    raise exception 'participant_booking_mismatch'
      using errcode = '23514';
  end if;

  if v_participant_trip_id is not null and v_booking_trip_id is not null and v_participant_trip_id is distinct from v_booking_trip_id then
    raise exception 'participant_trip_mismatch'
      using errcode = '23514';
  end if;

  select e.id, e.is_active, e.price_mad, e.name
  into v_extra
  from public.extras e
  where e.id = new.extra_id;

  if v_extra.id is null then
    raise exception 'extra_not_found'
      using errcode = '23503';
  end if;

  if new.is_selected and not coalesce(v_extra.is_active, false) then
    raise exception 'extra_inactive'
      using errcode = '23514';
  end if;

  if new.booking_extra_id is not null then
    select be.id, be.booking_id, be.extra_id, be.name_snapshot, be.activity_match_status
    into v_booking_extra
    from public.booking_extras be
    where be.id = new.booking_extra_id;

    if v_booking_extra.id is null then
      raise exception 'booking_extra_not_found'
        using errcode = '23503';
    end if;

    if v_booking_extra.booking_id is distinct from v_participant_booking_id
       or v_booking_extra.extra_id is distinct from new.extra_id then
      raise exception 'booking_extra_mismatch'
        using errcode = '23514';
    end if;

    if new.is_selected and not public.booking_extra_activity_match_is_trusted(
      v_booking_extra.name_snapshot,
      v_extra.name,
      v_booking_extra.activity_match_status
    ) then
      raise exception 'booking_extra_activity_mismatch'
        using errcode = '23514';
    end if;
  end if;

  if new.is_selected then
    if new.booking_extra_id is null then
      raise exception 'booking_extra_required_for_activity_assignment'
        using errcode = '23514',
              detail = 'A selected participant activity must be backed by a stable purchased booking_extra row.';
    end if;

    select coalesce(sum(be.qty), 0)::integer
    into v_purchased_count
    from public.booking_extras be
    where be.booking_id = v_participant_booking_id
      and be.extra_id = new.extra_id
      and public.booking_extra_activity_match_is_trusted(be.name_snapshot, v_extra.name, be.activity_match_status);

    select count(*)::integer
    into v_selected_count
    from public.booking_participant_activities bpa
    where bpa.booking_id = v_participant_booking_id
      and bpa.extra_id = new.extra_id
      and bpa.is_selected = true
      and bpa.id is distinct from new.id;

    if v_selected_count >= v_purchased_count then
      raise exception 'activity_extra_capacity_exceeded'
        using errcode = '23514',
              detail = 'No purchased unit is available for this participant activity assignment.';
    end if;
  end if;

  new.booking_id := v_participant_booking_id;
  new.price_snapshot_mad := coalesce(new.price_snapshot_mad, v_extra.price_mad);
  new.assigned_at := case
    when new.is_selected then coalesce(new.assigned_at, now())
    else new.assigned_at
  end;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.admin_diagnose_booking_activity_integrity(
  p_booking_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_assignments jsonb := '[]'::jsonb;
  v_purchases jsonb := '[]'::jsonb;
  v_unassigned jsonb := '[]'::jsonb;
  v_row record;
begin
  if not public.v2_is_staff(v_user_id) then
    raise exception 'not_allowed'
      using errcode = '42501';
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id;

  if v_booking.id is null then
    raise exception 'booking_not_found'
      using errcode = '23503';
  end if;

  for v_row in
    with assignment_rows as (
      select
        bpa.id,
        bpa.participant_id,
        bpa.booking_id,
        bpa.extra_id,
        bpa.booking_extra_id,
        bpa.source,
        bpa.created_at,
        bpa.assigned_at,
        bpa.assigned_by,
        bpa.is_selected,
        concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')) as participant_name,
        e.name as activity_name,
        linked_be.id as linked_booking_extra_id,
        coalesce(purchased.qty, 0)::integer as purchased_qty,
        row_number() over (
          partition by bpa.booking_id, bpa.extra_id
          order by coalesce(bpa.assigned_at, bpa.created_at), bpa.id
        ) as assignment_rank,
        case
          when not bpa.is_selected then 'inactive'
          when bpa.booking_id is distinct from bp.booking_id then 'wrong_participant'
          when bpa.booking_extra_id is not null and (
            linked_be.id is null
            or linked_be.booking_id is distinct from bpa.booking_id
            or linked_be.extra_id is distinct from bpa.extra_id
            or not public.booking_extra_activity_match_is_trusted(linked_be.name_snapshot, e.name, linked_be.activity_match_status)
          ) then 'wrong_extra_linked'
          when coalesce(purchased.qty, 0) <= 0 then 'assignment_without_purchased_unit'
          when row_number() over (
            partition by bpa.booking_id, bpa.extra_id
            order by coalesce(bpa.assigned_at, bpa.created_at), bpa.id
          ) > coalesce(purchased.qty, 0) then 'duplicate_or_over_capacity'
          else 'valid'
        end as diagnostic_status
      from public.booking_participant_activities bpa
      join public.booking_participants bp on bp.id = bpa.participant_id
      left join public.extras e on e.id = bpa.extra_id
      left join public.booking_extras linked_be on linked_be.id = bpa.booking_extra_id
      left join lateral (
        select coalesce(sum(be.qty), 0)::integer as qty
        from public.booking_extras be
        where be.booking_id = bp.booking_id
          and be.extra_id = bpa.extra_id
          and public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status)
      ) purchased on true
      where bp.booking_id = p_booking_id
    )
    select * from assignment_rows order by participant_name, activity_name
  loop
    v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
      'assignment_id', v_row.id,
      'participant_id', v_row.participant_id,
      'participant_name', v_row.participant_name,
      'booking_id', v_row.booking_id,
      'extra_id', v_row.extra_id,
      'activity_name', v_row.activity_name,
      'booking_extra_id', v_row.booking_extra_id,
      'source', v_row.source,
      'created_at', v_row.created_at,
      'assigned_at', v_row.assigned_at,
      'assigned_by', v_row.assigned_by,
      'is_selected', v_row.is_selected,
      'purchased_qty', v_row.purchased_qty,
      'assignment_rank', v_row.assignment_rank,
      'status', v_row.diagnostic_status
    ));
  end loop;

  for v_row in
    select
      be.id as booking_extra_id,
      be.extra_id,
      be.name_snapshot,
      coalesce(be.qty, 0)::integer as qty,
      coalesce(be.unit_price_mad, 0) as unit_price_mad,
      be.activity_match_status,
      e.name as activity_name,
      public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status) as trusted,
      (
        select count(*)::integer
        from public.booking_participant_activities bpa
        where bpa.booking_id = p_booking_id
          and bpa.extra_id = be.extra_id
          and bpa.is_selected = true
      ) as raw_assigned_qty,
      (
        select count(*)::integer
        from public.booking_participant_activities bpa
        where bpa.booking_id = p_booking_id
          and bpa.extra_id = be.extra_id
          and bpa.is_selected = true
          and bpa.booking_extra_id = be.id
      ) as linked_assigned_qty
    from public.booking_extras be
    left join public.extras e on e.id = be.extra_id
    where be.booking_id = p_booking_id
    order by be.created_at, be.id
  loop
    v_purchases := v_purchases || jsonb_build_array(jsonb_build_object(
      'booking_extra_id', v_row.booking_extra_id,
      'extra_id', v_row.extra_id,
      'name_snapshot', v_row.name_snapshot,
      'activity_name', v_row.activity_name,
      'qty', v_row.qty,
      'unit_price_mad', v_row.unit_price_mad,
      'activity_match_status', v_row.activity_match_status,
      'trusted', v_row.trusted,
      'raw_assigned_qty', v_row.raw_assigned_qty,
      'linked_assigned_qty', v_row.linked_assigned_qty,
      'available_qty', greatest(0, v_row.qty - v_row.linked_assigned_qty)
    ));

    if coalesce(v_row.trusted, false) and v_row.qty > v_row.linked_assigned_qty then
      v_unassigned := v_unassigned || jsonb_build_array(jsonb_build_object(
        'booking_extra_id', v_row.booking_extra_id,
        'extra_id', v_row.extra_id,
        'activity_name', v_row.activity_name,
        'name_snapshot', v_row.name_snapshot,
        'qty', v_row.qty,
        'linked_assigned_qty', v_row.linked_assigned_qty,
        'status', 'purchased_unit_unassigned'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.reference,
    'trip_id', v_booking.trip_id,
    'assignments', v_assignments,
    'booking_extras', v_purchases,
    'unassigned_units', v_unassigned
  );
end;
$$;

grant execute on function public.admin_diagnose_booking_activity_integrity(uuid) to authenticated;

create or replace function public.admin_repair_booking_activity_assignments(
  p_booking_id uuid,
  p_apply boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_assignment record;
  v_booking_extra record;
  v_participant record;
  v_assignment_id uuid;
  v_active_count integer := 0;
  v_valid_count integer := 0;
  v_reason text;
  v_removals jsonb := '[]'::jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_ambiguous jsonb := '[]'::jsonb;
begin
  if not public.has_any_role(v_user_id, array['super_admin','admin']::public.app_role[]) then
    raise exception 'admin_required'
      using errcode = '42501';
  end if;

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then
    raise exception 'booking_not_found'
      using errcode = '23503';
  end if;

  select count(*)::integer
  into v_active_count
  from public.booking_participants bp
  where bp.booking_id = p_booking_id
    and coalesce(lower(bp.client_type), '') not in ('cancelled', 'canceled', 'deleted', 'archived', 'removed');

  for v_assignment in
    with assignment_rows as (
      select
        bpa.*,
        concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')) as participant_name,
        e.name as activity_name,
        linked_be.id as linked_booking_extra_id,
        coalesce(purchased.qty, 0)::integer as purchased_qty,
        row_number() over (
          partition by bpa.booking_id, bpa.extra_id
          order by coalesce(bpa.assigned_at, bpa.created_at), bpa.id
        ) as assignment_rank,
        case
          when bpa.booking_id is distinct from bp.booking_id then 'wrong_participant'
          when bpa.booking_extra_id is not null and (
            linked_be.id is null
            or linked_be.booking_id is distinct from bpa.booking_id
            or linked_be.extra_id is distinct from bpa.extra_id
            or not public.booking_extra_activity_match_is_trusted(linked_be.name_snapshot, e.name, linked_be.activity_match_status)
          ) then 'wrong_extra_linked'
          when coalesce(purchased.qty, 0) <= 0 then 'assignment_without_purchased_unit'
          when row_number() over (
            partition by bpa.booking_id, bpa.extra_id
            order by coalesce(bpa.assigned_at, bpa.created_at), bpa.id
          ) > coalesce(purchased.qty, 0) then 'duplicate_or_over_capacity'
          else null
        end as repair_reason
      from public.booking_participant_activities bpa
      join public.booking_participants bp on bp.id = bpa.participant_id
      left join public.extras e on e.id = bpa.extra_id
      left join public.booking_extras linked_be on linked_be.id = bpa.booking_extra_id
      left join lateral (
        select coalesce(sum(be.qty), 0)::integer as qty
        from public.booking_extras be
        where be.booking_id = bp.booking_id
          and be.extra_id = bpa.extra_id
          and public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status)
      ) purchased on true
      where bp.booking_id = p_booking_id
        and bpa.is_selected = true
    )
    select * from assignment_rows where repair_reason is not null order by participant_name, activity_name
  loop
    v_removals := v_removals || jsonb_build_array(jsonb_build_object(
      'assignment_id', v_assignment.id,
      'participant_id', v_assignment.participant_id,
      'participant_name', v_assignment.participant_name,
      'extra_id', v_assignment.extra_id,
      'activity_name', v_assignment.activity_name,
      'booking_extra_id', v_assignment.booking_extra_id,
      'reason', v_assignment.repair_reason,
      'source', v_assignment.source,
      'created_at', v_assignment.created_at,
      'assigned_by', v_assignment.assigned_by
    ));

    if p_apply then
      update public.booking_participant_activities
      set is_selected = false,
          removed_at = now(),
          removed_by = v_user_id,
          removal_reason = coalesce(p_reason, 'activity_integrity_repair'),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('repair_reason', v_assignment.repair_reason)
      where id = v_assignment.id
      returning id into v_assignment_id;

      insert into public.booking_participant_activity_history (
        booking_id,
        booking_participant_activity_id,
        participant_id,
        extra_id,
        booking_extra_id,
        action,
        old_state,
        new_state,
        user_id,
        reason
      ) values (
        p_booking_id,
        v_assignment_id,
        v_assignment.participant_id,
        v_assignment.extra_id,
        v_assignment.booking_extra_id,
        'removed',
        jsonb_build_object('selected', true, 'reason', v_assignment.repair_reason),
        jsonb_build_object('selected', false),
        v_user_id,
        coalesce(p_reason, 'activity_integrity_repair')
      );
    end if;
  end loop;

  for v_booking_extra in
    select
      be.id,
      be.extra_id,
      be.name_snapshot,
      coalesce(be.qty, 0)::integer as qty,
      coalesce(be.unit_price_mad, 0) as unit_price_mad,
      be.activity_match_status,
      e.name as activity_name,
      public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status) as trusted
    from public.booking_extras be
    left join public.extras e on e.id = be.extra_id
    where be.booking_id = p_booking_id
    order by be.created_at, be.id
  loop
    if not coalesce(v_booking_extra.trusted, false) or v_booking_extra.extra_id is null then
      v_ambiguous := v_ambiguous || jsonb_build_array(jsonb_build_object(
        'booking_extra_id', v_booking_extra.id,
        'name_snapshot', v_booking_extra.name_snapshot,
        'activity_name', v_booking_extra.activity_name,
        'qty', v_booking_extra.qty,
        'status', 'activity_not_confirmed'
      ));
      continue;
    end if;

    select count(*)::integer
    into v_valid_count
    from public.booking_participant_activities bpa
    where bpa.booking_id = p_booking_id
      and bpa.extra_id = v_booking_extra.extra_id
      and bpa.is_selected = true;

    if v_booking_extra.qty = v_active_count and v_valid_count = 0 and v_active_count > 0 then
      for v_participant in
        select bp.id, concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')) as participant_name
        from public.booking_participants bp
        where bp.booking_id = p_booking_id
          and coalesce(lower(bp.client_type), '') not in ('cancelled', 'canceled', 'deleted', 'archived', 'removed')
        order by bp.created_at, bp.last_name, bp.first_name
      loop
        v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
          'booking_extra_id', v_booking_extra.id,
          'extra_id', v_booking_extra.extra_id,
          'activity_name', v_booking_extra.activity_name,
          'participant_id', v_participant.id,
          'participant_name', v_participant.participant_name
        ));

        if p_apply then
          insert into public.booking_participant_activities (
            participant_id,
            booking_id,
            extra_id,
            booking_extra_id,
            is_selected,
            source,
            price_snapshot_mad,
            assigned_at,
            assigned_by,
            removed_at,
            removed_by,
            removal_reason,
            metadata
          ) values (
            v_participant.id,
            p_booking_id,
            v_booking_extra.extra_id,
            v_booking_extra.id,
            true,
            'safe_reconciliation',
            v_booking_extra.unit_price_mad,
            now(),
            v_user_id,
            null,
            null,
            null,
            jsonb_build_object('reason', coalesce(p_reason, 'activity_integrity_repair'))
          )
          on conflict (participant_id, extra_id)
          do update set
            booking_id = excluded.booking_id,
            booking_extra_id = excluded.booking_extra_id,
            is_selected = true,
            source = 'safe_reconciliation',
            price_snapshot_mad = excluded.price_snapshot_mad,
            assigned_at = now(),
            assigned_by = v_user_id,
            removed_at = null,
            removed_by = null,
            removal_reason = null,
            metadata = coalesce(public.booking_participant_activities.metadata, '{}'::jsonb) || excluded.metadata
          returning id into v_assignment_id;

          insert into public.booking_participant_activity_history (
            booking_id,
            booking_participant_activity_id,
            participant_id,
            extra_id,
            booking_extra_id,
            action,
            old_state,
            new_state,
            quantity_before,
            quantity_after,
            user_id,
            reason
          ) values (
            p_booking_id,
            v_assignment_id,
            v_participant.id,
            v_booking_extra.extra_id,
            v_booking_extra.id,
            'reconciled',
            jsonb_build_object('selected', false),
            jsonb_build_object('selected', true, 'source', 'safe_reconciliation'),
            v_booking_extra.qty,
            v_booking_extra.qty,
            v_user_id,
            coalesce(p_reason, 'activity_integrity_repair')
          );
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'booking_reference', v_booking.reference,
    'apply', p_apply,
    'removals', v_removals,
    'assignments', v_assignments,
    'ambiguous', v_ambiguous
  );
end;
$$;

grant execute on function public.admin_repair_booking_activity_assignments(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
