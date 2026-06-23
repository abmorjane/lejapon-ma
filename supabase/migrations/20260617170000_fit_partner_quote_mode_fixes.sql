-- Partner FIT quote mode fixes.
-- Keep commercial roles on the partner/sales workflow and reserve internal FIT costs
-- to LeJapon.ma admins only.

create or replace function public.can_view_fit_internal_costs(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in ('super_admin', 'admin')
  );
$$;

create or replace function public.can_create_partner_fit_quotes(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in (
        'super_admin',
        'admin',
        'manager',
        'sales',
        'sales_user',
        'sales_manager',
        'partner_agency_admin',
        'partner_agent'
      )
  )
  or exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.user_id = _user_id
      and om.status = 'active'
      and o.type = 'agency'
      and o.status = 'active'
  );
$$;

create or replace function public.is_fit_internal_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_fit_internal_costs(_user_id);
$$;

create or replace function public.sync_fit_partner_library()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  synced_count integer := 0;
  archived_count integer := 0;
begin
  if not public.can_view_fit_internal_costs(auth.uid()) then
    raise exception 'not allowed';
  end if;

  insert into public.fit_partner_day_templates (
    source_template_id,
    title,
    city,
    theme,
    day_pace,
    sales_summary,
    description_client,
    optimized_client_description,
    client_highlights,
    client_inclusions,
    client_options,
    transport_modes,
    meal_plan,
    image_urls,
    partner_net_price_mad,
    min_travelers,
    allowed_organization_ids,
    is_published,
    metadata
  )
  select
    t.id,
    t.title,
    t.city,
    t.theme,
    coalesce(t.day_pace, t.rhythm),
    coalesce(t.sales_summary, t.client_summary),
    t.description_client,
    coalesce(t.optimized_client_description, t.description_client),
    coalesce(t.client_highlights, '[]'::jsonb),
    case
      when jsonb_array_length(coalesce(t.client_inclusions, '[]'::jsonb)) > 0 then t.client_inclusions
      else coalesce(t.included_visits, '[]'::jsonb)
    end,
    case
      when jsonb_array_length(coalesce(t.client_options, '[]'::jsonb)) > 0 then t.client_options
      else coalesce(t.optional_visits, '[]'::jsonb)
    end,
    coalesce(t.transport_modes, '[]'::jsonb),
    case
      when jsonb_array_length(coalesce(t.meal_plan, '[]'::jsonb)) > 0 then t.meal_plan
      else coalesce(t.meals, '[]'::jsonb)
    end,
    coalesce(t.image_urls, '[]'::jsonb),
    t.partner_net_price_mad,
    greatest(coalesce(t.pax_group_size, 1), 1),
    coalesce(t.partner_allowed_organization_ids, '{}'::uuid[]),
    true,
    jsonb_build_object('synced_from_admin_at', now())
  from public.fit_day_templates t
  where t.partner_publish_status = 'published'
    and t.is_active = true
    and t.partner_net_price_mad > 0
  on conflict (source_template_id) do update set
    title = excluded.title,
    city = excluded.city,
    theme = excluded.theme,
    day_pace = excluded.day_pace,
    sales_summary = excluded.sales_summary,
    description_client = excluded.description_client,
    optimized_client_description = excluded.optimized_client_description,
    client_highlights = excluded.client_highlights,
    client_inclusions = excluded.client_inclusions,
    client_options = excluded.client_options,
    transport_modes = excluded.transport_modes,
    meal_plan = excluded.meal_plan,
    image_urls = excluded.image_urls,
    partner_net_price_mad = excluded.partner_net_price_mad,
    min_travelers = excluded.min_travelers,
    allowed_organization_ids = excluded.allowed_organization_ids,
    is_published = true,
    metadata = coalesce(public.fit_partner_day_templates.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

  get diagnostics synced_count = row_count;

  delete from public.fit_partner_day_template_components c
  using public.fit_partner_day_templates p
  join public.fit_day_templates t on t.id = p.source_template_id
  where c.partner_template_id = p.id
    and t.partner_publish_status = 'published'
    and t.is_active = true
    and t.partner_net_price_mad > 0;

  insert into public.fit_partner_day_template_components (
    partner_template_id,
    sort_order,
    component_type,
    title,
    partner_visible,
    affects_partner_net_price,
    net_price_impact,
    client_text_when_enabled
  )
  select p.id, item.sort_order, item.component_type, item.title, true, false, 0, item.title
  from public.fit_partner_day_templates p
  join public.fit_day_templates t on t.id = p.source_template_id
  cross join lateral (
    select 10 + ordinality::integer as sort_order,
      case
        when value ~* 'guide' then 'guide'
        when value ~* 'shinkansen' then 'shinkansen'
        when value ~* 'train' then 'train'
        when value ~* 'repas|déjeuner|dîner|diner|petit-déjeuner' then 'meal'
        when value ~* 'transfert|bus|métro|metro|taxi' then 'transport'
        else 'activity'
      end as component_type,
      value as title
    from jsonb_array_elements_text(
      case
        when jsonb_array_length(coalesce(t.client_inclusions, '[]'::jsonb)) > 0 then t.client_inclusions
        else coalesce(t.included_visits, '[]'::jsonb)
      end
    ) with ordinality
    where nullif(trim(value), '') is not null

    union all

    select 40 + ordinality::integer,
      case
        when value ~* 'shinkansen' then 'shinkansen'
        when value ~* 'train' then 'train'
        else 'transport'
      end,
      value
    from jsonb_array_elements_text(coalesce(t.transport_modes, '[]'::jsonb)) with ordinality
    where nullif(trim(value), '') is not null

    union all

    select 70 + ordinality::integer, 'meal', value
    from jsonb_array_elements_text(
      case
        when jsonb_array_length(coalesce(t.meal_plan, '[]'::jsonb)) > 0 then t.meal_plan
        else coalesce(t.meals, '[]'::jsonb)
      end
    ) with ordinality
    where nullif(trim(value), '') is not null

    union all

    select 100 + ordinality::integer, 'option', value
    from jsonb_array_elements_text(
      case
        when jsonb_array_length(coalesce(t.client_options, '[]'::jsonb)) > 0 then t.client_options
        else coalesce(t.optional_visits, '[]'::jsonb)
      end
    ) with ordinality
    where nullif(trim(value), '') is not null
  ) item
  where t.partner_publish_status = 'published'
    and t.is_active = true
    and t.partner_net_price_mad > 0;

  update public.fit_partner_day_templates p
  set is_published = false,
      updated_at = now(),
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('archived_by_sync_at', now())
  where p.source_template_id is not null
    and exists (
      select 1
      from public.fit_day_templates t
      where t.id = p.source_template_id
        and (
          t.partner_publish_status <> 'published'
          or t.is_active = false
          or t.partner_net_price_mad <= 0
        )
    );

  get diagnostics archived_count = row_count;

  return jsonb_build_object('synced', synced_count, 'archived', archived_count);
end;
$$;

grant execute on function public.sync_fit_partner_library() to authenticated;

drop policy if exists "staff manage fit day templates" on public.fit_day_templates;
create policy "staff manage fit day templates" on public.fit_day_templates
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit day template cost lines" on public.fit_day_template_cost_lines;
create policy "staff manage fit day template cost lines" on public.fit_day_template_cost_lines
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit quotes" on public.fit_quotes;
create policy "staff manage fit quotes" on public.fit_quotes
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit quote days" on public.fit_quote_days;
create policy "staff manage fit quote days" on public.fit_quote_days
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit quote cost lines" on public.fit_quote_cost_lines;
create policy "staff manage fit quote cost lines" on public.fit_quote_cost_lines
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit quote day cost lines" on public.fit_quote_day_cost_lines;
create policy "staff manage fit quote day cost lines" on public.fit_quote_day_cost_lines
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit quote hotel lines" on public.fit_quote_hotel_lines;
create policy "staff manage fit quote hotel lines" on public.fit_quote_hotel_lines
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit quote flight lines" on public.fit_quote_flight_lines;
create policy "staff manage fit quote flight lines" on public.fit_quote_flight_lines
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "staff manage fit quote documents" on public.fit_quote_documents;
create policy "staff manage fit quote documents" on public.fit_quote_documents
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "public read shared fit quotes" on public.fit_quotes;
create policy "public read shared fit quotes" on public.fit_quotes
for select to anon using (share_enabled = true and share_token is not null);

drop policy if exists "public update shared fit quote response" on public.fit_quotes;
create policy "public update shared fit quote response" on public.fit_quotes
for update to anon using (share_enabled = true and share_token is not null)
with check (share_enabled = true and share_token is not null);

drop policy if exists "public read shared fit quote days" on public.fit_quote_days;
create policy "public read shared fit quote days" on public.fit_quote_days
for select to anon using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_days.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read visible shared fit quote day lines" on public.fit_quote_day_cost_lines;
create policy "public read visible shared fit quote day lines" on public.fit_quote_day_cost_lines
for select to anon using (
  is_client_visible = true
  and exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_day_cost_lines.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read shared fit quote hotels" on public.fit_quote_hotel_lines;
create policy "public read shared fit quote hotels" on public.fit_quote_hotel_lines
for select to anon using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_hotel_lines.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read shared fit quote flights" on public.fit_quote_flight_lines;
create policy "public read shared fit quote flights" on public.fit_quote_flight_lines
for select to anon using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_flight_lines.quote_id
      and q.share_enabled = true
      and q.share_token is not null
  )
);

notify pgrst, 'reload schema';
