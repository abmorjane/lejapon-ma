-- Local diagnostic only. Do not run as a migration.
-- Purpose: inspect the hotel group reference collision reported for LJ-AUG26-H01.

-- The user-requested check. This normally returns no row because
-- visa_hotel_group_ref_unique is created as a unique index, not a table constraint.
select
  conname,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where conname = 'visa_hotel_group_ref_unique';

-- Actual definition for the unique object created by the migration.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'visa_hotel_group_ref_unique',
    'visa_hotel_group_active_stay_unique'
  );

-- Existing row that blocks another insert of the same reference.
select
  g.id,
  g.trip_id,
  t.title as trip_title,
  t.slug as trip_slug,
  g.trip_hotel_id,
  th.name as hotel_name,
  g.check_in,
  g.check_out,
  g.group_reservation_reference,
  g.group_reservation_name,
  g.reservation_status,
  g.created_at,
  g.updated_at
from public.visa_hotel_group_reservations g
left join public.trips t on t.id = g.trip_id
left join public.trip_hotels th on th.id = g.trip_hotel_id
where g.group_reservation_reference = 'LJ-AUG26-H01';

-- Collision scan: should return no rows after the trip-scoped reference fix
-- for newly created group reservations.
select
  group_reservation_reference,
  count(*) as row_count,
  array_agg(trip_id order by created_at) as trip_ids,
  array_agg(trip_hotel_id order by created_at) as trip_hotel_ids
from public.visa_hotel_group_reservations
where reservation_status <> 'cancelled'
group by group_reservation_reference
having count(*) > 1
order by row_count desc, group_reservation_reference;
