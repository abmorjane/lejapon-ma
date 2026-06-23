-- Retour complet après ajout de journée partenaire/sales + RPC de modification d'en-tête.
-- Les actions multi-tables restent côté SQL afin de respecter les RLS et de ne jamais exposer les coûts internes.

alter table public.fit_quotes
  add column if not exists booking_conditions text,
  add column if not exists payment_conditions text,
  add column if not exists cancellation_conditions text,
  add column if not exists client_notes text,
  add column if not exists quote_channel text default 'internal',
  add column if not exists partner_organization_id uuid,
  add column if not exists partner_branding_mode text,
  add column if not exists partner_contact_name text,
  add column if not exists production_status text default 'draft',
  add column if not exists japan_request_status text default 'not_started',
  add column if not exists payment_status text default 'not_authorized',
  add column if not exists booking_status text default 'not_started',
  add column if not exists requires_lejapon_approval boolean not null default false,
  add column if not exists approval_reason text,
  add column if not exists production_public_note text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create or replace function public.add_fit_template_day_to_quote(_quote_id uuid, _partner_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.fit_quotes%rowtype;
  template_row public.fit_partner_day_templates%rowtype;
  new_day_id uuid;
  created_day jsonb := '{}'::jsonb;
  created_components jsonb := '[]'::jsonb;
  all_days jsonb := '[]'::jsonb;
  all_components jsonb := '[]'::jsonb;
  next_sort integer := 0;
  next_day_number integer := 1;
  components_inserted integer := 0;
  template_allowed boolean := false;
  net_total numeric := 0;
  margin_type text := 'percent';
  margin_value numeric := 15;
  manual_adjustment numeric := 0;
  margin_total numeric := 0;
  client_total numeric := 0;
  per_person numeric := 0;
  pax integer := 1;
begin
  if actor_id is null then
    raise exception 'not authenticated';
  end if;

  select * into quote_row
  from public.fit_quotes
  where id = _quote_id
  for update;

  if not found then
    raise exception 'quote not found';
  end if;

  if not public.can_access_fit_quote(_quote_id, actor_id) then
    raise exception 'not allowed';
  end if;

  select * into template_row
  from public.fit_partner_day_templates
  where id = _partner_template_id
    and is_published = true;

  if not found then
    raise exception 'template not found or not published';
  end if;

  template_allowed :=
    public.can_view_fit_internal_costs(actor_id)
    or (
      quote_row.partner_organization_id is null
      and public.can_create_partner_fit_quotes(actor_id)
    )
    or (
      quote_row.partner_organization_id is not null
      and public.is_partner_org_member(quote_row.partner_organization_id, actor_id)
      and (
        coalesce(array_length(template_row.allowed_organization_ids, 1), 0) = 0
        or quote_row.partner_organization_id = any(template_row.allowed_organization_ids)
      )
    );

  if not template_allowed then
    raise exception 'template not allowed for this quote';
  end if;

  select coalesce(max(sort_order), -1) + 1,
         coalesce(max(day_number), 0) + 1
  into next_sort, next_day_number
  from public.fit_quote_days
  where quote_id = _quote_id;

  insert into public.fit_quote_days (
    quote_id,
    template_id,
    day_number,
    sort_order,
    title,
    city,
    description_client,
    client_summary,
    sales_summary,
    optimized_client_description,
    client_highlights,
    client_inclusions,
    client_options,
    visits,
    optional_visits,
    rhythm,
    day_pace,
    transport_modes,
    meal_plan,
    meals,
    selling_price_mad,
    cost_mad,
    cost_jpy,
    image_urls,
    metadata
  )
  values (
    _quote_id,
    template_row.source_template_id,
    next_day_number,
    next_sort,
    template_row.title,
    template_row.city,
    coalesce(template_row.optimized_client_description, template_row.description_client),
    template_row.sales_summary,
    template_row.sales_summary,
    coalesce(template_row.optimized_client_description, template_row.description_client),
    coalesce(template_row.client_highlights, '[]'::jsonb),
    coalesce(template_row.client_inclusions, '[]'::jsonb),
    coalesce(template_row.client_options, '[]'::jsonb),
    coalesce(template_row.client_highlights, '[]'::jsonb),
    coalesce(template_row.client_options, '[]'::jsonb),
    coalesce(template_row.day_pace, 'moderate'),
    coalesce(template_row.day_pace, 'moderate'),
    coalesce(template_row.transport_modes, '[]'::jsonb),
    coalesce(template_row.meal_plan, '[]'::jsonb),
    coalesce(template_row.meal_plan, '[]'::jsonb),
    coalesce(template_row.partner_net_price_mad, 0),
    0,
    0,
    coalesce(template_row.image_urls, '[]'::jsonb),
    jsonb_build_object(
      'partner_template_id', template_row.id,
      'partner_base_net_price_mad', coalesce(template_row.partner_net_price_mad, 0)
    )
  )
  returning id into new_day_id;

  if new_day_id is null then
    raise exception 'quote day was not created';
  end if;

  insert into public.fit_quote_day_components (
    quote_day_id,
    source_component_id,
    component_type,
    title,
    description_client,
    category,
    net_price_impact,
    is_required,
    can_partner_disable,
    enabled,
    partner_visible,
    affects_partner_net_price,
    client_text_when_enabled,
    client_text_when_disabled,
    metadata
  )
  select
    new_day_id,
    c.id,
    c.component_type,
    c.title,
    c.description_client,
    c.category,
    coalesce(c.net_price_impact, 0),
    coalesce(c.is_required, false),
    coalesce(c.can_partner_disable, false),
    true,
    coalesce(c.partner_visible, true),
    coalesce(c.affects_partner_net_price, true),
    c.client_text_when_enabled,
    c.client_text_when_disabled,
    coalesce(c.metadata, '{}'::jsonb)
  from public.fit_partner_day_template_components c
  where c.partner_template_id = _partner_template_id
    and coalesce(c.partner_visible, true) = true;

  get diagnostics components_inserted = row_count;

  select jsonb_build_object(
    'id', d.id,
    'quote_id', d.quote_id,
    'template_id', d.template_id,
    'day_number', d.day_number,
    'sort_order', d.sort_order,
    'date', d.date,
    'title', d.title,
    'city', d.city,
    'description_client', d.description_client,
    'client_summary', d.client_summary,
    'sales_summary', d.sales_summary,
    'optimized_client_description', d.optimized_client_description,
    'client_highlights', d.client_highlights,
    'client_inclusions', d.client_inclusions,
    'client_options', d.client_options,
    'visits', d.visits,
    'optional_visits', d.optional_visits,
    'rhythm', d.rhythm,
    'day_pace', d.day_pace,
    'transport_type', d.transport_type,
    'transport_modes', d.transport_modes,
    'meal_notes', d.meal_notes,
    'meals', d.meals,
    'meal_plan', d.meal_plan,
    'selling_price_mad', d.selling_price_mad,
    'image_urls', d.image_urls,
    'metadata', d.metadata,
    'created_at', d.created_at,
    'updated_at', d.updated_at
  ) into created_day
  from public.fit_quote_days d
  where d.id = new_day_id;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb)
  into created_components
  from public.fit_quote_day_components c
  where c.quote_day_id = new_day_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'quote_id', d.quote_id,
    'template_id', d.template_id,
    'day_number', d.day_number,
    'sort_order', d.sort_order,
    'date', d.date,
    'title', d.title,
    'city', d.city,
    'description_client', d.description_client,
    'client_summary', d.client_summary,
    'sales_summary', d.sales_summary,
    'optimized_client_description', d.optimized_client_description,
    'client_highlights', d.client_highlights,
    'client_inclusions', d.client_inclusions,
    'client_options', d.client_options,
    'visits', d.visits,
    'optional_visits', d.optional_visits,
    'rhythm', d.rhythm,
    'day_pace', d.day_pace,
    'transport_type', d.transport_type,
    'transport_modes', d.transport_modes,
    'meal_notes', d.meal_notes,
    'meals', d.meals,
    'meal_plan', d.meal_plan,
    'selling_price_mad', d.selling_price_mad,
    'image_urls', d.image_urls,
    'metadata', d.metadata,
    'created_at', d.created_at,
    'updated_at', d.updated_at
  ) order by d.day_number, d.sort_order, d.created_at), '[]'::jsonb)
  into all_days
  from public.fit_quote_days d
  where d.quote_id = _quote_id;

  select coalesce(jsonb_agg(to_jsonb(c) order by d.day_number, d.sort_order, c.created_at, c.id), '[]'::jsonb)
  into all_components
  from public.fit_quote_days d
  join public.fit_quote_day_components c on c.quote_day_id = d.id
  where d.quote_id = _quote_id;

  select coalesce(sum(day_net), 0)
  into net_total
  from (
    select
      d.id,
      case
        when exists (
          select 1
          from public.fit_quote_day_components c
          where c.quote_day_id = d.id
            and coalesce(c.partner_visible, true) = true
            and coalesce(c.affects_partner_net_price, true) = true
            and coalesce(c.net_price_impact, 0) > 0
        )
        then (
          select coalesce(sum(coalesce(c.net_price_impact, 0)), 0)
          from public.fit_quote_day_components c
          where c.quote_day_id = d.id
            and coalesce(c.partner_visible, true) = true
            and coalesce(c.affects_partner_net_price, true) = true
            and coalesce(c.enabled, true) = true
        )
        else coalesce(nullif(d.metadata ->> 'partner_base_net_price_mad', '')::numeric, d.selling_price_mad, 0)
      end as day_net
    from public.fit_quote_days d
    where d.quote_id = _quote_id
  ) priced_days;

  select
    coalesce(p.partner_margin_type, 'percent'),
    coalesce(p.partner_margin_value, 15),
    coalesce(p.manual_adjustment_mad, 0)
  into margin_type, margin_value, manual_adjustment
  from public.fit_quote_partner_pricing p
  where p.quote_id = _quote_id;

  if not found then
    margin_type := 'percent';
    margin_value := 15;
    manual_adjustment := 0;
  end if;

  margin_total := case
    when margin_type = 'fixed' then coalesce(margin_value, 0)
    else round(net_total * coalesce(margin_value, 0) / 100)
  end;
  client_total := greatest(0, round(net_total + margin_total + coalesce(manual_adjustment, 0)));
  pax := greatest(coalesce(quote_row.travelers_count, 1), 1);
  per_person := client_total / pax;

  insert into public.fit_quote_partner_pricing (
    quote_id,
    organization_id,
    net_partner_total,
    partner_margin_type,
    partner_margin_value,
    partner_margin_total,
    manual_adjustment_mad,
    client_sale_total,
    client_sale_per_person
  )
  values (
    _quote_id,
    quote_row.partner_organization_id,
    net_total,
    margin_type,
    margin_value,
    margin_total,
    manual_adjustment,
    client_total,
    per_person
  )
  on conflict (quote_id) do update
  set net_partner_total = excluded.net_partner_total,
      partner_margin_type = excluded.partner_margin_type,
      partner_margin_value = excluded.partner_margin_value,
      partner_margin_total = excluded.partner_margin_total,
      manual_adjustment_mad = excluded.manual_adjustment_mad,
      client_sale_total = excluded.client_sale_total,
      client_sale_per_person = excluded.client_sale_per_person,
      updated_at = now();

  update public.fit_quotes
  set total_selling_price_mad = client_total,
      price_per_person_mad = per_person,
      updated_at = now()
  where id = _quote_id
  returning * into quote_row;

  insert into public.quote_audit_logs (quote_id, organization_id, user_id, action_type, payload)
  values (
    _quote_id,
    quote_row.partner_organization_id,
    actor_id,
    'quote_day_added',
    jsonb_build_object('partner_template_id', _partner_template_id, 'quote_day_id', new_day_id, 'title', template_row.title)
  );

  return jsonb_build_object(
    'ok', true,
    'quote_id', _quote_id,
    'quote', jsonb_build_object(
      'id', quote_row.id,
      'quote_number', quote_row.quote_number,
      'client_name', quote_row.client_name,
      'travelers_count', quote_row.travelers_count,
      'travel_start_date', quote_row.travel_start_date,
      'travel_end_date', quote_row.travel_end_date,
      'hotel_category', quote_row.hotel_category,
      'room_type', quote_row.room_type,
      'currency', quote_row.currency,
      'language', quote_row.language,
      'status', quote_row.status,
      'production_status', quote_row.production_status,
      'japan_request_status', quote_row.japan_request_status,
      'payment_status', quote_row.payment_status,
      'booking_status', quote_row.booking_status,
      'total_selling_price_mad', quote_row.total_selling_price_mad,
      'price_per_person_mad', quote_row.price_per_person_mad,
      'payment_conditions', quote_row.payment_conditions,
      'cancellation_conditions', quote_row.cancellation_conditions,
      'booking_conditions', quote_row.booking_conditions,
      'inclusions', quote_row.inclusions,
      'exclusions', quote_row.exclusions,
      'valid_until', quote_row.valid_until,
      'client_notes', quote_row.client_notes,
      'share_token', quote_row.share_token,
      'share_enabled', quote_row.share_enabled,
      'quote_channel', quote_row.quote_channel,
      'partner_organization_id', quote_row.partner_organization_id,
      'partner_branding_mode', quote_row.partner_branding_mode,
      'partner_contact_name', quote_row.partner_contact_name,
      'requires_lejapon_approval', quote_row.requires_lejapon_approval,
      'approval_reason', quote_row.approval_reason,
      'production_public_note', quote_row.production_public_note,
      'owner_user_id', quote_row.owner_user_id,
      'created_by', quote_row.created_by,
      'deleted_at', quote_row.deleted_at,
      'deleted_by', quote_row.deleted_by,
      'created_at', quote_row.created_at,
      'updated_at', quote_row.updated_at
    ),
    'quote_day_id', new_day_id,
    'created_day', created_day,
    'created_components', created_components,
    'all_days', all_days,
    'all_components', all_components,
    'components_inserted', components_inserted,
    'pricing', jsonb_build_object(
      'net_partner_total', net_total,
      'partner_margin_type', margin_type,
      'partner_margin_value', margin_value,
      'partner_margin_total', margin_total,
      'manual_adjustment_mad', manual_adjustment,
      'client_sale_total', client_total,
      'client_sale_per_person', per_person
    ),
    'message', 'Journée ajoutée'
  );
