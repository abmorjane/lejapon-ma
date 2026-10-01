-- Local PostgreSQL fixture, never point this test at production.
\set ON_ERROR_STOP on
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end$$;
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values('00000000-0000-0000-0000-000000000001');
create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
create table public.organizations(id uuid primary key);
create table public.suppliers(id uuid primary key,name text);
insert into public.suppliers values('00000000-0000-0000-0000-000000000002','Japan DMC');
create table public.fit_quotes(
  id uuid primary key,calculation_mode text default 'automatic_v2',
  japan_agency_fee_rate numeric default 10,lejapon_margin_rate numeric default 20,
  margin_scope text default 'all',rounding_rule text default 'unit',
  ground_cost_total_mad numeric default 0,japan_agency_fee_total_mad numeric default 0,
  project_cost_total_mad numeric default 0,total_selling_price_mad numeric default 0,
  total_cost_mad numeric default 0,margin_amount_mad numeric default 0,margin_percent numeric default 0,
  price_per_person_mad numeric default 0,hotel_total_mad numeric default 0,
  hotel_cost_mad numeric default 0,flight_cost_mad numeric default 0,
  manual_adjustment_mad numeric default 0,discount_mad numeric default 0,
  travelers_count integer default 2,share_enabled boolean default false,
  public_client_visible boolean default false,public_link_revoked_at timestamptz,
  commercial_status text default 'draft',status text default 'draft',production_status text default 'draft',
  duplicated_from_id uuid,is_current_version boolean default true,version_number integer default 1,
  accepted_snapshot_id uuid,
  partner_organization_id uuid,updated_at timestamptz default now()
);
create table public.fit_quote_documents(id uuid primary key,quote_id uuid references public.fit_quotes(id),document_type text,metadata jsonb default '{}'::jsonb);
create table public.quote_audit_logs(id uuid primary key default gen_random_uuid(),quote_id uuid,organization_id uuid,user_id uuid,action_type text,payload jsonb,created_at timestamptz default now());
create table public.fit_quote_acceptances(id uuid primary key default gen_random_uuid(),quote_id uuid);
create table public.fit_supplier_requests(id uuid primary key default gen_random_uuid(),quote_id uuid);
create table public.fit_quote_public_extra_selections(id uuid primary key default gen_random_uuid(),quote_id uuid);
create table public.fit_quote_day_components(id uuid primary key default gen_random_uuid(),quote_day_id uuid);
create table public.fit_quote_days(
  id uuid primary key default gen_random_uuid(),quote_id uuid references public.fit_quotes(id),
  local_key text,title text not null,sort_order integer default 0,
  japan_agency_fee_rate_override numeric,calculated_ground_cost numeric default 0,
  calculated_japan_agency_fee numeric default 0,calculated_project_cost numeric default 0,
  cost_mad numeric default 0
);
create table public.fit_quote_day_cost_lines(
  id uuid primary key default gen_random_uuid(),quote_id uuid references public.fit_quotes(id),
  day_id uuid references public.fit_quote_days(id),category text default 'other',label text default '',
  subtotal_mad numeric default 0,included_in_calculation boolean default true,
  cost_role text default 'supplier_cost',supplier_quoted_cost numeric,confirmed_cost numeric,final_cost numeric
);
create table public.fit_quote_cost_lines(
  id uuid primary key default gen_random_uuid(),quote_id uuid references public.fit_quotes(id),
  total_mad numeric default 0,included_in_calculation boolean default true,cost_role text default 'supplier_cost',
  category text default 'other',supplier_quoted_cost numeric,confirmed_cost numeric,final_cost numeric
);
create table public.fit_quote_hotel_lines(
  id uuid primary key default gen_random_uuid(),quote_id uuid references public.fit_quotes(id),
  subtotal_mad numeric default 0,supplier_quoted_cost numeric,confirmed_cost numeric,final_cost numeric
);
create table public.fit_quote_flight_lines(
  id uuid primary key default gen_random_uuid(),quote_id uuid references public.fit_quotes(id),
  subtotal_mad numeric default 0,status text default 'included',supplier_quoted_cost numeric,confirmed_cost numeric,final_cost numeric
);
create function public.can_access_fit_quote(uuid,uuid) returns boolean language sql as $$select true$$;
create function public.can_view_fit_internal_costs(uuid) returns boolean language sql as $$select true$$;
create function public._fit_financial_components_v4(uuid) returns table(
  source_type text,source_id uuid,estimated_cost numeric,supplier_quoted_cost numeric,currency text,exchange_rate numeric
) language sql as $$select null::text,null::uuid,null::numeric,null::numeric,null::text,null::numeric where false$$;

