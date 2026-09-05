-- Diagnostic only. Do not run as a migration.
-- Case: VOYAGE EN JUILLET 2026 / booking LJ-364889.

with target_booking as (
  select b.*
  from public.bookings b
  left join public.trips t on t.id = b.trip_id
  where b.reference = 'LJ-364889'
    and public.normalize_activity_match_text(t.title) like '%voyage en juillet 2026%'
)
select
  'booking' as section,
  b.id as booking_id,
  b.reference,
  b.trip_id,
  b.status,
  b.total_amount_mad,
  b.created_at,
  t.title as trip_title
from target_booking b
left join public.trips t on t.id = b.trip_id;

with target_booking as (
  select id from public.bookings where reference = 'LJ-364889'
)
select
  'participants' as section,
  bp.id as participant_id,
  bp.booking_id,
  concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')) as participant_name,
  bp.client_type,
  bp.created_at
from public.booking_participants bp
join target_booking b on b.id = bp.booking_id
order by bp.created_at, bp.last_name, bp.first_name;

with target_booking as (
  select id from public.bookings where reference = 'LJ-364889'
)
select
  'booking_extras' as section,
  be.id as booking_extra_id,
  be.booking_id,
  be.extra_id,
  be.name_snapshot,
  e.name as activity_name,
  be.activity_match_status,
  public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status) as trusted_activity_match,
  coalesce(be.qty, 0) as purchased_qty,
  coalesce(be.unit_price_mad, 0) as unit_price_mad,
  be.created_at
from public.booking_extras be
join target_booking b on b.id = be.booking_id
left join public.extras e on e.id = be.extra_id
order by be.created_at, be.id;

with target_booking as (
  select id from public.bookings where reference = 'LJ-364889'
),
assignment_rows as (
  select
    bpa.id as assignment_id,
    bpa.participant_id,
    concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')) as participant_name,
    bpa.booking_id,
    bpa.extra_id,
    e.name as activity_name,
    bpa.booking_extra_id,
    be.name_snapshot as linked_booking_extra_name,
    be.extra_id as linked_booking_extra_activity_id,
    linked_extra.name as linked_booking_extra_activity_name,
    bpa.source,
    bpa.is_selected,
    bpa.created_at,
    bpa.assigned_at,
    bpa.assigned_by,
    bpa.removed_at,
    bpa.removed_by,
    coalesce(purchased.qty, 0)::integer as purchased_qty,
    row_number() over (
      partition by bp.booking_id, bpa.extra_id
      order by coalesce(bpa.assigned_at, bpa.created_at), bpa.id
    ) as assignment_rank
  from public.booking_participant_activities bpa
  join public.booking_participants bp on bp.id = bpa.participant_id
  join target_booking b on b.id = bp.booking_id
  left join public.extras e on e.id = bpa.extra_id
  left join public.booking_extras be on be.id = bpa.booking_extra_id
  left join public.extras linked_extra on linked_extra.id = be.extra_id
  left join lateral (
    select coalesce(sum(be2.qty), 0)::integer as qty
    from public.booking_extras be2
    where be2.booking_id = bp.booking_id
      and be2.extra_id = bpa.extra_id
      and public.booking_extra_activity_match_is_trusted(be2.name_snapshot, e.name, be2.activity_match_status)
  ) purchased on true
)
select
  'assignments' as section,
  *,
  case
    when not is_selected then 'inactive'
    when booking_extra_id is not null and (
      linked_booking_extra_name is null
      or linked_booking_extra_activity_id is distinct from extra_id
    ) then 'wrong_extra_linked'
    when purchased_qty <= 0 then 'assignment_without_purchased_unit'
    when assignment_rank > purchased_qty then 'duplicate_or_over_capacity'
    else 'valid'
  end as diagnostic_status
from assignment_rows
order by participant_name, activity_name;

with target_booking as (
  select id from public.bookings where reference = 'LJ-364889'
),
summary as (
  select
    e.id as extra_id,
    e.name as activity_name,
    coalesce(sum(be.qty), 0)::integer as purchased_qty
  from public.extras e
  left join public.booking_extras be
    on be.extra_id = e.id
   and be.booking_id = (select id from target_booking)
   and public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status)
  where public.normalize_activity_match_text(e.name) ~ '(universal|teamlab|cérémonie|ceremonie|tea|geisha)'
  group by e.id, e.name
),
valid_assignments as (
  select
    bpa.extra_id,
    count(*)::integer as assigned_qty,
    string_agg(concat_ws(' ', nullif(bp.first_name, ''), nullif(bp.last_name, '')), ', ' order by bp.created_at) as assigned_participants
  from public.booking_participant_activities bpa
  join public.booking_participants bp on bp.id = bpa.participant_id
  join target_booking b on b.id = bp.booking_id
  join public.extras e on e.id = bpa.extra_id
  where bpa.is_selected = true
    and exists (
      select 1
      from public.booking_extras be
      where be.booking_id = bp.booking_id
        and be.extra_id = bpa.extra_id
        and public.booking_extra_activity_match_is_trusted(be.name_snapshot, e.name, be.activity_match_status)
    )
  group by bpa.extra_id
)
select
  'activity_summary' as section,
  s.extra_id,
  s.activity_name,
  s.purchased_qty,
  coalesce(v.assigned_qty, 0) as assigned_qty,
  greatest(0, s.purchased_qty - coalesce(v.assigned_qty, 0)) as available_qty,
  coalesce(v.assigned_participants, '') as assigned_participants
from summary s
left join valid_assignments v on v.extra_id = s.extra_id
order by s.activity_name;