end;
$$;

grant execute on function public.add_fit_template_day_to_quote(uuid, uuid) to authenticated;

create or replace function public.update_fit_partner_quote_header(_quote_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.fit_quotes%rowtype;
  updated_quote public.fit_quotes%rowtype;
  net_total numeric := 0;
  margin_type text := 'percent';
  margin_value numeric := 15;
  manual_adjustment numeric := 0;
  margin_total numeric := 0;
  client_total numeric := 0;
  per_person numeric := 0;
  pax integer := 1;
begin
  if actor_id is null then
    raise exception 'not authenticated';
  end if;

  select * into quote_row
  from public.fit_quotes
  where id = _quote_id
  for update;

  if not found then
    raise exception 'quote not found';
  end if;

  if not public.can_access_fit_quote(_quote_id, actor_id) then
    raise exception 'not allowed';
  end if;

  if _payload ?| array[
    'total_cost_mad',
    'margin_amount_mad',
    'margin_percent',
    'japan_agency_fee_rate',
    'lejapon_margin_rate',
    'internal_notes',
    'notes_internal',
    'cost_mad',
    'cost_jpy'
  ] then
    raise exception 'payload contains forbidden internal fields';
  end if;

  pax := greatest(coalesce(nullif(_payload ->> 'travelers_count', '')::integer, quote_row.travelers_count, 1), 1);
  margin_type := coalesce(nullif(_payload ->> 'partner_margin_type', ''), 'percent');
  if margin_type not in ('percent', 'fixed') then
    margin_type := 'percent';
  end if;
  margin_value := coalesce(nullif(_payload ->> 'partner_margin_value', '')::numeric, 15);
  manual_adjustment := coalesce(nullif(_payload ->> 'manual_adjustment_mad', '')::numeric, 0);

  select coalesce(sum(day_net), 0)
  into net_total
  from (
    select
      d.id,
      case
        when exists (
          select 1
          from public.fit_quote_day_components c
          where c.quote_day_id = d.id
            and coalesce(c.partner_visible, true) = true
            and coalesce(c.affects_partner_net_price, true) = true
            and coalesce(c.net_price_impact, 0) > 0
        )
        then (
          select coalesce(sum(coalesce(c.net_price_impact, 0)), 0)
          from public.fit_quote_day_components c
          where c.quote_day_id = d.id
            and coalesce(c.partner_visible, true) = true
            and coalesce(c.affects_partner_net_price, true) = true
            and coalesce(c.enabled, true) = true
        )
        else coalesce(nullif(d.metadata ->> 'partner_base_net_price_mad', '')::numeric, d.selling_price_mad, 0)
      end as day_net
    from public.fit_quote_days d
    where d.quote_id = _quote_id
  ) priced_days;

  margin_total := case
    when margin_type = 'fixed' then coalesce(margin_value, 0)
    else round(net_total * coalesce(margin_value, 0) / 100)
  end;
  client_total := greatest(0, round(net_total + margin_total + coalesce(manual_adjustment, 0)));
  per_person := client_total / pax;

  update public.fit_quotes
  set client_name = coalesce(nullif(_payload ->> 'client_name', ''), client_name),
      travelers_count = pax,
      travel_start_date = case when _payload ? 'travel_start_date' then nullif(_payload ->> 'travel_start_date', '')::date else travel_start_date end,
      travel_end_date = case when _payload ? 'travel_end_date' then nullif(_payload ->> 'travel_end_date', '')::date else travel_end_date end,
      valid_until = case when _payload ? 'valid_until' then nullif(_payload ->> 'valid_until', '')::date else valid_until end,
      hotel_category = case when _payload ? 'hotel_category' then nullif(_payload ->> 'hotel_category', '') else hotel_category end,
      room_type = case when _payload ? 'room_type' then nullif(_payload ->> 'room_type', '') else room_type end,
      exclusions = case when _payload ? 'exclusions' then coalesce(_payload ->> 'exclusions', '') else exclusions end,
      client_notes = case when _payload ? 'client_notes' then nullif(_payload ->> 'client_notes', '') else client_notes end,
      payment_conditions = case when _payload ? 'payment_conditions' then nullif(_payload ->> 'payment_conditions', '') else payment_conditions end,
      cancellation_conditions = case when _payload ? 'cancellation_conditions' then nullif(_payload ->> 'cancellation_conditions', '') else cancellation_conditions end,
      booking_conditions = case when _payload ? 'booking_conditions' then nullif(_payload ->> 'booking_conditions', '') else booking_conditions end,
      total_selling_price_mad = client_total,
      price_per_person_mad = per_person,
      updated_at = now()
  where id = _quote_id
  returning * into updated_quote;

  insert into public.fit_quote_partner_pricing (
    quote_id,
    organization_id,
    net_partner_total,
    partner_margin_type,
    partner_margin_value,
    partner_margin_total,
    manual_adjustment_mad,
    client_sale_total,
    client_sale_per_person
  )
  values (
    _quote_id,
    updated_quote.partner_organization_id,
    net_total,
    margin_type,
    margin_value,
    margin_total,
    manual_adjustment,
    client_total,
    per_person
  )
  on conflict (quote_id) do update
  set net_partner_total = excluded.net_partner_total,
      partner_margin_type = excluded.partner_margin_type,
      partner_margin_value = excluded.partner_margin_value,
      partner_margin_total = excluded.partner_margin_total,
      manual_adjustment_mad = excluded.manual_adjustment_mad,
      client_sale_total = excluded.client_sale_total,
      client_sale_per_person = excluded.client_sale_per_person,
      updated_at = now();

  insert into public.quote_audit_logs (quote_id, organization_id, user_id, action_type, payload)
  values (
    _quote_id,
    updated_quote.partner_organization_id,
    actor_id,
    'quote_header_updated',
    jsonb_build_object(
      'changed_fields', (
        select coalesce(jsonb_agg(key), '[]'::jsonb)
        from jsonb_each(_payload)
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'quote_id', _quote_id,
    'quote', jsonb_build_object(
      'id', updated_quote.id,
      'quote_number', updated_quote.quote_number,
      'client_name', updated_quote.client_name,
      'travelers_count', updated_quote.travelers_count,
      'travel_start_date', updated_quote.travel_start_date,
      'travel_end_date', updated_quote.travel_end_date,
      'hotel_category', updated_quote.hotel_category,
      'room_type', updated_quote.room_type,
      'currency', updated_quote.currency,
      'language', updated_quote.language,
      'status', updated_quote.status,
      'production_status', updated_quote.production_status,
      'japan_request_status', updated_quote.japan_request_status,
      'payment_status', updated_quote.payment_status,
      'booking_status', updated_quote.booking_status,
      'total_selling_price_mad', updated_quote.total_selling_price_mad,
      'price_per_person_mad', updated_quote.price_per_person_mad,
      'payment_conditions', updated_quote.payment_conditions,
      'cancellation_conditions', updated_quote.cancellation_conditions,
      'booking_conditions', updated_quote.booking_conditions,
      'inclusions', updated_quote.inclusions,
      'exclusions', updated_quote.exclusions,
      'valid_until', updated_quote.valid_until,
      'client_notes', updated_quote.client_notes,
      'share_token', updated_quote.share_token,
      'share_enabled', updated_quote.share_enabled,
      'quote_channel', updated_quote.quote_channel,
      'partner_organization_id', updated_quote.partner_organization_id,
      'partner_branding_mode', updated_quote.partner_branding_mode,
      'partner_contact_name', updated_quote.partner_contact_name,
      'requires_lejapon_approval', updated_quote.requires_lejapon_approval,
      'approval_reason', updated_quote.approval_reason,
      'production_public_note', updated_quote.production_public_note,
      'owner_user_id', updated_quote.owner_user_id,
      'created_by', updated_quote.created_by,
      'deleted_at', updated_quote.deleted_at,
      'deleted_by', updated_quote.deleted_by,
      'created_at', updated_quote.created_at,
      'updated_at', updated_quote.updated_at
    ),
    'pricing', jsonb_build_object(
      'net_partner_total', net_total,
      'partner_margin_type', margin_type,
      'partner_margin_value', margin_value,
      'partner_margin_total', margin_total,
      'manual_adjustment_mad', manual_adjustment,
      'client_sale_total', client_total,
      'client_sale_per_person', per_person
    ),
    'message', 'Devis mis à jour'
  );
end;
$$;

grant execute on function public.update_fit_partner_quote_header(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