-- An existing historic 0% must not be backfilled or rewritten by the migration.
insert into public.fit_quotes(id) values('00000000-0000-0000-0000-000000000010');
insert into public.fit_quote_days(quote_id,local_key,title,japan_agency_fee_rate_override)
values('00000000-0000-0000-0000-000000000010','historic','Old',0);
\ir ../migrations/20260929190000_fit_financial_integrity_japan_fee_v1.sql
do $$begin
  if not (select relrowsecurity from pg_class where oid='public.fit_japan_supplier_quote_totals'::regclass)
     or has_table_privilege('anon','public.fit_japan_supplier_quote_totals','SELECT')
     or not has_table_privilege('authenticated','public.fit_japan_supplier_quote_totals','SELECT')
     or has_function_privilege('anon','public.save_fit_financial_model_v1(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.save_fit_financial_model_v1(uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') then
    raise exception 'fit_financial_permissions_or_rls_invalid';
  end if;
  if (select japan_agency_fee_rate_override from public.fit_quote_days where local_key='historic') is distinct from 0 then
    raise exception 'historical_zero_changed';
  end if;
end$$;

insert into public.fit_quotes(id,duplicated_from_id)
values('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000010');
insert into public.fit_quote_days(quote_id,local_key,title,japan_agency_fee_rate_override,calculated_ground_cost)
values('00000000-0000-0000-0000-000000000014','copy','Copied historical day',0,10000);
do $$begin
  if (select japan_agency_fee_rate_override from public.fit_quote_days where local_key='copy') is not null
     or not (select financial_scope_review_required from public.fit_quotes where id='00000000-0000-0000-0000-000000000014') then
    raise exception 'historical_copy_not_review_required';
  end if;
end$$;

insert into public.fit_quotes(id,share_enabled,public_client_visible)
values('00000000-0000-0000-0000-000000000011',true,true);
select public.save_fit_financial_model_v1(
  '00000000-0000-0000-0000-000000000011',0,'{}',
  '[{"local_key":"d1","title":"Tokyo","japan_agency_fee_rate_override":null}]',
  '[{"day_local_key":"d1","category":"transport","label":"Train","subtotal_mad":50000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed","included_in_calculation":true}]',
  '[]','[{"subtotal_mad":10000,"cost_owner":"lejapon_direct"}]','[]',null);
do $$declare q public.fit_quotes%rowtype; begin
  select * into q from public.fit_quotes where id='00000000-0000-0000-0000-000000000011';
  if q.japan_agency_fee_total_mad<>5000 or q.project_cost_total_mad<>65000
     or q.total_selling_price_mad<>78000 or q.share_enabled or q.financial_revision<=0 then
    raise exception 'estimate_or_atomic_link_failed';
  end if;
end$$;

-- A stale editor cannot overwrite a newer revision.
do $$begin
  begin
    perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000011',0,'{}','[]','[]','[]','[]','[]',null);
    raise exception 'conflict_not_detected';
  exception when sqlstate '40001' then null;
  end;
end$$;

-- A bad child row rolls back the parent and children in the same transaction.
update public.fit_quotes set share_enabled=true,public_client_visible=true
where id='00000000-0000-0000-0000-000000000011';
do $$declare v_revision bigint;begin
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000011';
  begin
    perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000011',v_revision,'{}',
      '[{"local_key":"d2","title":"Kyoto"}]',
      '[{"day_local_key":"d2","subtotal_mad":3000,"cost_role":"supplier_cost","cost_owner":"invalid"}]',
      '[]','[]','[]',null);
    raise exception 'invalid_scope_accepted';
  exception when check_violation then null;
  end;
  if not (select share_enabled from public.fit_quotes where id='00000000-0000-0000-0000-000000000011')
     or (select count(*) from public.fit_quote_days where quote_id='00000000-0000-0000-0000-000000000011')<>1 then
    raise exception 'rollback_failed';
  end if;
end$$;

