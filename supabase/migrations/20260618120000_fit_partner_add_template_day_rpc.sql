-- RPC sécurisée pour ajouter une journée template partenaire/sales à un Devis FIT.
-- Évite les inserts frontend directs bloqués par RLS sur fit_quote_days.

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
  where id = _quote_id;

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
    'quote_day_id', new_day_id,
    'components_inserted', components_inserted,
    'net_partner_total', net_total,
    'client_sale_total', client_total,
    'client_sale_per_person', per_person,
    'message', 'Journée ajoutée'
  );
end;
$$;

grant execute on function public.add_fit_template_day_to_quote(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
