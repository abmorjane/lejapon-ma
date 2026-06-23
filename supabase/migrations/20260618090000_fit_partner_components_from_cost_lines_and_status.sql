-- Les composantes partenaire/sales doivent provenir uniquement des lignes
-- tarifaires de la table coûts journée, jamais des champs texte client.

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
  effective_partner_net numeric;
  total_count integer := 0;
  found_count integer := 0;
  published_count integer := 0;
  updated_count integer := 0;
  archived_count integer := 0;
  ignored_count integer := 0;
  warnings jsonb := '[]'::jsonb;
begin
  if not public.can_view_fit_internal_costs(auth.uid()) then
    raise exception 'not allowed';
  end if;

  select count(*) into total_count from public.fit_day_templates;

  select count(*) into found_count
  from public.fit_day_templates
  where partner_publish_status = 'published';

  if found_count = 0 then
    warnings := warnings || jsonb_build_array(jsonb_build_object(
      'reason', 'aucune journée avec partner_publish_status = published',
      'hint', 'choisir Publication partenaire = Publié partenaire, vérifier les lignes Calcul, puis sauvegarder'
    ));
  end if;

  for template_row in
    select *
    from public.fit_day_templates
    where partner_publish_status = 'published'
    order by city nulls last, title
  loop
    issue_reason := null;

    select coalesce(sum(coalesce(l.subtotal_mad, 0)), 0)
    into effective_partner_net
    from public.fit_day_template_cost_lines l
    where l.template_id = template_row.id
      and l.included_in_calculation = true
      and coalesce(l.cost_role, case when l.category = 'agency_fee' then 'japan_agency_fee_auto' else 'supplier_cost' end) = 'supplier_cost'
      and l.category <> 'agency_fee'
      and nullif(trim(coalesce(l.label, l.metadata ->> 'contents', '')), '') is not null;

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
    elsif effective_partner_net <= 0 then
      issue_reason := 'aucune ligne de calcul tarifaire active';
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
        effective_partner_net,
        greatest(coalesce(template_row.pax_group_size, 1), 1),
        coalesce(template_row.partner_allowed_organization_ids, '{}'::uuid[]),
        true,
        jsonb_build_object('synced_from_admin_at', now(), 'partner_components_source', 'fit_day_template_cost_lines')
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
          partner_net_price_mad = effective_partner_net,
          min_travelers = greatest(coalesce(template_row.pax_group_size, 1), 1),
          allowed_organization_ids = coalesce(template_row.partner_allowed_organization_ids, '{}'::uuid[]),
          is_published = true,
          metadata = (coalesce(metadata, '{}'::jsonb) - 'not_publishable_reason')
            || jsonb_build_object('synced_from_admin_at', now(), 'partner_components_source', 'fit_day_template_cost_lines'),
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
      category,
      title,
      is_required,
      can_partner_disable,
      partner_visible,
      affects_partner_net_price,
      net_price_impact,
      client_text_when_enabled,
      client_text_when_disabled,
      metadata
    )
    select
      partner_id,
      min(item.sort_order),
      item.component_type,
      item.category,
      item.title,
      not item.can_disable,
      item.can_disable,
      true,
      true,
      sum(item.net_price_impact),
      case when bool_or(item.is_client_visible) then item.title else null end,
      item.title || ' non inclus',
      jsonb_build_object('source', 'fit_day_template_cost_lines')
    from (
      select
        l.sort_order,
        case
          when l.category = 'guide' then 'guide'
          when l.category = 'train' then 'train'
          when l.category in ('bus', 'transport', 'transfer', 'flight') then 'transport'
          when l.category = 'meal' then 'meal'
          when l.category = 'luggage' then 'luggage_transfer'
          when l.category = 'visit' then 'entry'
          when l.category = 'activities' then 'activity'
          else 'activity'
        end as component_type,
        l.category,
        trim(coalesce(nullif(l.label, ''), l.metadata ->> 'contents')) as title,
        coalesce(l.is_optional, false) as can_disable,
        coalesce(l.is_client_visible, false) as is_client_visible,
        coalesce(l.subtotal_mad, 0) as net_price_impact
      from public.fit_day_template_cost_lines l
      where l.template_id = template_row.id
        and l.included_in_calculation = true
        and coalesce(l.cost_role, case when l.category = 'agency_fee' then 'japan_agency_fee_auto' else 'supplier_cost' end) = 'supplier_cost'
        and l.category <> 'agency_fee'
        and nullif(trim(coalesce(l.label, l.metadata ->> 'contents', '')), '') is not null
    ) item
    group by item.component_type, item.category, item.title, item.can_disable;
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
    'total_templates', total_count,
    'found', found_count,
    'marked_partner', found_count,
    'published', published_count,
    'updated', updated_count,
    'archived', archived_count,
    'ignored', ignored_count,
    'warnings', warnings
  );
end;
$$;

grant execute on function public.sync_fit_partner_library() to authenticated;

alter table public.fit_quotes
  drop constraint if exists fit_quotes_status_check;

alter table public.fit_quotes
  add constraint fit_quotes_status_check check (status in (
    'draft',
    'sent',
    'accepted',
    'modification_requested',
    'client_modification_requested',
    'expired',
    'cancelled',
    'rejected',
    'converted_to_booking',
    'pending_partner_review',
    'pending_lejapon_approval',
    'approved',
    'sent_to_client',
    'client_preapproved',
    'pending_lejapon_review',
    'pending_japan_availability',
    'japan_request_sent',
    'japan_quote_received',
    'admin_approved_for_payment',
    'payment_authorized',
    'partner_payment_pending',
    'partner_payment_received',
    'booking_in_progress',
    'partially_confirmed',
    'confirmed'
  ));

notify pgrst, 'reload schema';