-- Included handling: the actual supplier quote replaces 55,000 estimated,
-- never 56,000 + another 10%. Direct hotel costs remain outside the base.
do $$declare v_revision bigint; v_status jsonb;begin
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000011';
  perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000011',v_revision,'{}',
    '[{"local_key":"d1","title":"Tokyo"}]',
    '[{"day_local_key":"d1","category":"transport","label":"Train","subtotal_mad":50000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed"}]',
    '[]','[{"subtotal_mad":10000,"cost_owner":"lejapon_direct"}]','[]',
    '{"supplier_id":"00000000-0000-0000-0000-000000000002","quoted_amount":56000,"currency":"MAD","exchange_rate_to_mad":1,"handling_mode":"included","handling_rate":null,"quoted_at":"2026-10-01"}');
  v_status:=public.get_fit_supplier_reconciliation_status_v1('00000000-0000-0000-0000-000000000011');
  if (v_status->>'supplier_quoted_scope_mad')::numeric<>56000
    or (v_status->>'estimated_quoted_scope_mad')::numeric<>55000
    or (v_status->>'project_cost_after_supplier_quote_mad')::numeric<>66000
    or (select project_cost_total_mad from public.fit_quotes where id='00000000-0000-0000-0000-000000000011')<>65000 then
    raise exception 'global_quote_double_counted';
  end if;
  if public._fit_financial_integrity_issue_v1('00000000-0000-0000-0000-000000000011')<>'supplier_cost_not_reconciled' then
    raise exception 'reconciliation_guard_missing';
  end if;
  begin
    update public.fit_quotes set share_enabled=true where id='00000000-0000-0000-0000-000000000011';
    raise exception 'unreconciled_quote_published';
  exception when others then
    if sqlerrm='unreconciled_quote_published' then raise; end if;
  end;
  if (select share_enabled from public.fit_quotes where id='00000000-0000-0000-0000-000000000011') then
    raise exception 'release_guard_did_not_rollback';
  end if;
  perform public.reconcile_fit_supplier_costs_v1('00000000-0000-0000-0000-000000000011','Verified supplier global quote and FX');
  if not (public.get_fit_supplier_reconciliation_status_v1('00000000-0000-0000-0000-000000000011')->>'reconciled')::boolean then
    raise exception 'reconciliation_audit_failed';
  end if;
end$$;

-- Separate handling must be an explicit mode, and invalid 0% must roll back.
do $$declare v_revision bigint; v_status jsonb;begin
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000011';
  perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000011',v_revision,'{}',
    '[{"local_key":"d1","title":"Tokyo"}]',
    '[{"day_local_key":"d1","category":"transport","label":"Train","subtotal_mad":50000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed"}]',
    '[]','[{"subtotal_mad":10000,"cost_owner":"lejapon_direct"}]','[]',
    '{"supplier_id":"00000000-0000-0000-0000-000000000002","quoted_amount":56000,"currency":"MAD","exchange_rate_to_mad":1,"handling_mode":"separate","handling_rate":10,"quoted_at":"2026-10-01"}');
  v_status:=public.get_fit_supplier_reconciliation_status_v1('00000000-0000-0000-0000-000000000011');
  if (v_status->>'supplier_quoted_scope_mad')::numeric<>61600 then raise exception 'separate_handling_missing'; end if;
end$$;

insert into public.fit_quotes(id) values('00000000-0000-0000-0000-000000000012');
do $$declare v_revision bigint;begin
  perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000012',0,'{}',
    '[{"local_key":"exempt","title":"Direct","japan_agency_fee_rate_override":0,"japan_agency_fee_exemption_reason":"DMC commission already included"}]',
    '[{"day_local_key":"exempt","category":"transport","subtotal_mad":50000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed"}]',
    '[]','[]','[]',null);
  if (select japan_agency_fee_total_mad from public.fit_quotes where id='00000000-0000-0000-0000-000000000012')<>0
    or (select japan_agency_fee_exempted_by from public.fit_quote_days where quote_id='00000000-0000-0000-0000-000000000012') is null then
    raise exception 'explicit_zero_not_audited';
  end if;
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000012';
  begin
    perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000012',v_revision,'{}',
      '[{"local_key":"bad","title":"Unjustified","japan_agency_fee_rate_override":0}]',
      '[{"day_local_key":"bad","subtotal_mad":50000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed"}]',
      '[]','[]','[]',null);
    raise exception 'unjustified_zero_accepted';
  exception when others then
    if sqlerrm='unjustified_zero_accepted' then raise; end if;
  end;
  if (select count(*) from public.fit_quote_days where quote_id='00000000-0000-0000-0000-000000000012')<>1 then
    raise exception 'zero_failure_not_rolled_back';
  end if;
end$$;

-- A populated procurement workflow must not be destroyed by row recreation.
insert into public.fit_supplier_requests(quote_id) values('00000000-0000-0000-0000-000000000012');
do $$declare v_revision bigint;begin
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000012';
  begin
    perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000012',v_revision,'{}','[]','[]','[]','[]','[]',null);
    raise exception 'dependent_records_deleted';
  exception when others then
    if sqlerrm='dependent_records_deleted' then raise; end if;
    if sqlerrm<>'dependent_fit_records_require_new_version' then raise; end if;
  end;
  if (select count(*) from public.fit_quote_days where quote_id='00000000-0000-0000-0000-000000000012')<>1 then
    raise exception 'dependency_guard_failed';
  end if;
