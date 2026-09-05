-- Allow admins to remove legacy inconsistent activity assignments without weakening creation rules.
-- This is a targeted follow-up to the activity assignment integrity hardening.

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

  if tg_op = 'UPDATE' and coalesce(new.is_selected, false) = false then
    if new.participant_id is distinct from old.participant_id
       or new.extra_id is distinct from old.extra_id
       or coalesce(new.booking_id, v_participant_booking_id) is distinct from coalesce(old.booking_id, v_participant_booking_id) then
      raise exception 'inactive_assignment_identity_change_forbidden'
        using errcode = '23514';
    end if;

    new.booking_id := v_participant_booking_id;
    new.updated_at := now();
    return new;
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

create or replace function public.admin_remove_inconsistent_booking_activity_assignment(
  p_assignment_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_assignment public.booking_participant_activities%rowtype;
  v_participant public.booking_participants%rowtype;
  v_extra public.extras%rowtype;
  v_linked_booking_extra public.booking_extras%rowtype;
  v_purchased_count integer := 0;
  v_assignment_rank integer := 0;
  v_status text := 'valid';
  v_assignment_id uuid;
  v_reason text;
begin
  if not public.has_any_role(v_user_id, array['super_admin','admin']::public.app_role[]) then
    raise exception 'admin_required'
      using errcode = '42501';
  end if;

  select *
  into v_assignment
  from public.booking_participant_activities
  where id = p_assignment_id
  for update;

  if v_assignment.id is null then
    raise exception 'assignment_not_found'
      using errcode = '23503';
  end if;

  select *
  into v_participant
  from public.booking_participants
  where id = v_assignment.participant_id;

  if v_participant.id is null then
    raise exception 'participant_not_found'
      using errcode = '23503';
  end if;

  if coalesce(v_assignment.is_selected, false) = false then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_unassigned',
      'assignment_id', v_assignment.id,
      'booking_id', v_participant.booking_id,
      'participant_id', v_assignment.participant_id,
      'extra_id', v_assignment.extra_id
    );
  end if;

  select *
  into v_extra
  from public.extras
  where id = v_assignment.extra_id;

  if v_extra.id is null then
    v_status := 'activity_not_found';
  end if;

  if v_assignment.booking_id is distinct from v_participant.booking_id then
    v_status := 'wrong_participant';
  end if;

  if v_assignment.booking_extra_id is not null then
    select *
    into v_linked_booking_extra
    from public.booking_extras
    where id = v_assignment.booking_extra_id;

    if v_linked_booking_extra.id is null
       or v_linked_booking_extra.booking_id is distinct from v_participant.booking_id
       or v_linked_booking_extra.extra_id is distinct from v_assignment.extra_id
       or (
         v_extra.id is not null and not public.booking_extra_activity_match_is_trusted(
           v_linked_booking_extra.name_snapshot,
           v_extra.name,
           v_linked_booking_extra.activity_match_status
         )
       ) then
      v_status := 'wrong_extra_linked';
    end if;
  end if;

  if v_status = 'valid' then
    select coalesce(sum(be.qty), 0)::integer
    into v_purchased_count
    from public.booking_extras be
    where be.booking_id = v_participant.booking_id
      and be.extra_id = v_assignment.extra_id
      and v_extra.id is not null
      and public.booking_extra_activity_match_is_trusted(be.name_snapshot, v_extra.name, be.activity_match_status);

    if v_purchased_count <= 0 then
      v_status := 'assignment_without_purchased_unit';
    else
      select ranked.assignment_rank
      into v_assignment_rank
      from (
        select
          bpa.id,
          row_number() over (order by coalesce(bpa.assigned_at, bpa.created_at), bpa.id) as assignment_rank
        from public.booking_participant_activities bpa
        where bpa.booking_id = v_participant.booking_id
          and bpa.extra_id = v_assignment.extra_id
          and bpa.is_selected = true
      ) ranked
      where ranked.id = v_assignment.id;

      if coalesce(v_assignment_rank, 0) > v_purchased_count then
        v_status := 'duplicate_or_over_capacity';
      end if;
    end if;
  end if;

  if v_status = 'valid' then
    raise exception 'assignment_not_inconsistent'
      using errcode = '23514',
            detail = 'Use the standard activity assignment workflow for valid assignments.';
  end if;

  v_reason := coalesce(nullif(p_reason, ''), 'inconsistent_assignment_removed');

  update public.booking_participant_activities
  set is_selected = false,
      removed_at = now(),
      removed_by = v_user_id,
      removal_reason = v_reason,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('repair_reason', v_status)
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
    v_participant.booking_id,
    v_assignment_id,
    v_assignment.participant_id,
    v_assignment.extra_id,
    v_assignment.booking_extra_id,
    'removed',
    jsonb_build_object('selected', true, 'diagnostic_status', v_status),
    jsonb_build_object('selected', false),
    v_user_id,
    v_reason
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'removed',
    'diagnostic_status', v_status,
    'assignment_id', v_assignment_id,
    'booking_id', v_participant.booking_id,
    'participant_id', v_assignment.participant_id,
    'extra_id', v_assignment.extra_id,
    'total_changed', false
  );
end;
$$;

grant execute on function public.admin_remove_inconsistent_booking_activity_assignment(uuid, text) to authenticated;

notify pgrst, 'reload schema';
