-- PREPARED ONLY. Do not apply before the historical FIT review and rollout plan.
-- Additive: no UPDATE of historical quotes/days, no backfill of 0% overrides.

alter table public.fit_quote_days
  add column if not exists japan_agency_fee_exemption_reason text,
  add column if not exists japan_agency_fee_exempted_at timestamptz,
  add column if not exists japan_agency_fee_exempted_by uuid,
  add column if not exists japan_fee_eligible_base_mad numeric;

alter table public.fit_quotes
  add column if not exists supplier_cost_reconciled_at timestamptz,
  add column if not exists supplier_cost_reconciled_by uuid,
  add column if not exists supplier_cost_reconciliation_reason text,
  add column if not exists supplier_cost_reconciliation_digest text,
  add column if not exists financial_scope_review_required boolean not null default false,
  add column if not exists financial_revision bigint not null default 0;

-- No historical classification is inferred or backfilled. New financial rows
-- are classified explicitly by the editor and the atomic save RPC.
alter table public.fit_quote_day_cost_lines add column if not exists cost_owner text;
alter table public.fit_quote_cost_lines add column if not exists cost_owner text;
alter table public.fit_quote_cost_lines add column if not exists times numeric not null default 1 check (times >= 0);
alter table public.fit_quote_hotel_lines add column if not exists cost_owner text;
alter table public.fit_quote_flight_lines add column if not exists cost_owner text;

do $$
declare v_table text;
begin
  foreach v_table in array array['fit_quote_day_cost_lines','fit_quote_cost_lines','fit_quote_hotel_lines','fit_quote_flight_lines'] loop
    execute format('alter table public.%I add constraint %I check (cost_owner is null or cost_owner in (''japan_supplier_managed'',''lejapon_direct'')) not valid',
      v_table,v_table||'_cost_owner_v1');
  end loop;
end $$;

