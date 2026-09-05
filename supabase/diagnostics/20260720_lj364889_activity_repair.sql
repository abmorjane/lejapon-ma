-- Targeted local repair script for LJ-364889.
-- Do not run as a migration.
-- Default mode is preview-only and ends with ROLLBACK.
--
-- To apply after reviewing the preview:
-- 1. change v_apply boolean := false to true,
-- 2. change the final ROLLBACK to COMMIT,
-- 3. run in one transaction as an authorized staff/admin database session.

begin;

do $$
declare
  v_apply boolean := false;
  v_user_id uuid := auth.uid();
  v_booking_id uuid;
  v_booking_reference text;
  v_universal_removed integer := 0;
  v_inserted integer := 0;
  v_assignment_id uuid;
  v_target record;
  v_participant record;
begin
  select b.id, b.reference
  into v_booking_id, v_booking_reference
  from public.bookings b
  left join public.trips t on t.id = b.trip_id
  where b.reference = 'LJ-364889'
    and public.normalize_activity_match_text(t.title) like '%voyage en juillet 2026%'
  limit 1;

  if v_booking_id is null then
    raise exception 'booking_LJ_364889_not_found';
  end if;

  raise notice 'Booking found: % (%)', v_booking_reference, v_booking_id;

  raise notice 'Preview - affectations Universal Studios actives à retirer:';
  for v_target in
    select
      bpa.id as assignment_id,
      bpa.participant_id,
      concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')) as participant_name,
      bpa.extra_id,
      e.name as activity_name,
      bpa.booking_extra_id,
      bpa.source,
      bpa.created_at,
      bpa.assigned_at,
      bpa.assigned_by
    from public.booking_participant_activities bpa
    join public.booking_participants bp on bp.id = bpa.participant_id
    join public.extras e on e.id = bpa.extra_id
    where bp.booking_id = v_booking_id
      and bpa.is_selected = true
      and public.normalize_activity_match_text(e.name) like '%universal%'
      and public.normalize_activity_match_text(concat_ws(' ', bp.first_name, bp.last_name)) in (
        public.normalize_activity_match_text('AHMED HEMRAS'),
        public.normalize_activity_match_text('KHADIJA BASRAOUI')
      )
  loop
    raise notice '- remove % -> % | assignment_id=% | source=% | created_at=% | assigned_by=%',
      v_target.participant_name,
      v_target.activity_name,
      v_target.assignment_id,
      v_target.source,
      v_target.created_at,
      v_target.assigned_by;

    if v_apply then
      update public.booking_participant_activities
      set is_selected = false,
          removed_at = now(),
          removed_by = v_user_id,
          removal_reason = 'targeted_LJ_364889_universal_without_purchased_unit',
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'repair_case', 'LJ-364889',
            'repair_reason', 'universal_without_purchased_unit'
          )
      where id = v_target.assignment_id
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
        v_booking_id,
        v_assignment_id,
        v_target.participant_id,
        v_target.extra_id,
        v_target.booking_extra_id,
        'removed',
        jsonb_build_object('selected', true, 'source', v_target.source),
        jsonb_build_object('selected', false),
        v_user_id,
        'targeted_LJ_364889_universal_without_purchased_unit'
      );
      v_universal_removed := v_universal_removed + 1;
    end if;
  end loop;

  raise notice 'Preview - unités TeamLab / Cérémonie de thé à affecter à Ahmed et Khadija:';
  for v_target in
    select
      be.id as booking_extra_id,
      be.extra_id,
      e.name as activity_name,
      coalesce(be.qty, 0)::integer as qty,
      coalesce(be.unit_price_mad, e.price_mad, 0) as unit_price_mad,
      be.name_snapshot,
      be.activity_match_status
    from public.booking_extras be
    join public.extras e on e.id = be.extra_id
    where be.booking_id = v_booking_id
      and coalesce(be.qty, 0) = 2
      and public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status)
      and (
        public.normalize_activity_match_text(e.name) like '%teamlab%'
        or public.normalize_activity_match_text(e.name) like '%cérémonie%'
        or public.normalize_activity_match_text(e.name) like '%ceremonie%'
        or public.normalize_activity_match_text(e.name) like '%tea%'
      )
    order by e.name
  loop
    for v_participant in
      select
        bp.id,
        concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')) as participant_name
      from public.booking_participants bp
      where bp.booking_id = v_booking_id
        and public.normalize_activity_match_text(concat_ws(' ', bp.first_name, bp.last_name)) in (
          public.normalize_activity_match_text('AHMED HEMRAS'),
          public.normalize_activity_match_text('KHADIJA BASRAOUI')
        )
      order by bp.created_at, bp.last_name, bp.first_name
    loop
      raise notice '- assign % -> % | booking_extra_id=%',
        v_target.activity_name,
        v_participant.participant_name,
        v_target.booking_extra_id;

      if v_apply then
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
          v_booking_id,
          v_target.extra_id,
          v_target.booking_extra_id,
          true,
          'safe_reconciliation',
          v_target.unit_price_mad,
          now(),
          v_user_id,
          null,
          null,
          null,
          jsonb_build_object('repair_case', 'LJ-364889', 'repair_reason', 'targeted_teamlab_tea_assignment')
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
          v_booking_id,
          v_assignment_id,
          v_participant.id,
          v_target.extra_id,
          v_target.booking_extra_id,
          'reconciled',
          jsonb_build_object('selected', false),
          jsonb_build_object('selected', true, 'source', 'safe_reconciliation'),
          v_target.qty,
          v_target.qty,
          v_user_id,
          'targeted_LJ_364889_teamlab_tea_assignment'
        );
        v_inserted := v_inserted + 1;
      end if;
    end loop;
  end loop;

  raise notice 'Dîner avec geisha is intentionally not modified by this targeted script. Confirm exact activity mapping manually before assigning.';
  raise notice 'Apply mode: %, removed Universal assignments: %, TeamLab/Tea assignments inserted or reactivated: %',
    v_apply,
    v_universal_removed,
    v_inserted;
end $$;

-- Safety default: this script does not persist anything unless edited intentionally.
rollback;
