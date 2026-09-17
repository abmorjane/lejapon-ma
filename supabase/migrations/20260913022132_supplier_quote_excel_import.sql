-- Atomic import of a parsed historical Tapis Volant / LeJapon.ma workbook.
-- The browser parser sends first-sheet source values only. This function owns
-- authorization, immutable version creation, line calculations and traceability.

create or replace function public.import_supplier_quote_excel_v1(
  p_quote_id uuid,
  p_trip_id uuid,
  p_supplier_id uuid,
  p_mode text,
  p_file_name text,
  p_sheet_name text,
  p_rows jsonb default '{}'::jsonb,
  p_participant_count integer default null,
  p_import_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := (select auth.uid());
  source_quote public.supplier_trip_quotes%rowtype;
  target_quote public.supplier_trip_quotes%rowtype;
  item jsonb;
  next_version integer;
  line_count integer := 0;
  existing_line_count integer := 0;
  handling_line_count integer := 0;
  handling_payload_total numeric := 0;
  handling_metadata_amount numeric;
  ambiguity_resolutions jsonb;
  all_payload_rows jsonb;
  resolution_item jsonb;
  resolved_payload_item jsonb;
  resolution_name text;
  resolution_section text;
  resolution_source_row integer;
  resolution_calculated_subtotal numeric;
  resolution_payload_subtotal numeric;
  resolution_match_count integer;
  resolved_payload_count integer;
  expected_resolved_payload_count integer;
  sort_index integer;
  numeric_quantity numeric;
  numeric_multiplier numeric;
  numeric_price numeric;
  calculated_subtotal numeric;
  source_comment text;
  source_row text;
begin
  if actor is null
     or p_supplier_id not in (select public.user_supplier_ids(actor))
     or not public.supplier_can_edit_trip(actor, p_trip_id)
     or not exists (
       select 1 from public.trip_suppliers ts
       where ts.trip_id = p_trip_id
         and ts.supplier_id = p_supplier_id
         and ts.status <> 'cancelled'
     ) then
    raise exception 'supplier quote import access denied' using errcode = '42501';
  end if;

  if p_mode not in ('direct', 'new_version') then
    raise exception 'invalid supplier quote import mode' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_file_name, '')), '') is null
     or lower(p_file_name) not like '%.xlsx' then
    raise exception 'an .xlsx file name is required' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_sheet_name, '')), '') is null then
    raise exception 'first worksheet name is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_import_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid supplier quote import payload' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_rows->'hotels', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_rows->'transport', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_rows->'activities', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_rows->'guides', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_rows->'other', '[]'::jsonb)) <> 'array' then
    raise exception 'supplier quote import sections must be arrays' using errcode = '22023';
  end if;

  ambiguity_resolutions := coalesce(p_import_metadata->'ambiguity_resolutions', '[]'::jsonb);
  if jsonb_typeof(ambiguity_resolutions) <> 'array' then
    raise exception 'ambiguity resolutions must be an array' using errcode = '22023';
  end if;
  all_payload_rows := coalesce(p_rows->'hotels', '[]'::jsonb)
    || coalesce(p_rows->'transport', '[]'::jsonb)
    || coalesce(p_rows->'activities', '[]'::jsonb)
    || coalesce(p_rows->'guides', '[]'::jsonb)
    || coalesce(p_rows->'other', '[]'::jsonb);

  line_count := jsonb_array_length(coalesce(p_rows->'hotels', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_rows->'transport', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_rows->'activities', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_rows->'guides', '[]'::jsonb))
    + jsonb_array_length(coalesce(p_rows->'other', '[]'::jsonb));
  if line_count < 1 or line_count > 1000 then
    raise exception 'supplier quote import must contain between 1 and 1000 lines' using errcode = '22023';
  end if;
  if p_participant_count is not null and (p_participant_count < 0 or p_participant_count > 100000) then
    raise exception 'invalid participant count' using errcode = '22023';
  end if;

  -- Tapis Volant handling is a supplier cost, while commission_percentage is
  -- the staff-only agency/office commission. Validate that the client did not
  -- silently drop or duplicate a detected handling line; never mutate the
  -- quote commission as part of this import.
  handling_metadata_amount := nullif(p_import_metadata->'financial_summary'->>'supplierHandlingJpy', '')::numeric;
  if handling_metadata_amount is not null and handling_metadata_amount > 0 then
    select count(*), coalesce(sum(
      greatest(0, coalesce(nullif(source.value->>'quantity', '')::numeric, 0))
      * greatest(0, coalesce(nullif(source.value->>'unit_price_jpy', '')::numeric, 0))
    ), 0)
    into handling_line_count, handling_payload_total
    from jsonb_array_elements(coalesce(p_rows->'other', '[]'::jsonb)) as source(value)
    where source.value->>'source_excel_kind' = 'supplier_handling';

    if handling_line_count <> 1 then
      raise exception 'detected supplier handling must be imported exactly once' using errcode = '22023';
    end if;
    if abs(handling_payload_total - handling_metadata_amount) > 1 then
      raise exception 'supplier handling amount does not match preview metadata' using errcode = '22023';
    end if;
  end if;

  -- Every line flagged by the preview as ambiguous must carry one explicit,
  -- server-verifiable resolution. Ignored rows must be absent from p_rows;
  -- included/non-charged rows must match their selected financial impact.
  if exists (
    select 1 from jsonb_array_elements(ambiguity_resolutions) as decision(value)
    where coalesce(value->>'resolution', '') not in ('include_recalculated', 'import_uncharged', 'ignore')
       or coalesce(value->>'section', '') not in ('hotels', 'transport', 'activities', 'guides', 'other')
       or nullif(value->>'source_row', '') is null
       or greatest(0, coalesce(nullif(value->>'calculated_subtotal_jpy', '')::numeric, 0)) <= 0
  ) then
    raise exception 'invalid ambiguous-row resolution metadata' using errcode = '22023';
  end if;
  if (
    select count(*) from jsonb_array_elements(ambiguity_resolutions)
  ) <> (
    select count(distinct value->>'source_row') from jsonb_array_elements(ambiguity_resolutions) as decision(value)
  ) then
    raise exception 'duplicate ambiguous-row resolution metadata' using errcode = '22023';
  end if;

  select count(*) into resolved_payload_count
  from jsonb_array_elements(all_payload_rows) as payload(value)
  where coalesce(nullif(value->>'source_excel_ambiguous', '')::boolean, false);
  select count(*) into expected_resolved_payload_count
  from jsonb_array_elements(ambiguity_resolutions) as decision(value)
  where value->>'resolution' in ('include_recalculated', 'import_uncharged');
  if resolved_payload_count <> expected_resolved_payload_count then
    raise exception 'ambiguous-row payload count does not match selected resolutions' using errcode = '22023';
  end if;

  for resolution_item in select value from jsonb_array_elements(ambiguity_resolutions) loop
    resolution_name := resolution_item->>'resolution';
    resolution_section := resolution_item->>'section';
    resolution_source_row := (resolution_item->>'source_row')::integer;
    resolution_calculated_subtotal := greatest(0, (resolution_item->>'calculated_subtotal_jpy')::numeric);
    resolved_payload_item := null;

    select count(*) into resolution_match_count
    from jsonb_array_elements(all_payload_rows) as payload(value)
    where coalesce(nullif(value->>'source_excel_ambiguous', '')::boolean, false)
      and (value->>'source_excel_row')::integer = resolution_source_row;
    select value into resolved_payload_item
    from jsonb_array_elements(all_payload_rows) as payload(value)
    where coalesce(nullif(value->>'source_excel_ambiguous', '')::boolean, false)
      and (value->>'source_excel_row')::integer = resolution_source_row
    limit 1;

    if resolution_name = 'ignore' then
      if resolution_match_count <> 0 then
        raise exception 'ignored ambiguous row must not be present in import payload' using errcode = '22023';
      end if;
      continue;
    end if;
    if resolution_match_count <> 1
       or resolved_payload_item->>'source_excel_resolution' <> resolution_name
       or resolved_payload_item->>'source_excel_section' <> resolution_section then
      raise exception 'ambiguous-row payload does not match selected resolution' using errcode = '22023';
    end if;

    resolution_payload_subtotal := case resolution_section
      when 'hotels' then
        greatest(0, coalesce(nullif(resolved_payload_item->>'person_count', '')::numeric, nullif(resolved_payload_item->>'rooms_count', '')::numeric, nullif(resolved_payload_item->>'room_count', '')::numeric, 0))
        * greatest(0, coalesce(nullif(resolved_payload_item->>'nights', '')::numeric, 0))
        * greatest(0, coalesce(nullif(resolved_payload_item->>'price_per_person_per_night_jpy', '')::numeric, nullif(resolved_payload_item->>'unit_price_jpy', '')::numeric, nullif(resolved_payload_item->>'price_per_room_per_night_jpy', '')::numeric, 0))
      when 'guides' then
        greatest(0, coalesce(nullif(resolved_payload_item->>'guides_count', '')::numeric, nullif(resolved_payload_item->>'guide_count', '')::numeric, 0))
        * greatest(0, coalesce(nullif(resolved_payload_item->>'daily_price_jpy', '')::numeric, 0))
      when 'activities' then
        greatest(0, coalesce(nullif(resolved_payload_item->>'participant_count', '')::numeric, nullif(resolved_payload_item->>'quantity', '')::numeric, 0))
        * greatest(0, coalesce(nullif(resolved_payload_item->>'unit_price_jpy', '')::numeric, 0))
      else
        greatest(0, coalesce(nullif(resolved_payload_item->>'quantity', '')::numeric, 0))
        * greatest(0, coalesce(nullif(resolved_payload_item->>'unit_price_jpy', '')::numeric, 0))
    end;

    if resolution_name = 'include_recalculated'
       and abs(resolution_payload_subtotal - resolution_calculated_subtotal) > 1 then
      raise exception 'included ambiguous row does not match Travel OS calculation' using errcode = '22023';
    end if;
    if resolution_name = 'import_uncharged' and abs(resolution_payload_subtotal) > 1 then
      raise exception 'non-charged ambiguous row must have zero financial impact' using errcode = '22023';
    end if;
  end loop;

  if p_quote_id is null then
    if p_mode <> 'direct' then
      raise exception 'a source quote is required for a new version' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.supplier_trip_quotes
      where trip_id = p_trip_id and supplier_id = p_supplier_id
    ) then
      raise exception 'select the existing quote before importing' using errcode = '55000';
    end if;
    insert into public.supplier_trip_quotes(
      trip_id, supplier_id, status, version_number, participant_count,
      validation_status, created_by, updated_by
    ) values (
      p_trip_id, p_supplier_id, 'draft', 1, greatest(0, coalesce(p_participant_count, 0)),
      'in_progress', actor, actor
    ) returning * into target_quote;
  else
    select * into source_quote
    from public.supplier_trip_quotes
    where id = p_quote_id and trip_id = p_trip_id and supplier_id = p_supplier_id
    for update;
    if not found then
      raise exception 'supplier quote not found' using errcode = 'P0002';
    end if;

    select
      (select count(*) from public.supplier_quote_hotel_rows where quote_id = source_quote.id)
      + (select count(*) from public.supplier_quote_transport_rows where quote_id = source_quote.id)
      + (select count(*) from public.supplier_quote_activity_rows where quote_id = source_quote.id)
      + (select count(*) from public.supplier_quote_guide_rows where quote_id = source_quote.id)
      + (select count(*) from public.supplier_quote_other_rows where quote_id = source_quote.id)
    into existing_line_count;

    if p_mode = 'direct' then
      if source_quote.status not in ('draft', 'revision_requested') then
        raise exception 'submitted supplier quote is immutable; create a new version' using errcode = '55000';
      end if;
      if existing_line_count > 0 then
        raise exception 'non-empty supplier quote requires a new version' using errcode = '55000';
      end if;
      target_quote := source_quote;
    else
      if exists (
        select 1
        from public.supplier_trip_quotes q
        where q.trip_id = source_quote.trip_id
          and q.supplier_id = source_quote.supplier_id
          and q.id <> source_quote.id
          and q.status in ('draft', 'revision_requested')
      ) then
        raise exception 'an editable supplier quote version already exists' using errcode = '55000';
      end if;

      select coalesce(max(version_number), 0) + 1 into next_version
      from public.supplier_trip_quotes
      where trip_id = source_quote.trip_id and supplier_id = source_quote.supplier_id;

      insert into public.supplier_trip_quotes(
        trip_id, supplier_id, status, version_number, parent_quote_id,
        participant_count, commission_percentage, exchange_rate_jpy_mad,
        supplier_notes, internal_notes, validation_status, validation_snapshot,
        validation_metadata, validation_completion_percentage, created_by, updated_by
      ) values (
        source_quote.trip_id, source_quote.supplier_id, 'draft', next_version, source_quote.id,
        greatest(0, coalesce(p_participant_count, source_quote.participant_count)),
        source_quote.commission_percentage, source_quote.exchange_rate_jpy_mad,
        source_quote.supplier_notes, source_quote.internal_notes, 'in_progress',
        '{}'::jsonb, coalesce(source_quote.validation_metadata, '{}'::jsonb), 0, actor, actor
      ) returning * into target_quote;

      -- An editable draft/revision is superseded only after its replacement
      -- version exists. Submitted/reviewed/approved history remains untouched.
      if source_quote.status in ('draft', 'revision_requested') then
        update public.supplier_trip_quotes
        set status = 'archived', updated_by = actor, updated_at = statement_timestamp()
        where id = source_quote.id;
      end if;
    end if;
  end if;

  -- Hotels: existing Travel OS rule = people x nights x price/person/night.
  sort_index := 0;
  for item in select value from jsonb_array_elements(coalesce(p_rows->'hotels', '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object' or nullif(trim(coalesce(item->>'hotel_name', '')), '') is null then
      raise exception 'invalid hotel import line' using errcode = '22023';
    end if;
    numeric_quantity := greatest(0, coalesce(nullif(item->>'person_count', '')::numeric, nullif(item->>'rooms_count', '')::numeric, nullif(item->>'room_count', '')::numeric, 0));
    numeric_multiplier := greatest(0, coalesce(nullif(item->>'nights', '')::numeric, 0));
    numeric_price := greatest(0, coalesce(nullif(item->>'price_per_person_per_night_jpy', '')::numeric, nullif(item->>'unit_price_jpy', '')::numeric, nullif(item->>'price_per_room_per_night_jpy', '')::numeric, 0));
    if numeric_quantity > 100000 or numeric_multiplier > 10000 or numeric_price > 1000000000000 then
      raise exception 'hotel import amount out of range' using errcode = '22023';
    end if;
    calculated_subtotal := round(numeric_quantity * numeric_multiplier * numeric_price, 2);
    source_comment := nullif(trim(coalesce(item->>'comment', '')), '');
    source_row := nullif(item->>'source_excel_row', '');
    insert into public.supplier_quote_hotel_rows(
      quote_id, sort_order, city, hotel_name, check_in, check_out, nights,
      room_type, rooms_count, room_count, unit_price_jpy,
      price_per_room_per_night_jpy, subtotal_jpy, comment, status,
      included_in_total, review_status, updated_at
    ) values (
      target_quote.id, sort_index, nullif(trim(item->>'city'), ''), trim(item->>'hotel_name'),
      nullif(item->>'check_in', '')::date, nullif(item->>'check_out', '')::date,
      numeric_multiplier::integer, nullif(trim(item->>'room_type'), ''),
      numeric_quantity::integer, numeric_quantity::integer, numeric_price, numeric_price,
      calculated_subtotal,
      concat_ws(' · ', source_comment, case when source_row is not null then 'Source Excel ligne ' || source_row end),
      'todo', true, 'pending', statement_timestamp()
    );
    sort_index := sort_index + 1;
  end loop;

  -- Transport: existing Travel OS rule = quantity (Times) x unit price.
  sort_index := 0;
  for item in select value from jsonb_array_elements(coalesce(p_rows->'transport', '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object' or nullif(trim(coalesce(item->>'description', item->>'city_route', '')), '') is null then
      raise exception 'invalid transport import line' using errcode = '22023';
    end if;
    numeric_quantity := greatest(0, coalesce(nullif(item->>'quantity', '')::numeric, 0));
    numeric_price := greatest(0, coalesce(nullif(item->>'unit_price_jpy', '')::numeric, 0));
    if numeric_quantity > 100000 or numeric_price > 1000000000000 then raise exception 'transport import amount out of range' using errcode = '22023'; end if;
    calculated_subtotal := round(numeric_quantity * numeric_price, 2);
    source_comment := nullif(trim(coalesce(item->>'comment', '')), '');
    source_row := nullif(item->>'source_excel_row', '');
    insert into public.supplier_quote_transport_rows(
      quote_id, sort_order, service_date, day_number, city_route, transport_type,
      description, quantity, unit_price_jpy, subtotal_jpy, comment, status,
      included_in_total, review_status, updated_at
    ) values (
      target_quote.id, sort_index, nullif(item->>'service_date', '')::date,
      nullif(item->>'day_number', '')::integer, nullif(trim(item->>'city_route'), ''),
      coalesce(nullif(trim(item->>'transport_type'), ''), 'other'),
      coalesce(nullif(trim(item->>'description'), ''), nullif(trim(item->>'city_route'), '')),
      numeric_quantity, numeric_price, calculated_subtotal,
      concat_ws(' · ', source_comment, case when source_row is not null then 'Source Excel ligne ' || source_row end),
      'todo', true, 'pending', statement_timestamp()
    );
    sort_index := sort_index + 1;
  end loop;

  -- Activities: the existing model stores the effective participant quantity.
  sort_index := 0;
  for item in select value from jsonb_array_elements(coalesce(p_rows->'activities', '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object' or nullif(trim(coalesce(item->>'activity_name', '')), '') is null then
      raise exception 'invalid activity import line' using errcode = '22023';
    end if;
    numeric_quantity := greatest(0, coalesce(nullif(item->>'participant_count', '')::numeric, nullif(item->>'quantity', '')::numeric, 0));
    numeric_price := greatest(0, coalesce(nullif(item->>'unit_price_jpy', '')::numeric, 0));
    if numeric_quantity > 100000 or numeric_price > 1000000000000 then raise exception 'activity import amount out of range' using errcode = '22023'; end if;
    calculated_subtotal := round(numeric_quantity * numeric_price, 2);
    source_comment := nullif(trim(coalesce(item->>'comment', '')), '');
    source_row := nullif(item->>'source_excel_row', '');
    insert into public.supplier_quote_activity_rows(
      quote_id, sort_order, service_date, day_number, activity_name,
      participant_count, quantity, unit_price_jpy, subtotal_jpy, optional,
      comment, status, included_in_total, review_status, updated_at
    ) values (
      target_quote.id, sort_index, nullif(item->>'service_date', '')::date,
      nullif(item->>'day_number', '')::integer, trim(item->>'activity_name'),
      numeric_quantity, numeric_quantity, numeric_price, calculated_subtotal,
      coalesce(nullif(item->>'optional', '')::boolean, false),
      concat_ws(' · ', source_comment, case when source_row is not null then 'Source Excel ligne ' || source_row end),
      'todo', true, 'pending', statement_timestamp()
    );
    sort_index := sort_index + 1;
  end loop;

  -- Guides: No x Times is folded into the existing guides_count field.
  sort_index := 0;
  for item in select value from jsonb_array_elements(coalesce(p_rows->'guides', '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object' or nullif(trim(coalesce(item->>'guide_type', '')), '') is null then
      raise exception 'invalid guide import line' using errcode = '22023';
    end if;
    numeric_quantity := greatest(0, coalesce(nullif(item->>'guides_count', '')::numeric, nullif(item->>'guide_count', '')::numeric, 0));
    numeric_price := greatest(0, coalesce(nullif(item->>'daily_price_jpy', '')::numeric, 0));
    if numeric_quantity > 100000 or numeric_price > 1000000000000 then raise exception 'guide import amount out of range' using errcode = '22023'; end if;
    calculated_subtotal := round(numeric_quantity * numeric_price, 2);
    source_comment := nullif(trim(coalesce(item->>'comment', '')), '');
    source_row := nullif(item->>'source_excel_row', '');
    insert into public.supplier_quote_guide_rows(
      quote_id, sort_order, service_date, day_number, city, guide_type,
      guides_count, guide_count, daily_price_jpy, subtotal_jpy, comment,
      status, included_in_total, review_status, updated_at
    ) values (
      target_quote.id, sort_index, nullif(item->>'service_date', '')::date,
      nullif(item->>'day_number', '')::integer, nullif(trim(item->>'city'), ''),
      trim(item->>'guide_type'), numeric_quantity::integer, numeric_quantity::integer,
      numeric_price, calculated_subtotal,
      concat_ws(' · ', source_comment, case when source_row is not null then 'Source Excel ligne ' || source_row end),
      'todo', true, 'pending', statement_timestamp()
    );
    sort_index := sort_index + 1;
  end loop;

  -- Meals and other source services reuse the existing generic cost rows.
  sort_index := 0;
  for item in select value from jsonb_array_elements(coalesce(p_rows->'other', '[]'::jsonb)) loop
    if jsonb_typeof(item) <> 'object' or nullif(trim(coalesce(item->>'label', '')), '') is null then
      raise exception 'invalid other-cost import line' using errcode = '22023';
    end if;
    numeric_quantity := greatest(0, coalesce(nullif(item->>'quantity', '')::numeric, 0));
    numeric_price := greatest(0, coalesce(nullif(item->>'unit_price_jpy', '')::numeric, 0));
    if numeric_quantity > 100000 or numeric_price > 1000000000000 then raise exception 'other-cost import amount out of range' using errcode = '22023'; end if;
    calculated_subtotal := round(numeric_quantity * numeric_price, 2);
    source_comment := nullif(trim(coalesce(item->>'comment', '')), '');
    source_row := nullif(item->>'source_excel_row', '');
    insert into public.supplier_quote_other_rows(
      quote_id, sort_order, label, quantity, unit_price_jpy, subtotal_jpy,
      comment, status, included_in_total, review_status, updated_at
    ) values (
      target_quote.id, sort_index, trim(item->>'label'), numeric_quantity,
      numeric_price, calculated_subtotal,
      concat_ws(' · ', source_comment, case when source_row is not null then 'Source Excel ligne ' || source_row end),
      'todo', true, 'pending', statement_timestamp()
    );
    sort_index := sort_index + 1;
  end loop;

  update public.supplier_trip_quotes
  set participant_count = greatest(0, coalesce(p_participant_count, participant_count)),
      validation_status = 'in_progress',
      validation_metadata = coalesce(validation_metadata, '{}'::jsonb) || jsonb_build_object(
        'excel_import', coalesce(p_import_metadata, '{}'::jsonb) || jsonb_build_object(
          'source', 'excel_import',
          'file_name', trim(p_file_name),
          'sheet_name', trim(p_sheet_name),
          'imported_at', statement_timestamp(),
          'imported_by', actor,
          'version_number', target_quote.version_number,
          'line_count', line_count,
          'first_sheet_only', true
        )
      ),
      validation_updated_by = actor,
      validation_updated_at = statement_timestamp(),
      updated_by = actor,
      updated_at = statement_timestamp()
  where id = target_quote.id;

  perform public.recalculate_supplier_quote_totals_v2(target_quote.id);

  return (
    select (to_jsonb(q) - array[
      'commission_percentage', 'exchange_rate_jpy_mad', 'commission_amount_jpy',
      'final_total_jpy', 'final_total_mad', 'cost_per_person_jpy',
      'cost_per_person_mad', 'internal_notes'
    ]) || jsonb_build_object(
      'import_mode', p_mode,
      'imported_line_count', line_count,
      'source_quote_id', case when p_mode = 'new_version' then source_quote.id else null end
    )
    from public.supplier_trip_quotes q where q.id = target_quote.id
  );
end
$$;

revoke all on function public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb) from public, anon;
grant execute on function public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb) to authenticated;

notify pgrst, 'reload schema';
