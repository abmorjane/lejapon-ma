-- Make partner FIT library synchronization explicit and non-silent.
-- Templates marked partner but missing a net partner price are reported as ignored,
-- not counted as normal archives.

create or replace function public.sync_fit_partner_library()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  template_row record;
  partner_id uuid;
  issue_reason text;
  published_count integer := 0;
  updated_count integer := 0;
  archived_count integer := 0;
  ignored_count integer := 0;
  warnings jsonb := '[]'::jsonb;
begin
  if not public.can_view_fit_internal_costs(auth.uid()) then
    raise exception 'not allowed';
  end if;

  for template_row in
    select *
    from public.fit_day_templates
    where partner_publish_status = 'published'
    order by city nulls last, title
  loop
    issue_reason := null;

    if template_row.is_active = false then
      issue_reason := 'template inactif';
    elsif nullif(trim(coalesce(template_row.title, '')), '') is null then
      issue_reason := 'titre manquant';
    elsif nullif(trim(coalesce(
      template_row.sales_summary,
      template_row.client_summary,
      template_row.optimized_client_description,
      template_row.description_client,
      ''
    )), '') is null then
      issue_reason := 'description client manquante';
    elsif coalesce(template_row.partner_net_price_mad, 0) <= 0 then
      issue_reason := 'tarif net agence manquant';
    end if;

    if issue_reason is not null then
      ignored_count := ignored_count + 1;
      warnings := warnings || jsonb_build_array(jsonb_build_object(
        'template_id', template_row.id,
        'title', template_row.title,
        'reason', issue_reason
      ));

      update public.fit_partner_day_templates p
      set is_published = false,
          updated_at = now(),
          metadata = coalesce(p.metadata, '{}'::jsonb)
            || jsonb_build_object('not_publishable_reason', issue_reason, 'not_publishable_at', now())
      where p.source_template_id = template_row.id;

      continue;
    end if;

    select id into partner_id
    from public.fit_partner_day_templates
    where source_template_id = template_row.id;

    if partner_id is null then
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
      values (
        template_row.id,
        template_row.title,
        template_row.city,
        template_row.theme,
        coalesce(template_row.day_pace, template_row.rhythm),
        coalesce(template_row.sales_summary, template_row.client_summary),
        template_row.description_client,
        coalesce(template_row.optimized_client_description, template_row.description_client),
        coalesce(template_row.client_highlights, '[]'::jsonb),
        case
          when jsonb_array_length(coalesce(template_row.client_inclusions, '[]'::jsonb)) > 0 then template_row.client_inclusions
          else coalesce(template_row.included_visits, '[]'::jsonb)
        end,
        case
          when jsonb_array_length(coalesce(template_row.client_options, '[]'::jsonb)) > 0 then template_row.client_options
          else coalesce(template_row.optional_visits, '[]'::jsonb)
        end,
        coalesce(template_row.transport_modes, '[]'::jsonb),
        case
          when jsonb_array_length(coalesce(template_row.meal_plan, '[]'::jsonb)) > 0 then template_row.meal_plan
          else coalesce(template_row.meals, '[]'::jsonb)
        end,
        coalesce(template_row.image_urls, '[]'::jsonb),
        template_row.partner_net_price_mad,
        greatest(coalesce(template_row.pax_group_size, 1), 1),
        coalesce(template_row.partner_allowed_organization_ids, '{}'::uuid[]),
        true,
        jsonb_build_object('synced_from_admin_at', now())
      )
      returning id into partner_id;

      published_count := published_count + 1;
    else
      update public.fit_partner_day_templates
      set title = template_row.title,
          city = template_row.city,
          theme = template_row.theme,
          day_pace = coalesce(template_row.day_pace, template_row.rhythm),
          sales_summary = coalesce(template_row.sales_summary, template_row.client_summary),
          description_client = template_row.description_client,
          optimized_client_description = coalesce(template_row.optimized_client_description, template_row.description_client),
          client_highlights = coalesce(template_row.client_highlights, '[]'::jsonb),
          client_inclusions = case
            when jsonb_array_length(coalesce(template_row.client_inclusions, '[]'::jsonb)) > 0 then template_row.client_inclusions
            else coalesce(template_row.included_visits, '[]'::jsonb)
          end,
          client_options = case
            when jsonb_array_length(coalesce(template_row.client_options, '[]'::jsonb)) > 0 then template_row.client_options
            else coalesce(template_row.optional_visits, '[]'::jsonb)
          end,
          transport_modes = coalesce(template_row.transport_modes, '[]'::jsonb),
          meal_plan = case
            when jsonb_array_length(coalesce(template_row.meal_plan, '[]'::jsonb)) > 0 then template_row.meal_plan
            else coalesce(template_row.meals, '[]'::jsonb)
          end,
          image_urls = coalesce(template_row.image_urls, '[]'::jsonb),
          partner_net_price_mad = template_row.partner_net_price_mad,
          min_travelers = greatest(coalesce(template_row.pax_group_size, 1), 1),
          allowed_organization_ids = coalesce(template_row.partner_allowed_organization_ids, '{}'::uuid[]),
          is_published = true,
          metadata = (coalesce(metadata, '{}'::jsonb) - 'not_publishable_reason')
            || jsonb_build_object('synced_from_admin_at', now()),
          updated_at = now()
      where id = partner_id;

      updated_count := updated_count + 1;
    end if;

    delete from public.fit_partner_day_template_components
    where partner_template_id = partner_id;

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
    select partner_id, item.sort_order, item.component_type, item.title, true, false, 0, item.title
    from (
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
          when jsonb_array_length(coalesce(template_row.client_inclusions, '[]'::jsonb)) > 0 then template_row.client_inclusions
          else coalesce(template_row.included_visits, '[]'::jsonb)
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
      from jsonb_array_elements_text(coalesce(template_row.transport_modes, '[]'::jsonb)) with ordinality
      where nullif(trim(value), '') is not null

      union all

      select 70 + ordinality::integer, 'meal', value
      from jsonb_array_elements_text(
        case
          when jsonb_array_length(coalesce(template_row.meal_plan, '[]'::jsonb)) > 0 then template_row.meal_plan
          else coalesce(template_row.meals, '[]'::jsonb)
        end
      ) with ordinality
      where nullif(trim(value), '') is not null

      union all

      select 100 + ordinality::integer, 'option', value
      from jsonb_array_elements_text(
        case
          when jsonb_array_length(coalesce(template_row.client_options, '[]'::jsonb)) > 0 then template_row.client_options
          else coalesce(template_row.optional_visits, '[]'::jsonb)
        end
      ) with ordinality
      where nullif(trim(value), '') is not null
    ) item;
  end loop;

  update public.fit_partner_day_templates p
  set is_published = false,
      updated_at = now(),
      metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('archived_by_sync_at', now(), 'archive_reason', 'template non publié partenaire')
  where p.source_template_id is not null
    and p.is_published = true
    and (
      not exists (
        select 1 from public.fit_day_templates t
        where t.id = p.source_template_id
      )
      or exists (
        select 1 from public.fit_day_templates t
        where t.id = p.source_template_id
          and t.partner_publish_status <> 'published'
      )
    );

  get diagnostics archived_count = row_count;

  return jsonb_build_object(
    'published', published_count,
    'updated', updated_count,
    'archived', archived_count,
    'ignored', ignored_count,
    'warnings', warnings
  );
end;
$$;

grant execute on function public.sync_fit_partner_library() to authenticated;

notify pgrst, 'reload schema';
