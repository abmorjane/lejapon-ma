-- Local diagnostic only. Do not run as a migration.
-- Purpose: debug removal of the legacy inconsistent Ahmed Hemras -> Universal Studios Japan assignment.

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.oid::regprocedure as regprocedure
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'admin_diagnose_booking_activity_integrity',
    'admin_repair_booking_activity_assignments',
    'admin_remove_inconsistent_booking_activity_assignment',
    'validate_booking_participant_activity_row'
  )
order by p.proname, arguments;

select
  tg.tgname,
  tg.tgenabled,
  tg.tgfoid::regprocedure as trigger_function
from pg_trigger tg
where tg.tgrelid = 'public.booking_participant_activities'::regclass
  and not tg.tgisinternal
order by tg.tgname;

with target_booking as (
  select id, reference, trip_id
  from public.bookings
  where reference = 'LJ-364889'
  limit 1
),
target_participant as (
  select bp.*
  from public.booking_participants bp
  join target_booking b on b.id = bp.booking_id
  where concat_ws(' ', bp.first_name, bp.last_name) ilike '%AHMED%HEMRAS%'
  limit 1
),
target_activity as (
  select id, name
  from public.extras
  where name ilike '%Universal%'
  order by name
  limit 1
)
select
  b.reference,
  bp.id as participant_id,
  concat_ws(' ', bp.first_name, bp.last_name) as participant_name,
  e.id as activity_id,
  e.name as activity_name,
  bpa.id as assignment_id,
  bpa.booking_id,
  bpa.booking_extra_id,
  bpa.source,
  bpa.is_selected,
  bpa.created_at,
  bpa.assigned_at,
  bpa.assigned_by,
  bpa.removed_at,
  bpa.removed_by,
  linked_be.id as linked_booking_extra_id,
  linked_be.name_snapshot as linked_extra_name_snapshot,
  linked_be.extra_id as linked_extra_id,
  linked_be.activity_match_status as linked_activity_match_status
from target_booking b
join target_participant bp on true
join target_activity e on true
left join public.booking_participant_activities bpa
  on bpa.participant_id = bp.id
 and bpa.extra_id = e.id
left join public.booking_extras linked_be
  on linked_be.id = bpa.booking_extra_id;

-- If the new removal RPC exists, this preview returns either a safe success
-- for already removed rows or the exact server error for a selected valid row.
-- Replace the subquery with the assignment_id above if you want to test one row explicitly.
/*
select public.admin_remove_inconsistent_booking_activity_assignment(
  (
    with target_booking as (
      select id from public.bookings where reference = 'LJ-364889' limit 1
    ),
    target_participant as (
      select bp.id
      from public.booking_participants bp
      join target_booking b on b.id = bp.booking_id
      where concat_ws(' ', bp.first_name, bp.last_name) ilike '%AHMED%HEMRAS%'
      limit 1
    ),
    target_activity as (
      select id from public.extras where name ilike '%Universal%' order by name limit 1
    )
    select bpa.id
    from public.booking_participant_activities bpa
    join target_participant bp on bp.id = bpa.participant_id
    join target_activity e on e.id = bpa.extra_id
    where bpa.is_selected = true
    limit 1
  ),
  'debug_removal_from_local_sql'
);
*/
