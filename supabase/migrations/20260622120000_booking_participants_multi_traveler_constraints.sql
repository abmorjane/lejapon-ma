-- Keep booking participants additive: one booking can have many travelers,
-- but the same CRM client must not be linked twice to the same booking.

with ranked_duplicate_clients as (
  select
    id,
    row_number() over (
      partition by booking_id, client_id
      order by is_lead desc, created_at asc, id asc
    ) as rn
  from public.booking_participants
  where client_id is not null
),
duplicate_participants as (
  select id from ranked_duplicate_clients where rn > 1
)
delete from public.booking_participants bp
using duplicate_participants dup
where bp.id = dup.id;

with ranked_leads as (
  select
    id,
    row_number() over (
      partition by booking_id
      order by is_lead desc, created_at asc, id asc
    ) as rn
  from public.booking_participants
  where is_lead = true
)
update public.booking_participants bp
set is_lead = false
from ranked_leads ranked
where bp.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists booking_participants_booking_client_unique
  on public.booking_participants (booking_id, client_id)
  where client_id is not null;

create unique index if not exists booking_participants_one_lead_per_booking
  on public.booking_participants (booking_id)
  where is_lead = true;

create index if not exists idx_booking_participants_booking_created
  on public.booking_participants (booking_id, created_at);