-- fit_supplier_requests is one request per accepted component and
-- supplier_trip_quotes belongs to a trip, not a FIT quote. Neither can hold
-- one authoritative global Japan quote without double counting.
create table public.fit_japan_supplier_quote_totals (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.fit_quotes(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  quoted_amount numeric not null check (quoted_amount >= 0),
  currency text not null check (currency in ('MAD','JPY','USD','EUR')),
  exchange_rate_to_mad numeric not null check (exchange_rate_to_mad > 0),
  handling_mode text not null default 'included' check (handling_mode in ('included','separate')),
  handling_rate numeric check (handling_rate between 0 and 100),
  quoted_at timestamptz not null,
  supplier_reference text,
  document_id uuid references public.fit_quote_documents(id) on delete set null,
  notes_internal text,
  confirmed_amount numeric check (confirmed_amount >= 0),
  final_amount numeric check (final_amount >= 0),
  confirmed_exchange_rate_to_mad numeric check (confirmed_exchange_rate_to_mad > 0),
  final_exchange_rate_to_mad numeric check (final_exchange_rate_to_mad > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint fit_japan_supplier_quote_handling_v1 check (
    (handling_mode='included' and handling_rate is null)
    or (handling_mode='separate' and handling_rate is not null)
  )
);
create index fit_japan_supplier_quote_supplier_idx on public.fit_japan_supplier_quote_totals(supplier_id);
alter table public.fit_japan_supplier_quote_totals enable row level security;
create policy "FIT staff read global Japan supplier quote" on public.fit_japan_supplier_quote_totals
for select to authenticated using (
  public.can_view_fit_internal_costs((select auth.uid()))
  and public.can_access_fit_quote(quote_id,(select auth.uid()))
);
revoke all on public.fit_japan_supplier_quote_totals from public, anon, authenticated;
grant select on public.fit_japan_supplier_quote_totals to authenticated;

alter table public.fit_quote_days
  add constraint fit_quote_days_japan_fee_override_range_v1
  check (japan_agency_fee_rate_override is null or japan_agency_fee_rate_override between 0 and 100) not valid;

-- Existing 0% rows remain untouched. New exemptions require an explicit reason.
-- A reasoned new/changed exemption receives its actor and timestamp on-server.
create or replace function public.audit_fit_japan_fee_exemption_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if (select calculation_mode from public.fit_quotes where id=new.quote_id) is distinct from 'automatic_v2' then
    return new;
  end if;
  if new.japan_agency_fee_rate_override = 0 then
    if nullif(btrim(new.japan_agency_fee_exemption_reason), '') is null then
      if tg_op = 'INSERT' then
        raise exception 'explicit_japan_fee_exemption_reason_required';
      elsif old.japan_agency_fee_rate_override is distinct from 0 then
        raise exception 'explicit_japan_fee_exemption_reason_required';
      end if;
      new.japan_agency_fee_exempted_at := null;
      new.japan_agency_fee_exempted_by := null;
      return new;
    end if;
    if tg_op = 'INSERT' then
      if auth.uid() is null then raise exception 'japan_fee_exemption_actor_required'; end if;
      new.japan_agency_fee_exempted_at := statement_timestamp();
      new.japan_agency_fee_exempted_by := auth.uid();
    elsif old.japan_agency_fee_rate_override is distinct from 0
       or old.japan_agency_fee_exemption_reason is distinct from new.japan_agency_fee_exemption_reason then
      if auth.uid() is null then raise exception 'japan_fee_exemption_actor_required'; end if;
      new.japan_agency_fee_exempted_at := statement_timestamp();
      new.japan_agency_fee_exempted_by := auth.uid();
    end if;
  else
    new.japan_agency_fee_exemption_reason := null;
    new.japan_agency_fee_exempted_at := null;
    new.japan_agency_fee_exempted_by := null;
  end if;
  return new;
end $$;
revoke all on function public.audit_fit_japan_fee_exemption_v1() from public, anon, authenticated;
create trigger fit_quote_days_audit_japan_fee_v1
before insert or update of japan_agency_fee_rate_override, japan_agency_fee_exemption_reason
on public.fit_quote_days for each row execute function public.audit_fit_japan_fee_exemption_v1();

-- The legacy copier inserts fresh rows from historical days. Reset copied 0%
-- before the audit trigger (alphabetical trigger order) so a duplicated quote
-- inherits its configured rate. The copied quote totals intentionally stay
-- unchanged until the operator saves/reprices the new draft. Release checks
-- reject that temporary mismatch; source rows are never backfilled.
create or replace function public.inherit_fit_japan_fee_on_copy_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare q public.fit_quotes%rowtype;
begin
  if new.japan_agency_fee_rate_override is distinct from 0
     or nullif(btrim(new.japan_agency_fee_exemption_reason),'') is not null then return new; end if;
  select * into q from public.fit_quotes where id = new.quote_id;
  if q.calculation_mode <> 'automatic_v2' or q.duplicated_from_id is null then return new; end if;
  new.japan_agency_fee_rate_override := null;
  new.japan_agency_fee_exemption_reason := null;
  new.japan_agency_fee_exempted_at := null;
  new.japan_agency_fee_exempted_by := null;
  -- No historic ground cost may be assumed Japan-managed. Keep the copied
  -- estimate visibly incomplete until each component is reviewed and saved.
  new.calculated_japan_agency_fee := 0;
  new.japan_fee_eligible_base_mad := null;
  new.calculated_project_cost := new.calculated_ground_cost;
  update public.fit_quotes set financial_scope_review_required=true where id=new.quote_id;
  return new;
end $$;
revoke all on function public.inherit_fit_japan_fee_on_copy_v1() from public, anon, authenticated;
create trigger fit_quote_days_aa_inherit_japan_fee_v1
before insert on public.fit_quote_days for each row execute function public.inherit_fit_japan_fee_on_copy_v1();

-- A previously published link must not keep serving a quote while its price
-- is being edited. This also covers direct Data API writes to cost children,
-- not just the React save flow. Re-publication requires an explicit assertion.
create or replace function public.revoke_fit_link_on_quote_reprice_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.share_enabled and new.calculation_mode = 'automatic_v2' and (
    old.japan_agency_fee_rate is distinct from new.japan_agency_fee_rate or
    old.lejapon_margin_rate is distinct from new.lejapon_margin_rate or
    old.margin_scope is distinct from new.margin_scope or
    old.rounding_rule is distinct from new.rounding_rule or
    old.ground_cost_total_mad is distinct from new.ground_cost_total_mad or
    old.japan_agency_fee_total_mad is distinct from new.japan_agency_fee_total_mad or
    old.project_cost_total_mad is distinct from new.project_cost_total_mad or
    old.total_selling_price_mad is distinct from new.total_selling_price_mad or
    old.manual_adjustment_mad is distinct from new.manual_adjustment_mad or
    old.discount_mad is distinct from new.discount_mad or
    old.supplier_cost_reconciled_at is distinct from new.supplier_cost_reconciled_at or
    old.supplier_cost_reconciliation_digest is distinct from new.supplier_cost_reconciliation_digest or
    old.financial_scope_review_required is distinct from new.financial_scope_review_required
  ) then
    new.share_enabled := false;
    new.public_client_visible := false;
    new.public_link_revoked_at := statement_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.revoke_fit_link_on_quote_reprice_v1() from public, anon, authenticated;
create trigger fit_quotes_revoke_link_on_reprice_v1
before update on public.fit_quotes for each row execute function public.revoke_fit_link_on_quote_reprice_v1();

create or replace function public.revoke_fit_link_on_cost_change_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_quote_id uuid;
begin
  if tg_op = 'DELETE' then v_quote_id := old.quote_id;
  else v_quote_id := new.quote_id; end if;
  update public.fit_quotes set
    financial_revision = financial_revision + 1,
    share_enabled = false,
    public_client_visible = false,
    public_link_revoked_at = statement_timestamp()
  where id = v_quote_id;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.revoke_fit_link_on_cost_change_v1() from public, anon, authenticated;
create trigger fit_quote_days_revoke_link_on_cost_change_v1
after insert or update or delete on public.fit_quote_days
for each row execute function public.revoke_fit_link_on_cost_change_v1();
create trigger fit_quote_day_cost_lines_revoke_link_on_change_v1
after insert or update or delete on public.fit_quote_day_cost_lines
for each row execute function public.revoke_fit_link_on_cost_change_v1();
create trigger fit_quote_cost_lines_revoke_link_on_change_v1
after insert or update or delete on public.fit_quote_cost_lines
for each row execute function public.revoke_fit_link_on_cost_change_v1();
create trigger fit_quote_hotel_lines_revoke_link_on_change_v1
after insert or update or delete on public.fit_quote_hotel_lines
for each row execute function public.revoke_fit_link_on_cost_change_v1();
create trigger fit_quote_flight_lines_revoke_link_on_change_v1
after insert or update or delete on public.fit_quote_flight_lines
for each row execute function public.revoke_fit_link_on_cost_change_v1();
create trigger fit_japan_supplier_quote_revoke_link_on_change_v1
after insert or update or delete on public.fit_japan_supplier_quote_totals
for each row execute function public.revoke_fit_link_on_cost_change_v1();

-- Direct header edits also invalidate an opened editor's optimistic revision.
create or replace function public.bump_fit_financial_revision_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if (
    old.japan_agency_fee_rate is distinct from new.japan_agency_fee_rate or
    old.lejapon_margin_rate is distinct from new.lejapon_margin_rate or
    old.margin_scope is distinct from new.margin_scope or
    old.rounding_rule is distinct from new.rounding_rule or
    old.ground_cost_total_mad is distinct from new.ground_cost_total_mad or
    old.japan_agency_fee_total_mad is distinct from new.japan_agency_fee_total_mad or
    old.project_cost_total_mad is distinct from new.project_cost_total_mad or
    old.total_selling_price_mad is distinct from new.total_selling_price_mad or
    old.manual_adjustment_mad is distinct from new.manual_adjustment_mad or
    old.discount_mad is distinct from new.discount_mad
  ) then
    new.financial_revision := greatest(new.financial_revision,old.financial_revision+1);
  end if;
  return new;
end $$;
revoke all on function public.bump_fit_financial_revision_v1() from public, anon, authenticated;
create trigger fit_quotes_bump_financial_revision_v1
before update on public.fit_quotes for each row execute function public.bump_fit_financial_revision_v1();

create or replace function public.guard_fit_financial_release_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_issue text;
begin
  if new.calculation_mode = 'automatic_v2' and (
    (new.share_enabled = true and old.share_enabled is distinct from true)
    or (new.commercial_status in ('ready','sent','accepted','deposit_pending','deposit_paid','converted_to_booking') and old.commercial_status is distinct from new.commercial_status)
    or (new.status in ('ready','sent','sent_to_client','approved','admin_approved_for_payment','payment_authorized','confirmed') and old.status is distinct from new.status)
    or (new.production_status in ('sent_to_client','admin_approved_for_payment','confirmed') and old.production_status is distinct from new.production_status)
  ) then
    v_issue := public._fit_financial_integrity_issue_v1(new.id);
    if v_issue is not null then raise exception 'FINANCIAL INTEGRITY ERROR: %', v_issue; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_fit_financial_release_v1() from public, anon, authenticated;
create trigger fit_quotes_guard_financial_release_v1
after update of share_enabled,commercial_status,status,production_status on public.fit_quotes
for each row execute function public.guard_fit_financial_release_v1();

-- A direct document insert or public acceptance must not bypass the release UI.
create or replace function public.guard_fit_financial_document_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_issue text;
begin
  if new.document_type = 'client_pdf' then
    v_issue := public._fit_financial_integrity_issue_v1(new.quote_id);
    if v_issue is not null then raise exception 'FINANCIAL INTEGRITY ERROR: %', v_issue; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_fit_financial_document_v1() from public, anon, authenticated;
create trigger fit_quote_documents_guard_financial_v1
before insert on public.fit_quote_documents for each row execute function public.guard_fit_financial_document_v1();

create or replace function public.guard_fit_financial_acceptance_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_issue text;
begin
  v_issue := public._fit_financial_integrity_issue_v1(new.quote_id);
  if v_issue is not null then raise exception 'FINANCIAL INTEGRITY ERROR: %', v_issue; end if;
  return new;
end $$;
revoke all on function public.guard_fit_financial_acceptance_v1() from public, anon, authenticated;
create trigger fit_quote_acceptances_guard_financial_v1
before insert on public.fit_quote_acceptances for each row execute function public.guard_fit_financial_acceptance_v1();

-- Private-by-privilege insert helper. Every accepted JSON key is explicitly
-- listed; the caller cannot set ids, quote ownership or audit timestamps.
create or replace function public._fit_insert_financial_row_v1(
  p_table text, p_quote_id uuid, p_row jsonb, p_day_id uuid default null
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_allowed text[]; v_key text; v_cols text; v_values text; v_id uuid;
begin
  if jsonb_typeof(p_row) <> 'object' then raise exception 'invalid_financial_row'; end if;
  case p_table
    when 'fit_quote_days' then v_allowed := string_to_array('template_id local_key day_number sort_order date title city source_description sales_summary optimized_client_description description_client client_summary client_highlights client_inclusions client_options visits optional_visits rhythm day_pace transport_type transport_modes guide_required hotel_night meal_notes meals meal_plan pax_group_size cost_jpy cost_mad selling_price_mad japan_agency_fee_rate_override japan_agency_fee_exemption_reason calculated_ground_cost japan_fee_eligible_base_mad calculated_japan_agency_fee calculated_project_cost calculated_margin calculated_sale_price calculated_sale_price_per_person notes internal_notes image_urls',' ');
    when 'fit_quote_day_cost_lines' then v_allowed := string_to_array('template_line_id sort_order category label price_mad price_jpy quantity times subtotal_mad subtotal_jpy fee_type percentage_rate notes is_optional is_client_visible included_in_calculation cost_role cost_owner supplier_id supplier_quote_id supplier_confirmation_document_id supplier_invoice_id supplier_payment_id estimated_cost supplier_quoted_cost confirmed_cost final_cost component_selling_price cost_currency exchange_rate_to_mad supplier_payment_status',' ');
    when 'fit_quote_cost_lines' then v_allowed := string_to_array('sort_order category label quantity times unit_cost_mad total_mad notes optional included_in_calculation cost_role cost_owner supplier_id supplier_quote_id supplier_confirmation_document_id supplier_invoice_id supplier_payment_id estimated_cost supplier_quoted_cost confirmed_cost final_cost component_selling_price cost_currency exchange_rate_to_mad supplier_payment_status',' ');
    when 'fit_quote_hotel_lines' then v_allowed := string_to_array('sort_order city hotel_name image_url category room_type rooms_count nights price_per_room_night_mad subtotal_mad notes public_notes cost_owner supplier_id supplier_quote_id supplier_confirmation_document_id supplier_invoice_id supplier_payment_id estimated_cost supplier_quoted_cost confirmed_cost final_cost component_selling_price cost_currency exchange_rate_to_mad supplier_payment_status',' ');
    when 'fit_quote_flight_lines' then v_allowed := string_to_array('sort_order route airline status fare_per_person_mad passengers_count subtotal_mad notes public_notes cost_owner supplier_id supplier_quote_id supplier_confirmation_document_id supplier_invoice_id supplier_payment_id estimated_cost supplier_quoted_cost confirmed_cost final_cost component_selling_price cost_currency exchange_rate_to_mad supplier_payment_status',' ');
    else raise exception 'invalid_financial_table';
  end case;
  for v_key in select jsonb_object_keys(p_row) loop
    if not v_key = any(v_allowed) then raise exception 'invalid_financial_field: %', v_key; end if;
  end loop;
  select string_agg(format('%I',key),',' order by key), string_agg(format('r.%I',key),',' order by key)
    into v_cols,v_values from jsonb_object_keys(p_row) key;
  if p_table = 'fit_quote_day_cost_lines' then
    if p_day_id is null then raise exception 'invalid_financial_day'; end if;
    execute format('insert into public.%I (quote_id,day_id%s) select $1,$3%s from jsonb_populate_record(null::public.%I,$2) r returning id',
      p_table,coalesce(','||v_cols,''),coalesce(','||v_values,''),p_table)
      using p_quote_id,p_row,p_day_id into v_id;
  else
    execute format('insert into public.%I (quote_id%s) select $1%s from jsonb_populate_record(null::public.%I,$2) r returning id',
      p_table,coalesce(','||v_cols,''),coalesce(','||v_values,''),p_table)
      using p_quote_id,p_row into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public._fit_insert_financial_row_v1(text,uuid,jsonb,uuid) from public, anon, authenticated;

-- One Data API call = one PostgreSQL transaction. Any raised exception rolls
-- back the link revocation, document archive, all rows and the audit entry.
create or replace function public.save_fit_financial_model_v1(
  p_quote_id uuid, p_expected_revision bigint, p_header jsonb,
  p_days jsonb, p_day_lines jsonb, p_cost_lines jsonb,
  p_hotels jsonb, p_flights jsonb, p_supplier_quote jsonb default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  q public.fit_quotes%rowtype; v_actor uuid := auth.uid(); v_item jsonb; v_key text;
  v_day_ids jsonb := '{}'::jsonb; v_day_id uuid; v_step numeric;
  v_day_ground numeric; v_day_managed numeric; v_day_fee numeric;
  v_program_cost numeric := 0; v_program_project numeric := 0;
  v_special_cost numeric := 0; v_hotel_cost numeric := 0; v_flight_cost numeric := 0;
  v_other_managed numeric := 0; v_ground numeric; v_japan_fee numeric; v_project numeric;
  v_markup_base numeric; v_markup numeric; v_sale numeric; v_count integer;
  v_supplier_id uuid; v_handling_mode text; v_handling_rate numeric;
begin
  if v_actor is null or not public.can_access_fit_quote(p_quote_id,v_actor)
     or not public.can_view_fit_internal_costs(v_actor) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id for update;
  if not found then raise exception 'fit_quote_not_found'; end if;
  if q.is_current_version is false then raise exception 'historical_version_read_only'; end if;
  -- The existing accepted-version trigger only compares the quote header.
  -- Recreating child days with unchanged totals must not alter accepted content.
  if q.accepted_snapshot_id is not null then raise exception 'accepted_fit_version_read_only'; end if;
  if q.financial_revision is distinct from p_expected_revision then
    raise exception 'fit_financial_revision_conflict' using errcode='40001';
  end if;
  if jsonb_typeof(p_header) <> 'object' or jsonb_typeof(p_days) <> 'array'
     or jsonb_typeof(p_day_lines) <> 'array' or jsonb_typeof(p_cost_lines) <> 'array'
     or jsonb_typeof(p_hotels) <> 'array' or jsonb_typeof(p_flights) <> 'array' then
    raise exception 'invalid_financial_payload';
  end if;
  if jsonb_array_length(p_days)>60 or jsonb_array_length(p_day_lines)>1000
     or jsonb_array_length(p_cost_lines)>200 or jsonb_array_length(p_hotels)>200
     or jsonb_array_length(p_flights)>200 then raise exception 'financial_payload_too_large'; end if;
  -- Do not accept status, share, payment, security or calculated totals from the browser.
  for v_key in select jsonb_object_keys(p_header) loop
    if not v_key = any(string_to_array('client_name travelers_count travel_start_date travel_end_date hotel_category room_type currency language notes japan_agency_fee_rate lejapon_margin_rate margin_scope rounding_rule manual_adjustment_mad discount_mad public_deposit_mad public_payment_deadline valid_until client_notes payment_conditions booking_conditions cancellation_conditions production_public_note japan_request_reference japan_request_deadline japan_response_notes japan_confirmed_price japan_conditions japan_valid_until inclusions exclusions',' ')) then
      if q.calculation_mode <> 'legacy' or not v_key = any(string_to_array('total_cost_mad total_selling_price_mad margin_amount_mad margin_percent price_per_person_mad ground_cost_total_mad japan_agency_fee_total_mad project_cost_total_mad hotel_total_mad hotel_cost_mad flight_cost_mad transport_total_mad guide_total_mad activities_total_mad other_total_mad',' ')) then
        raise exception 'invalid_financial_header_field: %', v_key;
      end if;
    end if;
  end loop;
  -- Recreating child rows would cascade public selections/partner components or
  -- strand procurement references. Require a new FIT version instead.
  if exists(select 1 from public.fit_supplier_requests where quote_id=p_quote_id)
     or exists(select 1 from public.fit_quote_public_extra_selections where quote_id=p_quote_id)
     or exists(select 1 from public.fit_quote_day_components c join public.fit_quote_days d
       on d.id=c.quote_day_id where d.quote_id=p_quote_id) then
    raise exception 'dependent_fit_records_require_new_version';
  end if;
  update public.fit_quotes set share_enabled=false,public_client_visible=false,
    public_link_revoked_at=statement_timestamp() where id=p_quote_id;
  for v_key in select jsonb_object_keys(p_header) loop
    execute format('update public.fit_quotes set %I=(select r.%I from jsonb_populate_record(null::public.fit_quotes,$1) r) where id=$2',v_key,v_key)
      using jsonb_build_object(v_key,p_header->v_key),p_quote_id;
  end loop;
  delete from public.fit_quote_day_cost_lines where quote_id=p_quote_id;
  delete from public.fit_quote_days where quote_id=p_quote_id;
  delete from public.fit_quote_cost_lines where quote_id=p_quote_id;
  delete from public.fit_quote_hotel_lines where quote_id=p_quote_id;
  delete from public.fit_quote_flight_lines where quote_id=p_quote_id;
  for v_item in select value from jsonb_array_elements(p_days) loop
    if nullif(v_item->>'local_key','') is null or v_day_ids ? (v_item->>'local_key') then raise exception 'duplicate_or_missing_day_key'; end if;
    v_day_id := public._fit_insert_financial_row_v1('fit_quote_days',p_quote_id,v_item,null);
    v_day_ids := v_day_ids || jsonb_build_object(v_item->>'local_key',v_day_id);
  end loop;
  for v_item in select value from jsonb_array_elements(p_day_lines) loop
    v_day_id := (v_day_ids->>(v_item->>'day_local_key'))::uuid;
    if v_day_id is null then raise exception 'orphan_day_cost_line'; end if;
    perform public._fit_insert_financial_row_v1('fit_quote_day_cost_lines',p_quote_id,v_item-'day_local_key',v_day_id);
  end loop;
  for v_item in select value from jsonb_array_elements(p_cost_lines) loop
    perform public._fit_insert_financial_row_v1('fit_quote_cost_lines',p_quote_id,v_item,null);
  end loop;
  for v_item in select value from jsonb_array_elements(p_hotels) loop
    perform public._fit_insert_financial_row_v1('fit_quote_hotel_lines',p_quote_id,v_item,null);
  end loop;
  for v_item in select value from jsonb_array_elements(p_flights) loop
    perform public._fit_insert_financial_row_v1('fit_quote_flight_lines',p_quote_id,v_item,null);
  end loop;
  if p_supplier_quote is not null then
    if jsonb_typeof(p_supplier_quote)<>'object' or exists (
      select 1 from jsonb_object_keys(p_supplier_quote) k where not k=any(string_to_array('supplier_id quoted_amount currency exchange_rate_to_mad handling_mode handling_rate quoted_at supplier_reference document_id notes_internal confirmed_amount final_amount confirmed_exchange_rate_to_mad final_exchange_rate_to_mad',' '))
    ) then raise exception 'invalid_global_supplier_quote'; end if;
    v_supplier_id := nullif(p_supplier_quote->>'supplier_id','')::uuid;
    v_handling_mode := coalesce(nullif(p_supplier_quote->>'handling_mode',''),'included');
    v_handling_rate := nullif(p_supplier_quote->>'handling_rate','')::numeric;
    if v_supplier_id is null or nullif(p_supplier_quote->>'quoted_amount','') is null
       or nullif(p_supplier_quote->>'quoted_at','') is null
       or (v_handling_mode='included' and v_handling_rate is not null)
       or (v_handling_mode='separate' and v_handling_rate is null) then
      raise exception 'incomplete_global_supplier_quote';
    end if;
    if nullif(p_supplier_quote->>'document_id','') is not null and not exists (
      select 1 from public.fit_quote_documents where id=(p_supplier_quote->>'document_id')::uuid and quote_id=p_quote_id
    ) then raise exception 'supplier_quote_document_outside_quote'; end if;
    insert into public.fit_japan_supplier_quote_totals
      (quote_id,supplier_id,quoted_amount,currency,exchange_rate_to_mad,handling_mode,handling_rate,
       quoted_at,supplier_reference,document_id,notes_internal,confirmed_amount,final_amount,
       confirmed_exchange_rate_to_mad,final_exchange_rate_to_mad,created_by)
    values(p_quote_id,v_supplier_id,(p_supplier_quote->>'quoted_amount')::numeric,
       p_supplier_quote->>'currency',(p_supplier_quote->>'exchange_rate_to_mad')::numeric,
       v_handling_mode,v_handling_rate,(p_supplier_quote->>'quoted_at')::timestamptz,
       nullif(p_supplier_quote->>'supplier_reference',''),nullif(p_supplier_quote->>'document_id','')::uuid,
       nullif(p_supplier_quote->>'notes_internal',''),nullif(p_supplier_quote->>'confirmed_amount','')::numeric,
       nullif(p_supplier_quote->>'final_amount','')::numeric,
       nullif(p_supplier_quote->>'confirmed_exchange_rate_to_mad','')::numeric,
       nullif(p_supplier_quote->>'final_exchange_rate_to_mad','')::numeric,v_actor)
    on conflict (quote_id) do update set supplier_id=excluded.supplier_id,quoted_amount=excluded.quoted_amount,
      currency=excluded.currency,exchange_rate_to_mad=excluded.exchange_rate_to_mad,
      handling_mode=excluded.handling_mode,handling_rate=excluded.handling_rate,quoted_at=excluded.quoted_at,
      supplier_reference=excluded.supplier_reference,document_id=excluded.document_id,
      notes_internal=excluded.notes_internal,confirmed_amount=excluded.confirmed_amount,
      final_amount=excluded.final_amount,
      confirmed_exchange_rate_to_mad=excluded.confirmed_exchange_rate_to_mad,
      final_exchange_rate_to_mad=excluded.final_exchange_rate_to_mad,
      updated_at=statement_timestamp();
  end if;
  select * into q from public.fit_quotes where id=p_quote_id;
  if q.calculation_mode = 'legacy' then
    update public.fit_quote_documents set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'archived',true,'archived_at',statement_timestamp(),'archived_reason','financial_model_updated',
      'replaced_by_version',q.version_number)
      where quote_id=p_quote_id and document_type in ('client_pdf','internal_pdf');
    insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
      values(p_quote_id,q.partner_organization_id,v_actor,'fit_financial_model_saved',jsonb_build_object('previous_revision',p_expected_revision,'mode','legacy'));
    return jsonb_build_object('quote_id',p_quote_id,'financial_revision',
      (select financial_revision from public.fit_quotes where id=p_quote_id),'client_link_revoked',true);
  end if;
  v_step := case q.rounding_rule when 'hundred' then 100 when 'ten' then 10 else 1 end;
  for v_day_id in select id from public.fit_quote_days where quote_id=p_quote_id order by sort_order,id loop
    select coalesce(sum(l.subtotal_mad),0),
      coalesce(sum(l.subtotal_mad) filter (where l.cost_owner='japan_supplier_managed'),0),
      count(*) filter (where l.cost_owner is null and l.subtotal_mad>0)
      into v_day_ground,v_day_managed,v_count
    from public.fit_quote_day_cost_lines l where l.day_id=v_day_id
      and l.included_in_calculation is distinct from false and l.cost_role='supplier_cost' and l.category<>'agency_fee';
    if v_count>0 then raise exception 'unclassified_financial_cost'; end if;
    select round(v_day_managed*coalesce(d.japan_agency_fee_rate_override,q.japan_agency_fee_rate)/(100*v_step))*v_step
      into v_day_fee from public.fit_quote_days d where d.id=v_day_id;
    update public.fit_quote_days set cost_mad=v_day_ground,calculated_ground_cost=v_day_ground,
      japan_fee_eligible_base_mad=v_day_managed,calculated_japan_agency_fee=v_day_fee,
      calculated_project_cost=v_day_ground+v_day_fee where id=v_day_id;
    v_program_cost:=v_program_cost+v_day_ground;
    v_program_project:=v_program_project+v_day_ground+v_day_fee;
  end loop;
  select coalesce(sum(total_mad),0),coalesce(sum(total_mad) filter (where cost_owner='japan_supplier_managed'),0),
    count(*) filter (where cost_owner is null and total_mad>0)
    into v_special_cost,v_other_managed,v_count
  from public.fit_quote_cost_lines where quote_id=p_quote_id and included_in_calculation is distinct from false
    and cost_role='supplier_cost' and category<>'agency_fee';
  if v_count>0 then raise exception 'unclassified_financial_cost'; end if;
  select coalesce(sum(subtotal_mad),0),coalesce(sum(subtotal_mad) filter (where cost_owner='japan_supplier_managed'),0),
    count(*) filter (where cost_owner is null and subtotal_mad>0)
    into v_hotel_cost,v_day_managed,v_count from public.fit_quote_hotel_lines where quote_id=p_quote_id;
  if v_count>0 then raise exception 'unclassified_financial_cost'; end if;
  v_other_managed:=v_other_managed+v_day_managed;
  select coalesce(sum(subtotal_mad),0),coalesce(sum(subtotal_mad) filter (where cost_owner='japan_supplier_managed'),0),
    count(*) filter (where cost_owner is null and subtotal_mad>0)
    into v_flight_cost,v_day_managed,v_count from public.fit_quote_flight_lines
    where quote_id=p_quote_id and status='included';
  if v_count>0 then raise exception 'unclassified_financial_cost'; end if;
  v_other_managed:=v_other_managed+v_day_managed;
  v_ground:=v_program_cost+v_special_cost+v_hotel_cost+v_flight_cost;
  v_japan_fee:=v_program_project-v_program_cost+round(v_other_managed*q.japan_agency_fee_rate/(100*v_step))*v_step;
  v_project:=v_ground+v_japan_fee;
  v_markup_base:=case q.margin_scope when 'all' then v_project
    when 'program_hotels_flights' then v_program_project+v_hotel_cost+v_flight_cost
    when 'program_hotels' then v_program_project+v_hotel_cost
    else v_program_project end;
  v_markup:=round(v_markup_base*q.lejapon_margin_rate/(100*v_step))*v_step;
  v_sale:=greatest(0,round((v_project+v_markup+q.manual_adjustment_mad-q.discount_mad)/v_step)*v_step);
  update public.fit_quotes set total_cost_mad=v_ground,ground_cost_total_mad=v_ground,
    japan_agency_fee_total_mad=v_japan_fee,project_cost_total_mad=v_project,
    total_selling_price_mad=v_sale,margin_amount_mad=v_sale-v_project,
    margin_percent=case when v_sale>0 then 100*(v_sale-v_project)/v_sale else 0 end,
    price_per_person_mad=v_sale/greatest(1,q.travelers_count),hotel_total_mad=v_hotel_cost,
    hotel_cost_mad=v_hotel_cost,flight_cost_mad=v_flight_cost,
    financial_scope_review_required=false where id=p_quote_id;
  update public.fit_quote_documents set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'archived',true,'archived_at',statement_timestamp(),'archived_reason','financial_model_updated',
    'replaced_by_version',q.version_number)
    where quote_id=p_quote_id and document_type in ('client_pdf','internal_pdf');
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
    values(p_quote_id,q.partner_organization_id,v_actor,'fit_financial_model_saved',
      jsonb_build_object('previous_revision',p_expected_revision,'estimated_project_cost_mad',v_project,
        'estimated_japan_handling_mad',v_japan_fee,'supplier_quote_present',
        exists(select 1 from public.fit_japan_supplier_quote_totals where quote_id=p_quote_id)));
  return jsonb_build_object('quote_id',p_quote_id,'financial_revision',
    (select financial_revision from public.fit_quotes where id=p_quote_id),'estimated_project_cost_mad',v_project,
    'estimated_selling_price_mad',v_sale,'client_link_revoked',true);
end $$;
revoke all on function public.save_fit_financial_model_v1(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.save_fit_financial_model_v1(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Global supplier quote supersedes Japan-managed daily estimates at QUOTED.
-- These definitions replace the earlier line-level draft implementations in
-- this same, unapplied migration; no historical row is updated.
create or replace function public._fit_supplier_cost_digest_v1(p_quote_id uuid)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select md5(concat_ws('|',q.project_cost_total_mad,q.total_selling_price_mad,
    q.japan_agency_fee_rate,
    s.supplier_id,s.quoted_amount,s.currency,s.exchange_rate_to_mad,s.handling_mode,
    s.handling_rate,s.confirmed_amount,s.final_amount,
    s.confirmed_exchange_rate_to_mad,s.final_exchange_rate_to_mad,
    (select md5(coalesce(string_agg(x.source || ':' || x.id::text || ':' || x.quoted::text || ':' || x.confirmed::text || ':' || x.final::text,'|' order by x.source,x.id),''))
     from (
       select 'day' source,id,supplier_quoted_cost quoted,confirmed_cost confirmed,final_cost final from public.fit_quote_day_cost_lines where quote_id=p_quote_id and cost_owner='lejapon_direct'
       union all select 'other',id,supplier_quoted_cost,confirmed_cost,final_cost from public.fit_quote_cost_lines where quote_id=p_quote_id and cost_owner='lejapon_direct'
       union all select 'hotel',id,supplier_quoted_cost,confirmed_cost,final_cost from public.fit_quote_hotel_lines where quote_id=p_quote_id and cost_owner='lejapon_direct'
       union all select 'flight',id,supplier_quoted_cost,confirmed_cost,final_cost from public.fit_quote_flight_lines where quote_id=p_quote_id and cost_owner='lejapon_direct'
     ) x)))
  from public.fit_quotes q left join public.fit_japan_supplier_quote_totals s on s.quote_id=q.id
  where q.id=p_quote_id
$$;
revoke all on function public._fit_supplier_cost_digest_v1(uuid) from public, anon, authenticated;

create or replace function public.get_fit_supplier_reconciliation_status_v1(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare q public.fit_quotes%rowtype; s public.fit_japan_supplier_quote_totals%rowtype;
  v_managed_base numeric := 0; v_estimated numeric; v_quoted numeric; v_variance numeric;
begin
  if auth.uid() is null or not public.can_access_fit_quote(p_quote_id,auth.uid())
     or not public.can_view_fit_internal_costs(auth.uid()) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id;
  if not found then raise exception 'fit_quote_not_found'; end if;
  select * into s from public.fit_japan_supplier_quote_totals where quote_id=p_quote_id;
  select coalesce(sum(x.amount),0) into v_managed_base from (
    select subtotal_mad amount from public.fit_quote_day_cost_lines where quote_id=p_quote_id and included_in_calculation is distinct from false and cost_role='supplier_cost' and cost_owner='japan_supplier_managed'
    union all select total_mad from public.fit_quote_cost_lines where quote_id=p_quote_id and included_in_calculation is distinct from false and cost_role='supplier_cost' and cost_owner='japan_supplier_managed'
    union all select subtotal_mad from public.fit_quote_hotel_lines where quote_id=p_quote_id and cost_owner='japan_supplier_managed'
    union all select subtotal_mad from public.fit_quote_flight_lines where quote_id=p_quote_id and status='included' and cost_owner='japan_supplier_managed'
  ) x;
  v_estimated:=v_managed_base+q.japan_agency_fee_total_mad;
  v_quoted:=case when s.id is null then null else s.quoted_amount*s.exchange_rate_to_mad *
    (case when s.handling_mode='separate' then 1+s.handling_rate/100 else 1 end) end;
  v_variance:=v_quoted-v_estimated;
  return jsonb_build_object('quoted_line_count',case when s.id is null then 0 else 1 end,
    'estimated_quoted_scope_mad',v_estimated,'supplier_quoted_scope_mad',v_quoted,
    'variance_mad',v_variance,'variance_percent',case when v_estimated>0 then 100*v_variance/v_estimated else null end,
    'project_cost_after_supplier_quote_mad',case when s.id is null then null else q.project_cost_total_mad+v_variance end,
    'gross_margin_after_supplier_quote_mad',case when s.id is null then null else q.total_selling_price_mad-q.project_cost_total_mad-v_variance end,
    'gross_margin_rate_after_supplier_quote',case when s.id is not null and q.total_selling_price_mad>0 then
      round(100*(q.total_selling_price_mad-q.project_cost_total_mad-v_variance)/q.total_selling_price_mad,2) else null end,
    'significant_variance',case when v_variance is null then false else
      abs(v_variance)>=1000 or (v_estimated>0 and abs(v_variance/v_estimated)>=0.05) end,
    'reconciled',s.id is null or (q.supplier_cost_reconciled_at is not null and
      q.supplier_cost_reconciliation_digest=public._fit_supplier_cost_digest_v1(p_quote_id)),
    'reconciled_at',q.supplier_cost_reconciled_at);
end $$;
revoke all on function public.get_fit_supplier_reconciliation_status_v1(uuid) from public, anon;
grant execute on function public.get_fit_supplier_reconciliation_status_v1(uuid) to authenticated;

create or replace function public.reconcile_fit_supplier_costs_v1(p_quote_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid:=auth.uid(); v_status jsonb;
begin
  if v_actor is null or not public.can_access_fit_quote(p_quote_id,v_actor)
     or not public.can_view_fit_internal_costs(v_actor) then raise exception 'not authorized'; end if;
  if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'reconciliation_reason_required'; end if;
  perform 1 from public.fit_quotes where id=p_quote_id for update;
  if not exists(select 1 from public.fit_japan_supplier_quote_totals where quote_id=p_quote_id) then
    raise exception 'no_global_supplier_quote_to_reconcile';
  end if;
  update public.fit_quotes set supplier_cost_reconciled_at=statement_timestamp(),
    supplier_cost_reconciled_by=v_actor,supplier_cost_reconciliation_reason=btrim(p_reason),
    supplier_cost_reconciliation_digest=public._fit_supplier_cost_digest_v1(p_quote_id)
    where id=p_quote_id;
  v_status:=public.get_fit_supplier_reconciliation_status_v1(p_quote_id);
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
    select p_quote_id,partner_organization_id,v_actor,'fit_supplier_quote_reconciled',
      jsonb_build_object('reason',btrim(p_reason),'variance_mad',v_status->'variance_mad')
    from public.fit_quotes where id=p_quote_id;
  return v_status;
end $$;
revoke all on function public.reconcile_fit_supplier_costs_v1(uuid,text) from public, anon;
grant execute on function public.reconcile_fit_supplier_costs_v1(uuid,text) to authenticated;

create or replace function public._fit_financial_integrity_issue_v1(p_quote_id uuid)
returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare q public.fit_quotes%rowtype; v_base numeric:=0; v_expected numeric:=0;
  v_day public.fit_quote_days%rowtype; v_other_base numeric:=0; v_missing integer:=0; v_step numeric;
  v_line_base numeric; v_line_ground numeric; v_ground_total numeric;
begin
  select * into q from public.fit_quotes where id=p_quote_id;
  if not found then return 'fit_quote_not_found'; end if;
  if q.calculation_mode <> 'automatic_v2' then return null; end if;
  if q.financial_scope_review_required then return 'financial_scope_review_required'; end if;
  v_step:=case q.rounding_rule when 'hundred' then 100 when 'ten' then 10 else 1 end;
  for v_day in select * from public.fit_quote_days where quote_id=p_quote_id loop
    select coalesce(sum(subtotal_mad) filter (where cost_owner='japan_supplier_managed'),0),
      coalesce(sum(subtotal_mad),0) into v_line_base,v_line_ground
      from public.fit_quote_day_cost_lines where day_id=v_day.id
        and included_in_calculation is distinct from false and cost_role='supplier_cost' and category<>'agency_fee';
    if abs(v_line_base-coalesce(v_day.japan_fee_eligible_base_mad,0))>0.01
       or abs(v_line_ground-coalesce(v_day.calculated_ground_cost,0))>0.01 then
      return 'day_cost_scope_or_total_mismatch';
    end if;
    if v_day.japan_agency_fee_rate_override=0 and v_day.japan_fee_eligible_base_mad>0
       and (nullif(btrim(v_day.japan_agency_fee_exemption_reason),'') is null
         or v_day.japan_agency_fee_exempted_by is null or v_day.japan_agency_fee_exempted_at is null) then
      return 'japan_fee_unjustified_zero_override';
    end if;
    v_base:=v_base+coalesce(v_day.japan_fee_eligible_base_mad,0);
    v_expected:=v_expected+round(coalesce(v_day.japan_fee_eligible_base_mad,0)*
      coalesce(v_day.japan_agency_fee_rate_override,q.japan_agency_fee_rate)/(100*v_step))*v_step;
    if abs(coalesce(v_day.calculated_japan_agency_fee,0)-round(coalesce(v_day.japan_fee_eligible_base_mad,0)*
      coalesce(v_day.japan_agency_fee_rate_override,q.japan_agency_fee_rate)/(100*v_step))*v_step)>0.01 then
      return 'japan_fee_calculation_mismatch';
    end if;
  end loop;
  select coalesce(sum(x.amount),0),coalesce(sum(x.missing),0) into v_other_base,v_missing from (
    select total_mad amount,case when cost_owner is null and total_mad>0 then 1 else 0 end missing
      from public.fit_quote_cost_lines where quote_id=p_quote_id and included_in_calculation is distinct from false and cost_role='supplier_cost' and category<>'agency_fee' and cost_owner='japan_supplier_managed'
    union all select subtotal_mad,case when cost_owner is null and subtotal_mad>0 then 1 else 0 end
      from public.fit_quote_hotel_lines where quote_id=p_quote_id and cost_owner='japan_supplier_managed'
    union all select subtotal_mad,case when cost_owner is null and subtotal_mad>0 then 1 else 0 end
      from public.fit_quote_flight_lines where quote_id=p_quote_id and status='included' and cost_owner='japan_supplier_managed'
  ) x;
  select v_missing+count(*) into v_missing from (
    select 1 from public.fit_quote_day_cost_lines where quote_id=p_quote_id and included_in_calculation is distinct from false and cost_role='supplier_cost' and category<>'agency_fee' and cost_owner is null and subtotal_mad>0
    union all select 1 from public.fit_quote_cost_lines where quote_id=p_quote_id and included_in_calculation is distinct from false and cost_role='supplier_cost' and category<>'agency_fee' and cost_owner is null and total_mad>0
    union all select 1 from public.fit_quote_hotel_lines where quote_id=p_quote_id and cost_owner is null and subtotal_mad>0
    union all select 1 from public.fit_quote_flight_lines where quote_id=p_quote_id and status='included' and cost_owner is null and subtotal_mad>0
  ) missing_rows;
  if v_missing>0 then return 'unclassified_cost_scope'; end if;
  select coalesce(sum(x.amount),0) into v_ground_total from (
    select calculated_ground_cost amount from public.fit_quote_days where quote_id=p_quote_id
    union all select total_mad from public.fit_quote_cost_lines where quote_id=p_quote_id and included_in_calculation is distinct from false and cost_role='supplier_cost' and category<>'agency_fee'
    union all select subtotal_mad from public.fit_quote_hotel_lines where quote_id=p_quote_id
    union all select subtotal_mad from public.fit_quote_flight_lines where quote_id=p_quote_id and status='included'
  ) x;
  if abs(v_ground_total-q.ground_cost_total_mad)>0.01 then return 'ground_cost_total_mismatch'; end if;
  v_expected:=v_expected+round(v_other_base*q.japan_agency_fee_rate/(100*v_step))*v_step;
  if abs(v_expected-q.japan_agency_fee_total_mad)>0.01 then return 'japan_fee_calculation_mismatch'; end if;
  if q.japan_agency_fee_rate>0 and v_base+v_other_base>0 and v_expected>0 and q.japan_agency_fee_total_mad=0 then
    return 'japan_fee_not_applied';
  end if;
  if abs(q.project_cost_total_mad-q.ground_cost_total_mad-q.japan_agency_fee_total_mad)>0.01 then
    return 'project_cost_does_not_include_japan_fee';
  end if;
  if exists(select 1 from public.fit_japan_supplier_quote_totals where quote_id=p_quote_id) and
     (q.supplier_cost_reconciled_at is null or q.supplier_cost_reconciliation_digest is distinct from
      public._fit_supplier_cost_digest_v1(p_quote_id)) then return 'supplier_cost_not_reconciled'; end if;
  return null;
end $$;
revoke all on function public._fit_financial_integrity_issue_v1(uuid) from public, anon, authenticated;

create or replace function public.assert_fit_quote_financial_integrity_v1(p_quote_id uuid)
returns void language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_issue text;
begin
  if auth.uid() is null or not public.can_access_fit_quote(p_quote_id,auth.uid())
     or not public.can_view_fit_internal_costs(auth.uid()) then raise exception 'not authorized'; end if;
  v_issue:=public._fit_financial_integrity_issue_v1(p_quote_id);
  if v_issue is not null then raise exception 'FINANCIAL INTEGRITY ERROR: %',v_issue; end if;
end $$;
revoke all on function public.assert_fit_quote_financial_integrity_v1(uuid) from public, anon;
grant execute on function public.assert_fit_quote_financial_integrity_v1(uuid) to authenticated;

notify pgrst, 'reload schema';
