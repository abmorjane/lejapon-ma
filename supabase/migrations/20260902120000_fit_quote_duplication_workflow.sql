-- Atomic FIT quote duplication for internal staff and authorized partner users.
-- Documents, audit/version history, payment records and immutable commission
-- snapshots are intentionally not copied.

alter table public.fit_quotes
  add column if not exists duplicated_from_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fit_quotes'::regclass
      and conname = 'fit_quotes_duplicated_from_id_fkey'
  ) then
    alter table public.fit_quotes
      add constraint fit_quotes_duplicated_from_id_fkey
      foreign key (duplicated_from_id) references public.fit_quotes(id) on delete set null;
  end if;
end;
$$;

create index if not exists fit_quotes_duplicated_from_idx
  on public.fit_quotes (duplicated_from_id, created_at desc)
  where duplicated_from_id is not null;

create or replace function public.duplicate_fit_quote(p_source_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source public.fit_quotes%rowtype;
  v_new public.fit_quotes%rowtype;
  v_new_payload jsonb;
  v_reference text;
  v_token text;
  v_prefix text;
  v_old_day public.fit_quote_days%rowtype;
  v_new_day public.fit_quote_days%rowtype;
  v_old_day_line public.fit_quote_day_cost_lines%rowtype;
  v_new_day_line public.fit_quote_day_cost_lines%rowtype;
  v_old_special_line public.fit_quote_cost_lines%rowtype;
  v_new_special_line public.fit_quote_cost_lines%rowtype;
  v_old_hotel public.fit_quote_hotel_lines%rowtype;
  v_new_hotel public.fit_quote_hotel_lines%rowtype;
  v_old_flight public.fit_quote_flight_lines%rowtype;
  v_new_flight public.fit_quote_flight_lines%rowtype;
  v_old_component public.fit_quote_day_components%rowtype;
  v_new_component public.fit_quote_day_components%rowtype;
  v_old_pricing public.fit_quote_partner_pricing%rowtype;
  v_new_pricing public.fit_quote_partner_pricing%rowtype;
  v_day_map jsonb := '{}'::jsonb;
  v_days_count integer := 0;
  v_day_lines_count integer := 0;
  v_special_lines_count integer := 0;
  v_hotels_count integer := 0;
  v_flights_count integer := 0;
  v_components_count integer := 0;
  v_pricing_copied boolean := false;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select * into v_source
  from public.fit_quotes
  where id = p_source_quote_id
    and deleted_at is null
  for share;

  if not found then
    raise exception 'FIT quote not found';
  end if;

  if not public.can_create_partner_fit_quotes(v_actor_id)
     or not public.can_access_fit_quote(v_source.id, v_actor_id) then
    raise exception 'not authorized to duplicate this FIT quote';
  end if;

  -- Partner users stay inside their organization. Internal sales-owned quotes stay
  -- owned by the current actor; admins retain their existing global capability.
  if v_source.partner_organization_id is not null
     and not public.can_view_fit_internal_costs(v_actor_id)
     and not public.is_partner_org_member(v_source.partner_organization_id, v_actor_id) then
    raise exception 'cross-organization duplication is not allowed';
  end if;

  v_prefix := case when v_source.quote_number like 'PFIT-%' then 'PFIT' else 'FIT' end;
  loop
    v_reference := format(
      '%s-%s-%s',
      v_prefix,
      to_char(statement_timestamp(), 'YYYYMMDD'),
      upper(encode(extensions.gen_random_bytes(3), 'hex'))
    );
    exit when not exists (select 1 from public.fit_quotes where quote_number = v_reference);
  end loop;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  -- Copy the editable quote payload, then explicitly reset every identity,
  -- publication, approval, workflow, payment and lifecycle field.
  v_new_payload := (to_jsonb(v_source) - array[
    'id', 'quote_number', 'status', 'share_token', 'share_slug', 'share_enabled',
    'client_notes', 'requested_changes_at', 'converted_booking_id', 'sent_at',
    'accepted_at', 'created_by', 'owner_user_id', 'created_at', 'updated_at',
    'metadata', 'version_number', 'production_status', 'japan_request_status',
    'payment_status', 'booking_status', 'reservation_status',
    'japan_request_sent_at', 'japan_request_reference', 'japan_request_deadline',
    'japan_response_notes', 'japan_confirmed_price', 'japan_conditions',
    'japan_valid_until', 'admin_approved_for_payment_at',
    'admin_approved_for_payment_by', 'payment_authorized_at',
    'payment_authorized_by', 'client_preapproved_at', 'client_preapproved_by',
    'partner_payment_requested_at', 'partner_payment_received_at',
    'booking_in_progress_at', 'production_confirmed_at', 'deleted_at', 'deleted_by',
    'public_link_expires_at', 'public_link_revoked_at', 'public_client_visible',
    'public_last_viewed_at', 'public_client_status', 'duplicated_from_id',
    'requires_lejapon_approval', 'approval_reason'
  ]) || jsonb_build_object(
    'id', gen_random_uuid(),
    'quote_number', v_reference,
    'status', 'draft',
    'share_token', v_token,
    'share_slug', null,
    'share_enabled', false,
    'client_notes', null,
    'requested_changes_at', null,
    'converted_booking_id', null,
    'sent_at', null,
    'accepted_at', null,
    'created_by', v_actor_id,
    'owner_user_id', v_actor_id,
    'created_at', statement_timestamp(),
    'updated_at', statement_timestamp(),
    'metadata', jsonb_build_object('duplicated_from_id', v_source.id, 'duplicated_at', statement_timestamp()),
    'version_number', 1,
    'production_status', 'draft',
    'japan_request_status', 'not_started',
    'payment_status', 'not_authorized',
    'booking_status', 'not_started',
    'reservation_status', 'not_started',
    'japan_request_sent_at', null,
    'japan_request_reference', null,
    'japan_request_deadline', null,
    'japan_response_notes', null,
    'japan_confirmed_price', null,
    'japan_conditions', null,
    'japan_valid_until', null,
    'admin_approved_for_payment_at', null,
    'admin_approved_for_payment_by', null,
    'payment_authorized_at', null,
    'payment_authorized_by', null,
    'client_preapproved_at', null,
    'client_preapproved_by', null,
    'partner_payment_requested_at', null,
    'partner_payment_received_at', null,
    'booking_in_progress_at', null,
    'production_confirmed_at', null,
    'deleted_at', null,
    'deleted_by', null,
    'public_link_expires_at', null,
    'public_link_revoked_at', null,
    'public_client_visible', false,
    'public_last_viewed_at', null,
    'public_client_status', null,
    'duplicated_from_id', v_source.id,
    'requires_lejapon_approval', false,
    'approval_reason', null
  );

  select * into v_new
  from jsonb_populate_record(null::public.fit_quotes, v_new_payload);

  insert into public.fit_quotes
  select (v_new).*
  returning * into v_new;

  -- Itinerary days and their client/supplier editable child rows receive fresh IDs.
  for v_old_day in
    select * from public.fit_quote_days where quote_id = v_source.id order by sort_order, day_number
  loop
    select * into v_new_day
    from jsonb_populate_record(
      null::public.fit_quote_days,
      (to_jsonb(v_old_day) - array['id', 'quote_id', 'created_at', 'updated_at'])
      || jsonb_build_object(
        'id', gen_random_uuid(), 'quote_id', v_new.id,
        'created_at', statement_timestamp(), 'updated_at', statement_timestamp()
      )
    );
    insert into public.fit_quote_days select (v_new_day).* returning * into v_new_day;
    v_day_map := v_day_map || jsonb_build_object(v_old_day.id::text, v_new_day.id::text);
    v_days_count := v_days_count + 1;

    for v_old_day_line in select * from public.fit_quote_day_cost_lines where day_id = v_old_day.id order by sort_order
    loop
      select * into v_new_day_line
      from jsonb_populate_record(
        null::public.fit_quote_day_cost_lines,
        (to_jsonb(v_old_day_line) - array['id', 'quote_id', 'day_id', 'created_at', 'updated_at'])
        || jsonb_build_object(
          'id', gen_random_uuid(), 'quote_id', v_new.id, 'day_id', v_new_day.id,
          'created_at', statement_timestamp(), 'updated_at', statement_timestamp()
        )
      );
      insert into public.fit_quote_day_cost_lines select (v_new_day_line).*;
      v_day_lines_count := v_day_lines_count + 1;
    end loop;

    for v_old_component in select * from public.fit_quote_day_components where quote_day_id = v_old_day.id order by created_at
    loop
      select * into v_new_component
      from jsonb_populate_record(
        null::public.fit_quote_day_components,
        (to_jsonb(v_old_component) - array['id', 'quote_day_id', 'created_at', 'updated_at'])
        || jsonb_build_object(
          'id', gen_random_uuid(), 'quote_day_id', v_new_day.id,
          'created_at', statement_timestamp(), 'updated_at', statement_timestamp()
        )
      );
      insert into public.fit_quote_day_components select (v_new_component).*;
      v_components_count := v_components_count + 1;
    end loop;
  end loop;

  for v_old_special_line in select * from public.fit_quote_cost_lines where quote_id = v_source.id order by sort_order
  loop
    select * into v_new_special_line
    from jsonb_populate_record(
      null::public.fit_quote_cost_lines,
      (to_jsonb(v_old_special_line) - array['id', 'quote_id', 'day_id', 'created_at', 'updated_at'])
      || jsonb_build_object(
        'id', gen_random_uuid(),
        'quote_id', v_new.id,
        'day_id', case when v_old_special_line.day_id is null then null else v_day_map ->> v_old_special_line.day_id::text end,
        'created_at', statement_timestamp(), 'updated_at', statement_timestamp()
      )
    );
    insert into public.fit_quote_cost_lines select (v_new_special_line).*;
    v_special_lines_count := v_special_lines_count + 1;
  end loop;

  for v_old_hotel in select * from public.fit_quote_hotel_lines where quote_id = v_source.id order by sort_order
  loop
    select * into v_new_hotel
    from jsonb_populate_record(
      null::public.fit_quote_hotel_lines,
      (to_jsonb(v_old_hotel) - array['id', 'quote_id', 'created_at', 'updated_at'])
      || jsonb_build_object(
        'id', gen_random_uuid(), 'quote_id', v_new.id,
        'created_at', statement_timestamp(), 'updated_at', statement_timestamp()
      )
    );
    insert into public.fit_quote_hotel_lines select (v_new_hotel).*;
    v_hotels_count := v_hotels_count + 1;
  end loop;

  for v_old_flight in select * from public.fit_quote_flight_lines where quote_id = v_source.id order by sort_order
  loop
    select * into v_new_flight
    from jsonb_populate_record(
      null::public.fit_quote_flight_lines,
      (to_jsonb(v_old_flight) - array['id', 'quote_id', 'created_at', 'updated_at'])
      || jsonb_build_object(
        'id', gen_random_uuid(), 'quote_id', v_new.id,
        'created_at', statement_timestamp(), 'updated_at', statement_timestamp()
      )
    );
    insert into public.fit_quote_flight_lines select (v_new_flight).*;
    v_flights_count := v_flights_count + 1;
  end loop;

  -- Partner pricing is an editable rule set only while the source is still draft.
  -- Immutable agency_commission_snapshots are never read or inserted here.
  if v_source.status = 'draft' then
    select * into v_old_pricing
    from public.fit_quote_partner_pricing
    where quote_id = v_source.id;
    if found then
      select * into v_new_pricing
      from jsonb_populate_record(
        null::public.fit_quote_partner_pricing,
        (to_jsonb(v_old_pricing) - array['quote_id', 'created_at', 'updated_at'])
        || jsonb_build_object(
          'quote_id', v_new.id,
          'created_at', statement_timestamp(), 'updated_at', statement_timestamp()
        )
      );
      insert into public.fit_quote_partner_pricing select (v_new_pricing).*;
      v_pricing_copied := true;
    end if;
  end if;

  if v_new.partner_organization_id is not null then
    insert into public.fit_quote_access (quote_id, organization_id, owner_user_id, role_scope)
    values (v_new.id, v_new.partner_organization_id, v_actor_id, 'partner_owner')
    on conflict (quote_id, organization_id) do nothing;
  end if;

  insert into public.quote_audit_logs (quote_id, organization_id, user_id, action_type, payload)
  values
    (v_source.id, v_source.partner_organization_id, v_actor_id, 'duplicated_to',
      jsonb_build_object('duplicated_to_id', v_new.id, 'duplicated_to_reference', v_new.quote_number)),
    (v_new.id, v_new.partner_organization_id, v_actor_id, 'duplicated_from',
      jsonb_build_object('duplicated_from_id', v_source.id, 'duplicated_from_reference', v_source.quote_number));

  return jsonb_build_object(
    'ok', true,
    'source_quote_id', v_source.id,
    'source_reference', v_source.quote_number,
    'new_quote_id', v_new.id,
    'new_reference', v_new.quote_number,
    'copied', jsonb_build_object(
      'days', v_days_count,
      'day_cost_lines', v_day_lines_count,
      'special_cost_lines', v_special_lines_count,
      'hotels', v_hotels_count,
      'flights', v_flights_count,
      'supplier_components', v_components_count,
      'editable_partner_pricing', v_pricing_copied
    ),
    'attachments', jsonb_build_object(
      'copied_files', 0,
      'referenced_reusable_assets', 'day image URLs and source template/component references',
      'skipped', 'all fit_quote_documents, generated PDFs, signed/client files and storage objects'
    )
  );
end;
$$;

revoke all on function public.duplicate_fit_quote(uuid) from public, anon;
grant execute on function public.duplicate_fit_quote(uuid) to authenticated;

notify pgrst, 'reload schema';
