-- Premium client-facing FIT quote experience.
-- Adds commercial presentation fields while keeping internal costs private.

alter table public.fit_day_templates
  add column if not exists client_summary text,
  add column if not exists client_highlights jsonb not null default '[]'::jsonb,
  add column if not exists client_inclusions jsonb not null default '[]'::jsonb,
  add column if not exists client_options jsonb not null default '[]'::jsonb,
  add column if not exists rhythm text,
  add column if not exists meals jsonb not null default '[]'::jsonb,
  add column if not exists transport_modes jsonb not null default '[]'::jsonb;

alter table public.fit_quote_days
  add column if not exists client_summary text,
  add column if not exists client_highlights jsonb not null default '[]'::jsonb,
  add column if not exists client_inclusions jsonb not null default '[]'::jsonb,
  add column if not exists client_options jsonb not null default '[]'::jsonb,
  add column if not exists rhythm text,
  add column if not exists meals jsonb not null default '[]'::jsonb,
  add column if not exists transport_modes jsonb not null default '[]'::jsonb;

alter table public.fit_quote_hotel_lines
  add column if not exists image_url text,
  add column if not exists category text,
  add column if not exists public_notes text;

alter table public.fit_quote_flight_lines
  add column if not exists status text not null default 'included',
  add column if not exists public_notes text;

alter table public.fit_quote_flight_lines
  drop constraint if exists fit_quote_flight_lines_status_check;

alter table public.fit_quote_flight_lines
  add constraint fit_quote_flight_lines_status_check
    check (status in ('included', 'optional', 'estimate'));

drop policy if exists "public read shared fit quote hotels" on public.fit_quote_hotel_lines;
create policy "public read shared fit quote hotels" on public.fit_quote_hotel_lines
for select using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_hotel_lines.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read shared fit quote flights" on public.fit_quote_flight_lines;
create policy "public read shared fit quote flights" on public.fit_quote_flight_lines
for select using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_flight_lines.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

grant select on public.fit_quote_hotel_lines, public.fit_quote_flight_lines to anon, authenticated;

revoke select on public.fit_quotes from anon;
revoke select on public.fit_quote_days from anon;
revoke select on public.fit_quote_day_cost_lines from anon;
revoke select on public.fit_quote_hotel_lines from anon;
revoke select on public.fit_quote_flight_lines from anon;

grant select (
  id, quote_number, client_name, travelers_count, travel_start_date, travel_end_date,
  hotel_category, room_type, currency, language, status, total_selling_price_mad,
  price_per_person_mad, payment_conditions, inclusions, exclusions, valid_until,
  client_notes, share_token, share_enabled
) on public.fit_quotes to anon;

grant select (
  id, quote_id, day_number, sort_order, date, title, city, description_client,
  client_summary, client_highlights, client_inclusions, client_options, visits,
  optional_visits, rhythm, transport_type, transport_modes, meal_notes, meals,
  selling_price_mad, image_urls
) on public.fit_quote_days to anon;

grant select (
  id, quote_id, day_id, sort_order, category, label, is_optional, is_client_visible
) on public.fit_quote_day_cost_lines to anon;

grant select (
  id, quote_id, sort_order, city, hotel_name, image_url, category, room_type,
  nights, public_notes
) on public.fit_quote_hotel_lines to anon;

grant select (
  id, quote_id, sort_order, route, airline, status, passengers_count, public_notes
) on public.fit_quote_flight_lines to anon;

notify pgrst, 'reload schema';
