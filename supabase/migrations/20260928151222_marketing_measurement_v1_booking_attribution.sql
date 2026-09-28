-- Marketing Measurement V1
-- Additive only: existing bookings remain unchanged and keep NULL attribution.

alter table public.bookings
  add column if not exists marketing_first_touch jsonb,
  add column if not exists marketing_last_touch jsonb;

alter table public.bookings
  add constraint bookings_marketing_first_touch_shape_check
  check (
    marketing_first_touch is null
    or (
      jsonb_typeof(marketing_first_touch) = 'object'
      and octet_length(marketing_first_touch::text) <= 32768
      and marketing_first_touch - array[
        'captured_at', 'source_original', 'source_normalized',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'fbclid', 'gclid', 'fbp', 'fbc',
        'oppref', 'click_id', 'openai_click_ref',
        'chatgpt_campaign_id', 'chatgpt_ad_group_id', 'chatgpt_ad_account_id',
        'landing_path', 'referrer'
      ]::text[] = '{}'::jsonb
      and coalesce(marketing_first_touch->>'source_normalized', '') in (
        'chatgpt_paid', 'instagram', 'facebook', 'google', 'direct', 'other'
      )
    )
  ) not valid,
  add constraint bookings_marketing_last_touch_shape_check
  check (
    marketing_last_touch is null
    or (
      jsonb_typeof(marketing_last_touch) = 'object'
      and octet_length(marketing_last_touch::text) <= 32768
      and marketing_last_touch - array[
        'captured_at', 'source_original', 'source_normalized',
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
        'fbclid', 'gclid', 'fbp', 'fbc',
        'oppref', 'click_id', 'openai_click_ref',
        'chatgpt_campaign_id', 'chatgpt_ad_group_id', 'chatgpt_ad_account_id',
        'landing_path', 'referrer'
      ]::text[] = '{}'::jsonb
      and coalesce(marketing_last_touch->>'source_normalized', '') in (
        'chatgpt_paid', 'instagram', 'facebook', 'google', 'direct', 'other'
      )
    )
  ) not valid;

alter table public.bookings validate constraint bookings_marketing_first_touch_shape_check;
alter table public.bookings validate constraint bookings_marketing_last_touch_shape_check;

create index if not exists bookings_marketing_first_source_idx
  on public.bookings ((marketing_first_touch->>'source_normalized'))
  where marketing_first_touch is not null;

create index if not exists bookings_marketing_last_source_idx
  on public.bookings ((marketing_last_touch->>'source_normalized'))
  where marketing_last_touch is not null;

comment on column public.bookings.marketing_first_touch is
  'First valid non-PII marketing touch captured before booking creation.';
comment on column public.bookings.marketing_last_touch is
  'Last valid non-PII marketing touch captured before booking creation.';
