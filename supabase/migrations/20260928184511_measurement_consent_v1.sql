-- CMP V1: additive booking-time technical consent snapshot, no historical backfill.
alter table public.bookings
  add column if not exists measurement_consent jsonb;

alter table public.bookings
  add constraint bookings_measurement_consent_shape_check
  check (
    measurement_consent is null
    or (
      jsonb_typeof(measurement_consent) = 'object'
      and octet_length(measurement_consent::text) <= 512
      and measurement_consent - array['version', 'analytics', 'marketing', 'captured_at']::text[] = '{}'::jsonb
      and measurement_consent->'version' = '1'::jsonb
      and jsonb_typeof(measurement_consent->'analytics') = 'boolean'
      and jsonb_typeof(measurement_consent->'marketing') = 'boolean'
      and jsonb_typeof(measurement_consent->'captured_at') = 'string'
      and length(measurement_consent->>'captured_at') <= 40
      and (measurement_consent->>'captured_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$'
    )
  ) not valid;

alter table public.bookings validate constraint bookings_measurement_consent_shape_check;

comment on column public.bookings.measurement_consent is
  'Non-PII technical CMP V1 choice captured at public booking submission; NULL on historical bookings.';