end$$;

-- Acceptance scenario: 100,000 Japan-managed + 20,000 direct, 10% handling,
-- 20% markup. A global included quote replaces the estimated Japan total;
-- an explicit separate quote adds handling exactly once.
insert into public.fit_quotes(id) values('00000000-0000-0000-0000-000000000013');
do $$declare v_revision bigint; v_status jsonb; begin
  perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000013',0,'{}',
    '[{"local_key":"test-day","title":"Tokyo","japan_agency_fee_rate_override":null}]',
    '[{"day_local_key":"test-day","category":"transport","label":"Japan-managed","subtotal_mad":100000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed"}]',
    '[{"category":"other","total_mad":20000,"cost_role":"supplier_cost","cost_owner":"lejapon_direct"}]',
    '[]','[]',null);
  if (select japan_agency_fee_total_mad<>10000 or project_cost_total_mad<>130000
      or total_selling_price_mad<>156000 or margin_amount_mad<>26000
      or abs(margin_percent-16.6666666667)>0.0001
      from public.fit_quotes where id='00000000-0000-0000-0000-000000000013') then
    raise exception 'acceptance_estimate_wrong';
  end if;
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000013';
  perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000013',v_revision,'{}',
    '[{"local_key":"test-day","title":"Tokyo"}]',
    '[{"day_local_key":"test-day","category":"transport","label":"Japan-managed","subtotal_mad":100000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed"}]',
    '[{"category":"other","total_mad":20000,"cost_role":"supplier_cost","cost_owner":"lejapon_direct"}]',
    '[]','[]',
    '{"supplier_id":"00000000-0000-0000-0000-000000000002","quoted_amount":108000,"currency":"MAD","exchange_rate_to_mad":1,"handling_mode":"included","quoted_at":"2026-10-01"}');
  v_status:=public.get_fit_supplier_reconciliation_status_v1('00000000-0000-0000-0000-000000000013');
  if (v_status->>'supplier_quoted_scope_mad')::numeric<>108000
     or (v_status->>'estimated_quoted_scope_mad')::numeric<>110000
     or (v_status->>'variance_mad')::numeric<>-2000
     or (v_status->>'project_cost_after_supplier_quote_mad')::numeric<>128000 then
    raise exception 'acceptance_included_quote_wrong';
  end if;
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000013';
  perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000013',v_revision,'{}',
    '[{"local_key":"test-day","title":"Tokyo"}]',
    '[{"day_local_key":"test-day","category":"transport","label":"Japan-managed","subtotal_mad":100000,"cost_role":"supplier_cost","cost_owner":"japan_supplier_managed"}]',
    '[{"category":"other","total_mad":20000,"cost_role":"supplier_cost","cost_owner":"lejapon_direct"}]',
    '[]','[]',
    '{"supplier_id":"00000000-0000-0000-0000-000000000002","quoted_amount":100000,"currency":"MAD","exchange_rate_to_mad":1,"handling_mode":"separate","handling_rate":10,"quoted_at":"2026-10-01"}');
  v_status:=public.get_fit_supplier_reconciliation_status_v1('00000000-0000-0000-0000-000000000013');
  if (v_status->>'supplier_quoted_scope_mad')::numeric<>110000
     or (v_status->>'project_cost_after_supplier_quote_mad')::numeric<>130000 then
    raise exception 'acceptance_separate_quote_wrong';
  end if;
end$$;

-- Accepted versions are immutable even when the submitted edit leaves the
-- numeric totals unchanged; child rows must not be silently recreated.
update public.fit_quotes set accepted_snapshot_id='00000000-0000-0000-0000-000000000099'
where id='00000000-0000-0000-0000-000000000013';
do $$declare v_revision bigint; v_old_day uuid; begin
  select financial_revision into v_revision from public.fit_quotes where id='00000000-0000-0000-0000-000000000013';
  select id into v_old_day from public.fit_quote_days where quote_id='00000000-0000-0000-0000-000000000013';
  begin
    perform public.save_fit_financial_model_v1('00000000-0000-0000-0000-000000000013',v_revision,'{}',
      '[{"local_key":"test-day","title":"Edited Tokyo"}]','[]','[]','[]','[]',null);
    raise exception 'accepted_version_changed';
  exception when others then
    if sqlerrm='accepted_version_changed' then raise; end if;
    if sqlerrm<>'accepted_fit_version_read_only' then raise; end if;
  end;
  if (select id from public.fit_quote_days where quote_id='00000000-0000-0000-0000-000000000013') is distinct from v_old_day then
    raise exception 'accepted_version_child_changed';
  end if;
end$$;
