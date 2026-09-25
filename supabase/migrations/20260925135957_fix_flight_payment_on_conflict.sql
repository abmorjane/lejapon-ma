-- Hotfix: preserve the multi-PNR flight reservation model when a payment is received.
--
-- booking_flight_reservations uses two partial unique indexes (empty active
-- reservation and active booking/PNR), so PostgreSQL cannot infer a plain
-- ON CONFLICT (booking_id) target. A targetless ON CONFLICT DO NOTHING lets
-- those current indexes arbitrate without reintroducing a one-flight-per-booking
-- constraint. This migration does not insert payments, reservations, or tasks.

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

  select * into v_booking
  from public.bookings
  where id = p_booking_id;

  if not found then
    return null;
  end if;

  insert into public.booking_flight_reservations(
    booking_id,
    status,
    created_by,
    updated_by,
    required_traveler_count
  ) values (
    p_booking_id,
    'not_booked',
    auth.uid(),
    auth.uid(),
    (
      select count(*)::integer
      from public.booking_participants
      where booking_id = p_booking_id
    )
  ) on conflict do nothing;

  return public.ensure_operation_task_v2(
    'reserve_flight',
    p_booking_id,
    'payment_received',
    p_event_at,
    p_booking_id,
    null,
    v_booking.trip_id,
    null,
    v_booking.client_id,
    jsonb_build_object(
      'source', 'payment_confirmation',
      'workflow', 'reserve_customer_flight',
      'booking_reference', v_booking.reference
    )
  );
end;
$$;

comment on function public.ensure_flight_reservation_task_v2(uuid,timestamptz) is
  'Idempotently ensures the empty active flight reservation and reserve-flight task after payment while preserving multi-PNR partial uniqueness.';
