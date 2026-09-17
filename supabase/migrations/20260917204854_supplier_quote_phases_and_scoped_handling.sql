-- Audited against the read-only production export dated 2026-09-17T20:47:12Z.
-- No existing quote/row is rewritten by this migration. Repaired row RLS and public trips policies are untouched.
-- PostgreSQL numeric rounding: handling is rounded to two decimal places.


DO $preflight$ BEGIN
  if to_regprocedure('public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb)') is null or md5(pg_get_functiondef('public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb)'::regprocedure)) <> 'a46f1febaeff00273f60e90322063430' then raise exception 'Schema drift: public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.recalculate_supplier_quote_totals_v2(uuid)') is null or md5(pg_get_functiondef('public.recalculate_supplier_quote_totals_v2(uuid)'::regprocedure)) <> 'b9bad4fe6b4d9a1e135b054867888f98' then raise exception 'Schema drift: public.recalculate_supplier_quote_totals_v2(uuid); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.create_supplier_quote_version_v2(uuid)') is null or md5(pg_get_functiondef('public.create_supplier_quote_version_v2(uuid)'::regprocedure)) <> '44c225fe7cf8b4b5e619164a3d244737' then raise exception 'Schema drift: public.create_supplier_quote_version_v2(uuid); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb)') is null or md5(pg_get_functiondef('public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb)'::regprocedure)) <> '6d42f635088a7779f7972ccf66fb9336' then raise exception 'Schema drift: public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.get_supplier_trip_quote(uuid,uuid)') is null or md5(pg_get_functiondef('public.get_supplier_trip_quote(uuid,uuid)'::regprocedure)) <> '1b3193cbf473f2afe63168f05a69e874' then raise exception 'Schema drift: public.get_supplier_trip_quote(uuid,uuid); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.get_supplier_quote_version_v2(uuid)') is null or md5(pg_get_functiondef('public.get_supplier_quote_version_v2(uuid)'::regprocedure)) <> 'dfcf69dbf1d6a66cf3013f0a939ad055' then raise exception 'Schema drift: public.get_supplier_quote_version_v2(uuid); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.get_supplier_quote_versions_v2(uuid,uuid)') is null or md5(pg_get_functiondef('public.get_supplier_quote_versions_v2(uuid,uuid)'::regprocedure)) <> '8cfe149db363c02e601a10e7765a4420' then raise exception 'Schema drift: public.get_supplier_quote_versions_v2(uuid,uuid); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.review_supplier_quote_v2(uuid,text,text)') is null or md5(pg_get_functiondef('public.review_supplier_quote_v2(uuid,text,text)'::regprocedure)) <> '2afdcef99f1153fd0e4b71f38ce43a42' then raise exception 'Schema drift: public.review_supplier_quote_v2(uuid,text,text); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric)') is null or md5(pg_get_functiondef('public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric)'::regprocedure)) <> '1dc131c8caad4593bf158251eca470e5' then raise exception 'Schema drift: public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric)') is null or md5(pg_get_functiondef('public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric)'::regprocedure)) <> '11759cdd80ef1c87e9d8a19e3c29d4e0' then raise exception 'Schema drift: public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric); repeat supplier audit before applying'; end if;
  if to_regprocedure('public.sync_supplier_quote_assignment()') is null or md5(pg_get_functiondef('public.sync_supplier_quote_assignment()'::regprocedure)) <> 'e3dc5dd65b5227149ec471916a4340a4' then raise exception 'Schema drift: public.sync_supplier_quote_assignment(); repeat supplier audit before applying'; end if;
  if md5(pg_get_functiondef('public.is_staff(uuid)'::regprocedure)) <> 'daa8783aca92ba56218de893e66e29f9' then raise exception 'Authorization helper drift: is_staff; repeat supplier audit'; end if;
  if md5(pg_get_functiondef('public.supplier_can_access_quote(uuid,uuid,boolean)'::regprocedure)) <> '0f8992dc64df3998b8ba5f37d6f29de3' then raise exception 'Authorization helper drift: supplier_can_access_quote; repeat supplier audit'; end if;
  if md5(pg_get_functiondef('public.supplier_can_access_trip(uuid,uuid)'::regprocedure)) <> '3dc5b610db4bd690ab9d7d772cf00e47' then raise exception 'Authorization helper drift: supplier_can_access_trip; repeat supplier audit'; end if;
  if md5(pg_get_functiondef('public.supplier_can_edit_trip(uuid,uuid)'::regprocedure)) <> 'bf800ac67292856513e4107f93023bee' then raise exception 'Authorization helper drift: supplier_can_edit_trip; repeat supplier audit'; end if;
  if md5(pg_get_functiondef('public.user_supplier_ids(uuid)'::regprocedure)) <> 'cf883814c29403fd0a6a031b47b880b0' then raise exception 'Authorization helper drift: user_supplier_ids; repeat supplier audit'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='supplier_trip_quotes') <> 5 then raise exception 'Policy drift: supplier_trip_quotes; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_trip_quotes' and policyname='staff manage supplier_trip_quotes' and cmd='ALL' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'is_staff(( SELECT auth.uid() AS uid))' and with_check is not distinct from 'is_staff(( SELECT auth.uid() AS uid))') then raise exception 'Policy definition drift: supplier_trip_quotes; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_trip_quotes' and policyname='supplier_trip_quotes_delete' and cmd='DELETE' and roles=ARRAY['public']::name[] and qual is not distinct from 'v2_is_staff(auth.uid())' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_trip_quotes; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_trip_quotes' and policyname='supplier_trip_quotes_insert' and cmd='INSERT' and roles=ARRAY['public']::name[] and qual is not distinct from NULL and with_check is not distinct from '(v2_is_staff(auth.uid()) OR (supplier_id IN ( SELECT v2_user_supplier_ids(auth.uid()) AS v2_user_supplier_ids)) OR v2_supplier_can_access_trip(auth.uid(), trip_id))') then raise exception 'Policy definition drift: supplier_trip_quotes; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_trip_quotes' and policyname='supplier_trip_quotes_select' and cmd='SELECT' and roles=ARRAY['public']::name[] and qual is not distinct from '(v2_is_staff(auth.uid()) OR (supplier_id IN ( SELECT v2_user_supplier_ids(auth.uid()) AS v2_user_supplier_ids)) OR v2_supplier_can_access_trip(auth.uid(), trip_id))' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_trip_quotes; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_trip_quotes' and policyname='supplier_trip_quotes_update' and cmd='UPDATE' and roles=ARRAY['public']::name[] and qual is not distinct from '(v2_is_staff(auth.uid()) OR (supplier_id IN ( SELECT v2_user_supplier_ids(auth.uid()) AS v2_user_supplier_ids)) OR v2_supplier_can_access_trip(auth.uid(), trip_id))' and with_check is not distinct from '(v2_is_staff(auth.uid()) OR (supplier_id IN ( SELECT v2_user_supplier_ids(auth.uid()) AS v2_user_supplier_ids)) OR v2_supplier_can_access_trip(auth.uid(), trip_id))') then raise exception 'Policy definition drift: supplier_trip_quotes; repeat supplier audit'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='supplier_quote_hotel_rows') <> 5 then raise exception 'Policy drift: supplier_quote_hotel_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_hotel_rows' and policyname='staff manage supplier_quote_hotel_rows v2' and cmd='ALL' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'is_staff(( SELECT auth.uid() AS uid))' and with_check is not distinct from 'is_staff(( SELECT auth.uid() AS uid))') then raise exception 'Policy definition drift: supplier_quote_hotel_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_hotel_rows' and policyname='supplier delete own supplier_quote_hotel_rows v2' and cmd='DELETE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_hotel_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_hotel_rows' and policyname='supplier insert own supplier_quote_hotel_rows v2' and cmd='INSERT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from NULL and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_hotel_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_hotel_rows' and policyname='supplier read own supplier_quote_hotel_rows v2' and cmd='SELECT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, false)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_hotel_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_hotel_rows' and policyname='supplier update own supplier_quote_hotel_rows v2' and cmd='UPDATE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_hotel_rows; repeat supplier audit'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='supplier_quote_transport_rows') <> 5 then raise exception 'Policy drift: supplier_quote_transport_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_transport_rows' and policyname='staff manage supplier_quote_transport_rows v2' and cmd='ALL' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'is_staff(( SELECT auth.uid() AS uid))' and with_check is not distinct from 'is_staff(( SELECT auth.uid() AS uid))') then raise exception 'Policy definition drift: supplier_quote_transport_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_transport_rows' and policyname='supplier delete own supplier_quote_transport_rows v2' and cmd='DELETE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_transport_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_transport_rows' and policyname='supplier insert own supplier_quote_transport_rows v2' and cmd='INSERT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from NULL and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_transport_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_transport_rows' and policyname='supplier read own supplier_quote_transport_rows v2' and cmd='SELECT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, false)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_transport_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_transport_rows' and policyname='supplier update own supplier_quote_transport_rows v2' and cmd='UPDATE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_transport_rows; repeat supplier audit'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='supplier_quote_activity_rows') <> 5 then raise exception 'Policy drift: supplier_quote_activity_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_activity_rows' and policyname='staff manage supplier_quote_activity_rows v2' and cmd='ALL' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'is_staff(( SELECT auth.uid() AS uid))' and with_check is not distinct from 'is_staff(( SELECT auth.uid() AS uid))') then raise exception 'Policy definition drift: supplier_quote_activity_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_activity_rows' and policyname='supplier delete own supplier_quote_activity_rows v2' and cmd='DELETE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_activity_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_activity_rows' and policyname='supplier insert own supplier_quote_activity_rows v2' and cmd='INSERT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from NULL and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_activity_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_activity_rows' and policyname='supplier read own supplier_quote_activity_rows v2' and cmd='SELECT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, false)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_activity_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_activity_rows' and policyname='supplier update own supplier_quote_activity_rows v2' and cmd='UPDATE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_activity_rows; repeat supplier audit'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='supplier_quote_guide_rows') <> 5 then raise exception 'Policy drift: supplier_quote_guide_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_guide_rows' and policyname='staff manage supplier_quote_guide_rows v2' and cmd='ALL' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'is_staff(( SELECT auth.uid() AS uid))' and with_check is not distinct from 'is_staff(( SELECT auth.uid() AS uid))') then raise exception 'Policy definition drift: supplier_quote_guide_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_guide_rows' and policyname='supplier delete own supplier_quote_guide_rows v2' and cmd='DELETE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_guide_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_guide_rows' and policyname='supplier insert own supplier_quote_guide_rows v2' and cmd='INSERT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from NULL and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_guide_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_guide_rows' and policyname='supplier read own supplier_quote_guide_rows v2' and cmd='SELECT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, false)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_guide_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_guide_rows' and policyname='supplier update own supplier_quote_guide_rows v2' and cmd='UPDATE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_guide_rows; repeat supplier audit'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='supplier_quote_other_rows') <> 5 then raise exception 'Policy drift: supplier_quote_other_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_other_rows' and policyname='staff manage supplier_quote_other_rows v2' and cmd='ALL' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'is_staff(( SELECT auth.uid() AS uid))' and with_check is not distinct from 'is_staff(( SELECT auth.uid() AS uid))') then raise exception 'Policy definition drift: supplier_quote_other_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_other_rows' and policyname='supplier delete own supplier_quote_other_rows v2' and cmd='DELETE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_other_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_other_rows' and policyname='supplier insert own supplier_quote_other_rows v2' and cmd='INSERT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from NULL and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_other_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_other_rows' and policyname='supplier read own supplier_quote_other_rows v2' and cmd='SELECT' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, false)' and with_check is not distinct from NULL) then raise exception 'Policy definition drift: supplier_quote_other_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='supplier_quote_other_rows' and policyname='supplier update own supplier_quote_other_rows v2' and cmd='UPDATE' and roles=ARRAY['authenticated']::name[] and qual is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)' and with_check is not distinct from 'supplier_can_access_quote(( SELECT auth.uid() AS uid), quote_id, true)') then raise exception 'Policy definition drift: supplier_quote_other_rows; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE') is distinct from false then raise exception 'Function grant drift: supplier_save_trip_quote_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_save_trip_quote_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_save_trip_quote_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.recalculate_supplier_quote_totals_v2(uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: recalculate_supplier_quote_totals_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.recalculate_supplier_quote_totals_v2(uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: recalculate_supplier_quote_totals_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.recalculate_supplier_quote_totals_v2(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: recalculate_supplier_quote_totals_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.create_supplier_quote_version_v2(uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: create_supplier_quote_version_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.create_supplier_quote_version_v2(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: create_supplier_quote_version_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.create_supplier_quote_version_v2(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: create_supplier_quote_version_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb)','EXECUTE') is distinct from false then raise exception 'Function grant drift: import_supplier_quote_excel_v1 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb)','EXECUTE') is distinct from true then raise exception 'Function grant drift: import_supplier_quote_excel_v1 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.import_supplier_quote_excel_v1(uuid,uuid,uuid,text,text,text,jsonb,integer,jsonb)','EXECUTE') is distinct from true then raise exception 'Function grant drift: import_supplier_quote_excel_v1 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.get_supplier_trip_quote(uuid,uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: get_supplier_trip_quote for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.get_supplier_trip_quote(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: get_supplier_trip_quote for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.get_supplier_trip_quote(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: get_supplier_trip_quote for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.get_supplier_quote_version_v2(uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: get_supplier_quote_version_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.get_supplier_quote_version_v2(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: get_supplier_quote_version_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.get_supplier_quote_version_v2(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: get_supplier_quote_version_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.get_supplier_quote_versions_v2(uuid,uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: get_supplier_quote_versions_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.get_supplier_quote_versions_v2(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: get_supplier_quote_versions_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.get_supplier_quote_versions_v2(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: get_supplier_quote_versions_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.review_supplier_quote_v2(uuid,text,text)','EXECUTE') is distinct from false then raise exception 'Function grant drift: review_supplier_quote_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.review_supplier_quote_v2(uuid,text,text)','EXECUTE') is distinct from true then raise exception 'Function grant drift: review_supplier_quote_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.review_supplier_quote_v2(uuid,text,text)','EXECUTE') is distinct from true then raise exception 'Function grant drift: review_supplier_quote_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric)','EXECUTE') is distinct from false then raise exception 'Function grant drift: admin_save_supplier_quote_settings_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric)','EXECUTE') is distinct from true then raise exception 'Function grant drift: admin_save_supplier_quote_settings_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric)','EXECUTE') is distinct from true then raise exception 'Function grant drift: admin_save_supplier_quote_settings_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric)','EXECUTE') is distinct from false then raise exception 'Function grant drift: save_supplier_operational_state_v2 for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric)','EXECUTE') is distinct from true then raise exception 'Function grant drift: save_supplier_operational_state_v2 for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric)','EXECUTE') is distinct from true then raise exception 'Function grant drift: save_supplier_operational_state_v2 for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.sync_supplier_quote_assignment()','EXECUTE') is distinct from false then raise exception 'Function grant drift: sync_supplier_quote_assignment for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.sync_supplier_quote_assignment()','EXECUTE') is distinct from false then raise exception 'Function grant drift: sync_supplier_quote_assignment for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.sync_supplier_quote_assignment()','EXECUTE') is distinct from true then raise exception 'Function grant drift: sync_supplier_quote_assignment for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.is_staff(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: is_staff for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.is_staff(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: is_staff for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.is_staff(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: is_staff for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.supplier_can_access_quote(uuid,uuid,boolean)','EXECUTE') is distinct from false then raise exception 'Function grant drift: supplier_can_access_quote for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.supplier_can_access_quote(uuid,uuid,boolean)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_can_access_quote for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.supplier_can_access_quote(uuid,uuid,boolean)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_can_access_quote for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.supplier_can_access_trip(uuid,uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: supplier_can_access_trip for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.supplier_can_access_trip(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_can_access_trip for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.supplier_can_access_trip(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_can_access_trip for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.supplier_can_edit_trip(uuid,uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: supplier_can_edit_trip for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.supplier_can_edit_trip(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_can_edit_trip for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.supplier_can_edit_trip(uuid,uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: supplier_can_edit_trip for service_role; repeat supplier audit'; end if;
  if has_function_privilege('anon','public.user_supplier_ids(uuid)','EXECUTE') is distinct from false then raise exception 'Function grant drift: user_supplier_ids for anon; repeat supplier audit'; end if;
  if has_function_privilege('authenticated','public.user_supplier_ids(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: user_supplier_ids for authenticated; repeat supplier audit'; end if;
  if has_function_privilege('service_role','public.user_supplier_ids(uuid)','EXECUTE') is distinct from true then raise exception 'Function grant drift: user_supplier_ids for service_role; repeat supplier audit'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='supplier_trip_quotes' and c.relrowsecurity) or has_table_privilege('anon','public.supplier_trip_quotes','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Financial table RLS/grant drift: supplier_trip_quotes; repeat supplier audit'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='supplier_quote_hotel_rows' and c.relrowsecurity) or has_table_privilege('anon','public.supplier_quote_hotel_rows','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Financial table RLS/grant drift: supplier_quote_hotel_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='supplier_quote_transport_rows' and c.relrowsecurity) or has_table_privilege('anon','public.supplier_quote_transport_rows','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Financial table RLS/grant drift: supplier_quote_transport_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='supplier_quote_activity_rows' and c.relrowsecurity) or has_table_privilege('anon','public.supplier_quote_activity_rows','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Financial table RLS/grant drift: supplier_quote_activity_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='supplier_quote_guide_rows' and c.relrowsecurity) or has_table_privilege('anon','public.supplier_quote_guide_rows','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Financial table RLS/grant drift: supplier_quote_guide_rows; repeat supplier audit'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='supplier_quote_other_rows' and c.relrowsecurity) or has_table_privilege('anon','public.supplier_quote_other_rows','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Financial table RLS/grant drift: supplier_quote_other_rows; repeat supplier audit'; end if;
END $preflight$;

ALTER TABLE public.supplier_trip_quotes
  ADD COLUMN supplier_handling_percentage numeric NOT NULL DEFAULT 0,
  ADD COLUMN supplier_handling_categories text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN supplier_handling_base_jpy numeric NOT NULL DEFAULT 0,
  ADD COLUMN supplier_handling_amount_jpy numeric NOT NULL DEFAULT 0,
  ADD COLUMN supplier_total_jpy numeric GENERATED ALWAYS AS (grand_total_jpy + supplier_handling_amount_jpy) STORED,
  ADD COLUMN supplier_execution_status text NOT NULL DEFAULT 'to_book',
  ADD COLUMN IF NOT EXISTS admin_feedback text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
CREATE FUNCTION public.supplier_handling_terms_valid_v1(p_percentage numeric,p_categories text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p_percentage BETWEEN 0 AND 100 AND p_categories IS NOT NULL
 AND p_categories <@ ARRAY['hotels','transport','activities','guides','other']::text[]
 AND coalesce(array_ndims(p_categories),1)=1 AND array_position(p_categories,NULL) IS NULL
 AND cardinality(p_categories)=(SELECT count(DISTINCT x) FROM unnest(p_categories) x)
 AND (p_percentage=0 OR cardinality(p_categories)>0)
$$;
ALTER TABLE public.supplier_trip_quotes
 ADD CONSTRAINT supplier_quote_handling_terms_check CHECK(public.supplier_handling_terms_valid_v1(supplier_handling_percentage,supplier_handling_categories)),
 ADD CONSTRAINT supplier_quote_execution_status_check CHECK(supplier_execution_status IN ('to_book','booking_in_progress','operationally_confirmed'));
-- Header bypasses exposed internal aliases and let suppliers self-approve. Suppliers use filtered getters and authorized RPCs.
DROP POLICY supplier_trip_quotes_select ON public.supplier_trip_quotes;
DROP POLICY supplier_trip_quotes_insert ON public.supplier_trip_quotes;
DROP POLICY supplier_trip_quotes_update ON public.supplier_trip_quotes;
DROP POLICY supplier_trip_quotes_delete ON public.supplier_trip_quotes;
REVOKE INSERT,UPDATE,DELETE ON public.supplier_trip_quotes FROM authenticated;
-- Obsolete header-only financial write path is not used by the current frontend.
REVOKE EXECUTE ON FUNCTION public.supplier_save_trip_quote_header(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION public.supplier_save_trip_quote_v2(p_quote_id uuid, p_trip_id uuid, p_supplier_id uuid, p_status text, p_payload jsonb DEFAULT '{}'::jsonb, p_rows jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype; item jsonb; row_id uuid;
begin
  if p_payload ? 'supplier_handling_percentage' and not public.supplier_handling_terms_valid_v1(
    (p_payload->>'supplier_handling_percentage')::numeric,
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'supplier_handling_categories','[]'::jsonb)))
  ) then raise exception 'invalid supplier handling percentage or category scope' using errcode='22023'; end if;
  if actor is null or p_supplier_id not in(select public.user_supplier_ids(actor))
    or public.is_staff(actor) or not public.supplier_can_edit_trip(actor,p_trip_id) then
    raise exception 'supplier trip access denied' using errcode='42501';
  end if;
  if p_status not in ('draft','submitted') then raise exception 'supplier status not allowed' using errcode='22023'; end if;

  if p_quote_id is null then
    if exists(select 1 from public.supplier_trip_quotes where trip_id=p_trip_id and supplier_id=p_supplier_id) then
      raise exception 'select or create a new quote version first' using errcode='55000';
    end if;
    insert into public.supplier_trip_quotes(trip_id,supplier_id,status,version_number,created_by,updated_by)
    values(p_trip_id,p_supplier_id,'draft',1,actor,actor) returning * into q;
  else
    select * into q from public.supplier_trip_quotes
    where id=p_quote_id and trip_id=p_trip_id and supplier_id=p_supplier_id for update;
    if not found then raise exception 'supplier quote not found' using errcode='P0002'; end if;
    if q.status not in ('draft','revision_requested') then
      raise exception 'submitted supplier quote is immutable; create a new version' using errcode='55000';
    end if;
  end if;

  if p_payload ? 'validation_status' and p_payload->>'validation_status' not in ('draft','in_progress','ready_for_japan_office') then raise exception 'supplier operational checklist status not allowed' using errcode='22023'; end if;
  if coalesce((p_payload->>'supplier_handling_percentage')::numeric,q.supplier_handling_percentage)>0
    and exists(select 1 from public.supplier_quote_other_rows where quote_id=q.id and included_in_total and (label ~* 'tapis[[:space:]]+volant[[:space:]]+handling' or comment like '%Nature Excel : handling fournisseur%'))
    and not coalesce((p_payload->>'supplier_handling_confirmed')::boolean,false) then
      raise exception 'legacy handling conversion requires explicit confirmation' using errcode='22023'; end if;
  -- Raw negative/invalid financial values must not be clamped into an apparently valid submission.
  for item in select value from jsonb_array_elements(coalesce(p_rows->'hotels','[]'::jsonb)||coalesce(p_rows->'transport','[]'::jsonb)||coalesce(p_rows->'activities','[]'::jsonb)||coalesce(p_rows->'guides','[]'::jsonb)||coalesce(p_rows->'other','[]'::jsonb)) loop
    if exists(select 1 from jsonb_each_text(item) e where e.key in ('unit_price_jpy','daily_price_jpy','price_per_room_per_night_jpy','subtotal_jpy','quantity','participant_count','rooms_count','room_count','guides_count','guide_count','nights') and e.value is not null and (e.value::numeric<0 or e.value::numeric::text in ('NaN','Infinity','-Infinity'))) then
      raise exception 'invalid supplier service financial value' using errcode='22023';
    end if;
  end loop;
  -- Hotels
  for item in select value from jsonb_array_elements(coalesce(p_rows->'hotels','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_hotel_rows(id,quote_id,sort_order,city,hotel_name,check_in,check_out,nights,room_type,rooms_count,room_count,unit_price_jpy,price_per_room_per_night_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'city',''),nullif(item->>'hotel_name',''),nullif(item->>'check_in','')::date,nullif(item->>'check_out','')::date,greatest(0,coalesce((item->>'nights')::int,0)),nullif(item->>'room_type',''),greatest(0,coalesce((item->>'rooms_count')::numeric,(item->>'room_count')::numeric,0)),greatest(0,coalesce((item->>'room_count')::numeric,(item->>'rooms_count')::numeric,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,(item->>'price_per_room_per_night_jpy')::numeric,0)),greatest(0,coalesce((item->>'price_per_room_per_night_jpy')::numeric,(item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,'todo',statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,city=excluded.city,hotel_name=excluded.hotel_name,check_in=excluded.check_in,check_out=excluded.check_out,nights=excluded.nights,room_type=excluded.room_type,rooms_count=excluded.rooms_count,room_count=excluded.room_count,unit_price_jpy=excluded.unit_price_jpy,price_per_room_per_night_jpy=excluded.price_per_room_per_night_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,updated_at=statement_timestamp()
    where public.supplier_quote_hotel_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_hotel_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'hotels','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Transport
  for item in select value from jsonb_array_elements(coalesce(p_rows->'transport','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_transport_rows(id,quote_id,sort_order,service_date,day_number,city_route,transport_type,description,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'service_date','')::date,nullif(item->>'day_number','')::int,nullif(item->>'city_route',''),nullif(item->>'transport_type',''),nullif(item->>'description',''),greatest(0,coalesce((item->>'quantity')::numeric,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,'todo',statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,service_date=excluded.service_date,day_number=excluded.day_number,city_route=excluded.city_route,transport_type=excluded.transport_type,description=excluded.description,quantity=excluded.quantity,unit_price_jpy=excluded.unit_price_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,updated_at=statement_timestamp()
    where public.supplier_quote_transport_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_transport_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'transport','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Activities
  for item in select value from jsonb_array_elements(coalesce(p_rows->'activities','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_activity_rows(id,quote_id,sort_order,service_date,day_number,activity_name,participant_count,quantity,unit_price_jpy,subtotal_jpy,optional,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'service_date','')::date,nullif(item->>'day_number','')::int,nullif(item->>'activity_name',''),greatest(0,coalesce((item->>'participant_count')::numeric,(item->>'quantity')::numeric,0)),greatest(0,coalesce((item->>'quantity')::numeric,(item->>'participant_count')::numeric,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),coalesce((item->>'optional')::boolean,false),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,'todo',statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,service_date=excluded.service_date,day_number=excluded.day_number,activity_name=excluded.activity_name,participant_count=excluded.participant_count,quantity=excluded.quantity,unit_price_jpy=excluded.unit_price_jpy,subtotal_jpy=excluded.subtotal_jpy,optional=excluded.optional,comment=excluded.comment,assigned_to=excluded.assigned_to,updated_at=statement_timestamp()
    where public.supplier_quote_activity_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_activity_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'activities','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Guides
  for item in select value from jsonb_array_elements(coalesce(p_rows->'guides','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_guide_rows(id,quote_id,sort_order,service_date,day_number,city,guide_type,guides_count,guide_count,daily_price_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'service_date','')::date,nullif(item->>'day_number','')::int,nullif(item->>'city',''),nullif(item->>'guide_type',''),greatest(0,coalesce((item->>'guides_count')::int,(item->>'guide_count')::int,0)),greatest(0,coalesce((item->>'guide_count')::int,(item->>'guides_count')::int,0)),greatest(0,coalesce((item->>'daily_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,'todo',statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,service_date=excluded.service_date,day_number=excluded.day_number,city=excluded.city,guide_type=excluded.guide_type,guides_count=excluded.guides_count,guide_count=excluded.guide_count,daily_price_jpy=excluded.daily_price_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,updated_at=statement_timestamp()
    where public.supplier_quote_guide_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_guide_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'guides','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Other
  for item in select value from jsonb_array_elements(coalesce(p_rows->'other','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_other_rows(id,quote_id,sort_order,label,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'label',''),greatest(0,coalesce((item->>'quantity')::numeric,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,'todo',statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,label=excluded.label,quantity=excluded.quantity,unit_price_jpy=excluded.unit_price_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,updated_at=statement_timestamp()
    where public.supplier_quote_other_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_other_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'other','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  update public.supplier_trip_quotes set
    status=p_status,
    supplier_handling_percentage=coalesce((p_payload->>'supplier_handling_percentage')::numeric,supplier_handling_percentage),
    supplier_handling_categories=case when p_payload ? 'supplier_handling_categories' then ARRAY(SELECT jsonb_array_elements_text(p_payload->'supplier_handling_categories')) else supplier_handling_categories end,
    participant_count=greatest(0,coalesce((p_payload->>'participant_count')::int,participant_count)),
    supplier_notes=case when p_payload ? 'supplier_notes' then nullif(p_payload->>'supplier_notes','') else supplier_notes end,
    validation_status=case when p_payload ? 'validation_status' then coalesce(nullif(p_payload->>'validation_status',''),'draft') else validation_status end,
    validation_snapshot=coalesce(p_payload->'validation_snapshot',validation_snapshot),
    validation_metadata=coalesce(validation_metadata,'{}'::jsonb)||coalesce(p_payload->'validation_metadata','{}'::jsonb)||case when validation_metadata ? 'excel_import' then jsonb_build_object('excel_import',validation_metadata->'excel_import') else '{}'::jsonb end,
    validation_completion_percentage=coalesce((p_payload->>'validation_completion_percentage')::numeric,validation_completion_percentage),
    validation_updated_by=actor,validation_updated_at=statement_timestamp(),updated_by=actor,
    submitted_at=case when p_status='submitted' then statement_timestamp() else submitted_at end,
    submitted_by=case when p_status='submitted' then actor else submitted_by end,updated_at=statement_timestamp()
  where id=q.id returning * into q;
  -- Explicit conversion on an editable version retains the historical line and its source price/audit.
  if coalesce((p_payload->>'supplier_handling_confirmed')::boolean,false) and q.supplier_handling_percentage>0 then
    update public.supplier_quote_other_rows set included_in_total=false
    where quote_id=q.id and (label ~* 'tapis[[:space:]]+volant[[:space:]]+handling' or comment like '%Nature Excel : handling fournisseur%');
  end if;
  perform public.recalculate_supplier_quote_totals_v2(q.id);
  if p_status='submitted' and (select grand_total_jpy<=0 from public.supplier_trip_quotes where id=q.id) then
    raise exception 'quotation requires included services with a positive financial total' using errcode='22023';
  end if;
  return (select to_jsonb(x)-array['commission_percent','admin_notes','commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'] from public.supplier_trip_quotes x where x.id=q.id);
end $function$
;

CREATE OR REPLACE FUNCTION public.recalculate_supplier_quote_totals_v2(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare h numeric:=0;t numeric:=0;a numeric:=0;g numeric:=0;o numeric:=0;
  pct numeric:=0;rate numeric:=0;participants integer:=1;grand numeric:=0;commission numeric:=0;final_jpy numeric:=0; q public.supplier_trip_quotes%rowtype; base numeric:=0; handling numeric:=0; vendor_total numeric:=0;
begin
  select * into q from public.supplier_trip_quotes where id=p_quote_id for update;
  if not found then raise exception 'quote not found'; end if;
  if q.status in ('approved','archived') then return; end if;
  select coalesce(sum(subtotal_jpy),0) into h from public.supplier_quote_hotel_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into t from public.supplier_quote_transport_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into a from public.supplier_quote_activity_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into g from public.supplier_quote_guide_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into o from public.supplier_quote_other_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(commission_percentage,0),coalesce(exchange_rate_jpy_mad,0),greatest(1,coalesce(participant_count,1))
    into pct,rate,participants from public.supplier_trip_quotes where id=p_quote_id;
  grand:=h+t+a+g+o;
  base:=CASE WHEN 'hotels'=ANY(q.supplier_handling_categories) THEN h ELSE 0 END
       +CASE WHEN 'transport'=ANY(q.supplier_handling_categories) THEN t ELSE 0 END
       +CASE WHEN 'activities'=ANY(q.supplier_handling_categories) THEN a ELSE 0 END
       +CASE WHEN 'guides'=ANY(q.supplier_handling_categories) THEN g ELSE 0 END
       +CASE WHEN 'other'=ANY(q.supplier_handling_categories) THEN o ELSE 0 END;
  handling:=round(base*q.supplier_handling_percentage/100,2);
  vendor_total:=grand+handling; commission:=vendor_total*pct/100; final_jpy:=vendor_total+commission;
  update public.supplier_trip_quotes set
    total_hotels_jpy=h,total_transport_jpy=t,total_activities_jpy=a,total_guides_jpy=g,total_other_jpy=o,
    grand_total_jpy=grand,supplier_handling_base_jpy=base,supplier_handling_amount_jpy=handling,commission_amount_jpy=commission,final_total_jpy=final_jpy,
    final_total_mad=final_jpy*rate,cost_per_person_jpy=final_jpy/participants,
    cost_per_person_mad=(final_jpy*rate)/participants,updated_at=statement_timestamp()
  where id=p_quote_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_supplier_quote_version_v2(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); source public.supplier_trip_quotes%rowtype; target public.supplier_trip_quotes%rowtype; next_version int;
begin
  select * into source from public.supplier_trip_quotes where id=p_quote_id;
  if not found or source.status not in ('approved','revision_requested') or not public.supplier_can_access_quote(actor,source.id,false) then
    raise exception 'approved or revision-requested supplier quote access required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(source.trip_id::text||':'||source.supplier_id::text,0));
  select * into source from public.supplier_trip_quotes where id=p_quote_id for update;
  if source.status not in ('approved','revision_requested') then raise exception 'quote changed; reload before creating revision' using errcode='55000'; end if;
  if exists(select 1 from public.supplier_trip_quotes where trip_id=source.trip_id and supplier_id=source.supplier_id and id<>source.id and status in ('draft','submitted','reviewed','revision_requested')) then
    raise exception 'an active quote version already exists' using errcode='55000';
  end if;
  select coalesce(max(version_number),0)+1 into next_version from public.supplier_trip_quotes where trip_id=source.trip_id and supplier_id=source.supplier_id;
  insert into public.supplier_trip_quotes(
    trip_id,supplier_id,status,version_number,parent_quote_id,participant_count,commission_percentage,exchange_rate_jpy_mad,supplier_handling_percentage,supplier_handling_categories,supplier_handling_base_jpy,supplier_handling_amount_jpy,
    total_hotels_jpy,total_transport_jpy,total_activities_jpy,total_guides_jpy,total_other_jpy,grand_total_jpy,
    commission_amount_jpy,final_total_jpy,final_total_mad,cost_per_person_jpy,cost_per_person_mad,supplier_notes,
    validation_status,validation_snapshot,validation_metadata,validation_completion_percentage,created_by,updated_by
  ) select trip_id,supplier_id,'draft',next_version,id,participant_count,commission_percentage,exchange_rate_jpy_mad,supplier_handling_percentage,supplier_handling_categories,supplier_handling_base_jpy,supplier_handling_amount_jpy,
    total_hotels_jpy,total_transport_jpy,total_activities_jpy,total_guides_jpy,total_other_jpy,grand_total_jpy,
    commission_amount_jpy,final_total_jpy,final_total_mad,cost_per_person_jpy,cost_per_person_mad,supplier_notes,
    'in_progress',validation_snapshot,validation_metadata,validation_completion_percentage,actor,actor
    from public.supplier_trip_quotes where id=source.id returning * into target;
  insert into public.supplier_quote_hotel_rows(quote_id,sort_order,city,hotel_name,check_in,check_out,nights,room_type,rooms_count,room_count,unit_price_jpy,price_per_room_per_night_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,city,hotel_name,check_in,check_out,nights,room_type,rooms_count,room_count,unit_price_jpy,price_per_room_per_night_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_hotel_rows where quote_id=source.id;
  insert into public.supplier_quote_transport_rows(quote_id,sort_order,service_date,day_number,city_route,transport_type,description,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,service_date,day_number,city_route,transport_type,description,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_transport_rows where quote_id=source.id;
  insert into public.supplier_quote_activity_rows(quote_id,sort_order,service_date,day_number,activity_name,participant_count,quantity,unit_price_jpy,subtotal_jpy,optional,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,service_date,day_number,activity_name,participant_count,quantity,unit_price_jpy,subtotal_jpy,optional,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_activity_rows where quote_id=source.id;
  insert into public.supplier_quote_guide_rows(quote_id,sort_order,service_date,day_number,city,guide_type,guides_count,guide_count,daily_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,service_date,day_number,city,guide_type,guides_count,guide_count,daily_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_guide_rows where quote_id=source.id;
  insert into public.supplier_quote_other_rows(quote_id,sort_order,label,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,label,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_other_rows where quote_id=source.id;
  if source.status='revision_requested' then update public.supplier_trip_quotes set status='archived',updated_by=actor where id=source.id; end if;
  return (select to_jsonb(x) from public.supplier_trip_quotes x where x.id=target.id)-array['commission_percent','admin_notes','commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $function$
;

CREATE OR REPLACE FUNCTION public.import_supplier_quote_excel_v1(p_quote_id uuid, p_trip_id uuid, p_supplier_id uuid, p_mode text, p_file_name text, p_sheet_name text, p_rows jsonb DEFAULT '{}'::jsonb, p_participant_count integer DEFAULT NULL::integer, p_import_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if actor is null or public.is_staff(actor)
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

  -- Handling is quote-level financial terms; never a generic other-cost line.
  if exists(select 1 from jsonb_array_elements(all_payload_rows) r where r->>'source_excel_kind'='supplier_handling'
    or r->>'label' ~* 'tapis[[:space:]]+volant[[:space:]]+handling') then
    raise exception 'supplier handling must not be imported as a service row' using errcode='22023'; end if;
  if not public.supplier_handling_terms_valid_v1(
    coalesce((p_import_metadata->'supplier_handling'->>'percentage')::numeric,0),
    ARRAY(SELECT jsonb_array_elements_text(coalesce(p_import_metadata->'supplier_handling'->'categories','[]'::jsonb)))
  ) then raise exception 'invalid supplier handling percentage or scope' using errcode='22023'; end if;
  handling_metadata_amount:=nullif(p_import_metadata->'financial_summary'->>'supplierHandlingJpy','')::numeric;
  if (handling_metadata_amount is not null OR coalesce((p_import_metadata->'supplier_handling'->>'percentage')::numeric,0)>0) and not coalesce((p_import_metadata->'supplier_handling'->>'scope_confirmed')::boolean,false) then
    raise exception 'handling scope confirmation required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text||':'||p_supplier_id::text,0));

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
  set supplier_handling_percentage=coalesce((p_import_metadata->'supplier_handling'->>'percentage')::numeric,0),
      supplier_handling_categories=ARRAY(SELECT jsonb_array_elements_text(coalesce(p_import_metadata->'supplier_handling'->'categories','[]'::jsonb))),
      participant_count = greatest(0, coalesce(p_participant_count, participant_count)),
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

  select * into target_quote from public.supplier_trip_quotes where id=target_quote.id;
  if handling_metadata_amount is not null and abs(handling_metadata_amount-target_quote.supplier_handling_amount_jpy)>0.01
     and not coalesce((p_import_metadata->'supplier_handling'->>'mismatch_acknowledged')::boolean,false) then
    raise exception 'source handling amount differs from calculated handling; explicit acknowledgment required' using errcode='22023'; end if;
  update public.supplier_trip_quotes set validation_metadata=jsonb_set(validation_metadata,'{excel_import,handling_reconciliation}',
    jsonb_build_object('source_amount_jpy',handling_metadata_amount,'calculated_amount_jpy',target_quote.supplier_handling_amount_jpy,
    'difference_jpy',case when handling_metadata_amount is null then null else target_quote.supplier_handling_amount_jpy-handling_metadata_amount end))
  where id=target_quote.id;
  return (
    select (to_jsonb(q) - array[
      'commission_percent','admin_notes','commission_percentage', 'exchange_rate_jpy_mad', 'commission_amount_jpy',
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_supplier_trip_quote(p_trip_id uuid, p_supplier_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null or p_supplier_id not in(select public.user_supplier_ids(actor))
    or not public.supplier_can_access_trip(actor,p_trip_id) then
    raise exception 'supplier trip access denied' using errcode='42501';
  end if;
  select * into q from public.supplier_trip_quotes
  where trip_id=p_trip_id and supplier_id=p_supplier_id
  order by version_number desc,created_at desc limit 1;
  if not found then return null; end if;
  return to_jsonb(q)-array['commission_percent','admin_notes','commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $function$
;

CREATE OR REPLACE FUNCTION public.get_supplier_quote_version_v2(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  select * into q from public.supplier_trip_quotes where id=p_quote_id;
  if not found or actor is null or (
    not public.is_staff(actor) and not public.supplier_can_access_quote(actor,p_quote_id,false)
  ) then raise exception 'quote version access denied' using errcode='42501'; end if;
  if public.is_staff(actor) then return to_jsonb(q); end if;
  return to_jsonb(q)-array['commission_percent','admin_notes','commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $function$
;

CREATE OR REPLACE FUNCTION public.get_supplier_quote_versions_v2(p_trip_id uuid, p_supplier_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
  if actor is null or (
    not public.is_staff(actor) and (
      p_supplier_id not in(select public.user_supplier_ids(actor))
      or not public.supplier_can_access_trip(actor,p_trip_id)
    )
  ) then raise exception 'quote history access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(
    (to_jsonb(q)-array['commission_percent','admin_notes','commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'])
    order by q.version_number desc,q.created_at desc
  ),'[]'::jsonb) into result
  from public.supplier_trip_quotes q where q.trip_id=p_trip_id and q.supplier_id=p_supplier_id;
  return result;
end $function$
;

CREATE OR REPLACE FUNCTION public.review_supplier_quote_v2(p_quote_id uuid, p_action text, p_feedback text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'staff access required' using errcode='42501'; end if;
  if p_action not in ('reviewed','revision_requested','approved','rejected') then raise exception 'invalid review action' using errcode='22023'; end if;
  select * into q from public.supplier_trip_quotes where id=p_quote_id for update;
  if not found or q.status not in ('submitted','reviewed','revision_requested') then raise exception 'quote cannot transition' using errcode='55000'; end if;
  perform public.recalculate_supplier_quote_totals_v2(q.id);
  if p_action='approved' and (select grand_total_jpy<=0 from public.supplier_trip_quotes where id=q.id) then raise exception 'quotation requires a positive included service total' using errcode='22023'; end if;
  if p_action='approved' then
    update public.supplier_trip_quotes set status='archived',updated_at=statement_timestamp()
      where trip_id=q.trip_id and supplier_id=q.supplier_id and id<>q.id and status='approved';
  end if;
  update public.supplier_trip_quotes set status=p_action,admin_feedback=nullif(trim(p_feedback),''),
    reviewed_at=case when p_action in ('reviewed','revision_requested','approved','rejected') then statement_timestamp() else reviewed_at end,
    approved_at=case when p_action='approved' then statement_timestamp() else approved_at end,
    approved_by=case when p_action='approved' then actor else approved_by end,
    revision_requested_at=case when p_action='revision_requested' then statement_timestamp() else revision_requested_at end,
    updated_by=actor,updated_at=statement_timestamp()
  where id=q.id returning * into q;
  if p_action in ('revision_requested','approved') and q.supplier_id is not null then
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key,email_delivery_status,email_scheduled_at
    ) values(
      q.supplier_id,
      case when p_action='approved' then 'quote_approved' else 'quote_revision_requested' end,
      case when p_action='approved' then 'Devis fournisseur approuvé' else 'Correction demandée sur le devis' end,
      coalesce(nullif(trim(p_feedback),''),case when p_action='approved' then 'La version du devis a été approuvée.' else 'Une correction du devis est demandée.' end),
      'supplier_quote',q.id,'/supplier/trips/'||q.trip_id::text||'/quote',
      'quote-review:'||q.id::text||':'||p_action||':'||extract(epoch from statement_timestamp())::text,
      'pending',statement_timestamp()
    );
  end if;
  return to_jsonb(q);
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_save_supplier_quote_settings_v2(p_quote_id uuid, p_commission_percentage numeric, p_exchange_rate numeric, p_internal_notes text, p_supplier_notes text, p_validation_status text, p_validation_snapshot jsonb, p_validation_metadata jsonb, p_validation_completion numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'staff access required' using errcode='42501'; end if;
  if p_validation_status not in ('draft','in_progress','ready_for_japan_office','japan_office_confirmed','ready_to_travel') then raise exception 'invalid validation status' using errcode='22023'; end if;
  update public.supplier_trip_quotes set commission_percentage=greatest(0,coalesce(p_commission_percentage,commission_percentage)),
    exchange_rate_jpy_mad=greatest(0,coalesce(p_exchange_rate,exchange_rate_jpy_mad)),internal_notes=nullif(p_internal_notes,''),
    supplier_notes=p_supplier_notes,validation_status=p_validation_status,validation_snapshot=coalesce(p_validation_snapshot,validation_snapshot),
    validation_metadata=coalesce(validation_metadata,'{}'::jsonb)||coalesce(p_validation_metadata,'{}'::jsonb)||case when validation_metadata ? 'excel_import' then jsonb_build_object('excel_import',validation_metadata->'excel_import') else '{}'::jsonb end,validation_completion_percentage=coalesce(p_validation_completion,validation_completion_percentage),
    validation_updated_by=actor,validation_updated_at=statement_timestamp(),updated_by=actor,updated_at=statement_timestamp()
  where id=p_quote_id and status not in ('approved','archived') returning * into q;
  if not found then raise exception 'quote not found or approved version is immutable' using errcode='55000'; end if;
  perform public.recalculate_supplier_quote_totals_v2(q.id);
  return (select to_jsonb(x) from public.supplier_trip_quotes x where x.id=q.id);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_supplier_operational_state_v2(p_quote_id uuid, p_supplier_notes text, p_validation_status text, p_validation_snapshot jsonb, p_validation_metadata jsonb, p_validation_completion numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype; staff boolean:=public.is_staff(actor);
begin
  if actor is null or (not staff and not public.supplier_can_access_quote(actor,p_quote_id,false)) then raise exception 'quote access denied' using errcode='42501'; end if;
  if (staff and p_validation_status not in ('draft','in_progress','ready_for_japan_office','japan_office_confirmed','ready_to_travel'))
    or (not staff and p_validation_status not in ('draft','in_progress','ready_for_japan_office')) then raise exception 'validation status not allowed' using errcode='22023'; end if;
  update public.supplier_trip_quotes set supplier_notes=p_supplier_notes,validation_status=p_validation_status,
    validation_snapshot=coalesce(p_validation_snapshot,validation_snapshot),validation_metadata=coalesce(validation_metadata,'{}'::jsonb)||coalesce(p_validation_metadata,'{}'::jsonb)||case when validation_metadata ? 'excel_import' then jsonb_build_object('excel_import',validation_metadata->'excel_import') else '{}'::jsonb end,
    validation_completion_percentage=coalesce(p_validation_completion,validation_completion_percentage),validation_updated_by=actor,
    validation_updated_at=statement_timestamp(),updated_by=actor,updated_at=statement_timestamp()
  where id=p_quote_id and status<>'archived' returning * into q;
  if not found then raise exception 'historical quote version is immutable' using errcode='55000'; end if;
  if staff then return to_jsonb(q); end if;
  return to_jsonb(q)-array['commission_percent','admin_notes','commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $function$
;

CREATE OR REPLACE FUNCTION public.sync_supplier_quote_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare assignment_status text; notification_type text; notification_title text;
begin
  if new.supplier_id is null then return new; end if;
  -- Archiving a superseded version must never cancel the current supplier assignment.
  if exists(select 1 from public.supplier_trip_quotes q where q.trip_id=new.trip_id and q.supplier_id=new.supplier_id and q.version_number>new.version_number) then return new; end if;
  assignment_status:=case new.status
    when 'draft' then 'in_progress'
    when 'submitted' then 'submitted'
    when 'reviewed' then 'submitted'
    when 'revision_requested' then 'revision_requested'
    when 'approved' then 'approved'
    when 'rejected' then 'cancelled'
    when 'archived' then 'cancelled'
    else 'assigned' end;
  insert into public.trip_suppliers(trip_id,supplier_id,role,assignment_type,status,assigned_at,assigned_by,updated_at)
  values(new.trip_id,new.supplier_id,'japan_office','quote_request',assignment_status,statement_timestamp(),coalesce(new.created_by,(select auth.uid())),statement_timestamp())
  on conflict(trip_id,supplier_id) do update set
    assignment_type='quote_request',status=excluded.status,updated_at=statement_timestamp();

  if tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('reviewed','revision_requested','approved','rejected') then
    notification_type:='quote_'||new.status;
    notification_title:=case new.status
      when 'reviewed' then 'Devis en cours de revue'
      when 'revision_requested' then 'Correction demandée sur votre devis'
      when 'approved' then 'Devis fournisseur approuvé'
      else 'Devis fournisseur refusé' end;
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key
    ) values(
      new.supplier_id,notification_type,notification_title,nullif(new.admin_feedback,''),
      'supplier_quote',new.id,'/supplier/trips/'||new.trip_id::text||'/quote',
      notification_type||':'||new.id::text||':'||extract(epoch from new.updated_at)::bigint::text
    ) on conflict(dedupe_key) do nothing;
  end if;
  if tg_op='UPDATE' and new.validation_status is distinct from old.validation_status
    and new.validation_status in ('japan_office_confirmed','ready_to_travel') then
    notification_type:='validation_'||new.validation_status;
    notification_title:=case new.validation_status
      when 'japan_office_confirmed' then 'Dossier confirmé par Japan Office'
      else 'Dossier prêt au voyage' end;
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key
    ) values(
      new.supplier_id,notification_type,notification_title,null,
      'supplier_quote',new.id,'/supplier/trips/'||new.trip_id::text||'/quote',
      notification_type||':'||new.id::text||':'||extract(epoch from new.updated_at)::bigint::text
    ) on conflict(dedupe_key) do nothing;
  end if;
  return new;
end $function$
;

-- Automatic refresh on service inclusion/amount and supplier handling terms.
CREATE FUNCTION public.refresh_supplier_handling_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='supplier_trip_quotes' THEN
   PERFORM public.recalculate_supplier_quote_totals_v2(NEW.id); RETURN NEW;
 END IF;
 PERFORM public.recalculate_supplier_quote_totals_v2(CASE WHEN TG_OP='DELETE' THEN OLD.quote_id ELSE NEW.quote_id END);
 RETURN NULL;
END $$;
CREATE TRIGGER supplier_handling_terms_refresh AFTER UPDATE OF supplier_handling_percentage,supplier_handling_categories ON public.supplier_trip_quotes
 FOR EACH ROW WHEN (OLD.supplier_handling_percentage IS DISTINCT FROM NEW.supplier_handling_percentage OR OLD.supplier_handling_categories IS DISTINCT FROM NEW.supplier_handling_categories)
 EXECUTE FUNCTION public.refresh_supplier_handling_v1();
-- Freeze commercial prices after submission, and prevent staff from writing supplier prices.
CREATE FUNCTION public.guard_supplier_quote_prices_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.supplier_trip_quotes%rowtype; actor uuid:=auth.uid(); changed boolean;
BEGIN
 SELECT * INTO q FROM public.supplier_trip_quotes WHERE id=NEW.quote_id FOR UPDATE;
 SELECT EXISTS(SELECT 1 FROM jsonb_each(to_jsonb(NEW)) e WHERE e.key IN ('subtotal_jpy','unit_price_jpy','daily_price_jpy','price_per_room_per_night_jpy','quantity','participant_count','rooms_count','room_count','guides_count','guide_count','nights') AND e.value IS DISTINCT FROM to_jsonb(OLD)->e.key) INTO changed;
 IF changed AND actor IS NOT NULL AND (public.is_staff(actor) OR q.status NOT IN ('draft','revision_requested')) THEN
   RAISE EXCEPTION 'Supplier prices are immutable here; request a supplier revision' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='supplier_quote_other_rows' AND q.supplier_handling_percentage>0 AND NEW.included_in_total
 AND (coalesce(to_jsonb(NEW)->>'label' ~* 'tapis[[:space:]]+volant[[:space:]]+handling',false) OR coalesce(to_jsonb(NEW)->>'comment' LIKE '%Nature Excel : handling fournisseur%',false)) THEN
   RAISE EXCEPTION 'Handling is quote-level; legacy handling rows must remain excluded' USING ERRCODE='22023'; END IF;
 IF actor IS NOT NULL AND q.status IN ('approved','archived') AND NEW.included_in_total IS DISTINCT FROM OLD.included_in_total THEN
   RAISE EXCEPTION 'Approved financial terms require a new revision' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
DO $triggers$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['supplier_quote_hotel_rows','supplier_quote_transport_rows','supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows'] LOOP
  EXECUTE format('CREATE TRIGGER supplier_handling_rows_refresh AFTER INSERT OR UPDATE OF subtotal_jpy,included_in_total OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.refresh_supplier_handling_v1()',t);
  EXECUTE format('CREATE TRIGGER supplier_quote_price_guard BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_supplier_quote_prices_v1()',t);
 END LOOP;
END $triggers$;
CREATE FUNCTION public.set_supplier_quote_reservation_status_v1(p_quote_id uuid,p_row_table text,p_row_id uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.supplier_trip_quotes%rowtype; actor uuid:=auth.uid(); affected integer;
BEGIN
 SELECT * INTO q FROM public.supplier_trip_quotes WHERE id=p_quote_id FOR UPDATE;
 IF NOT FOUND OR actor IS NULL OR (NOT public.is_staff(actor) AND NOT public.supplier_can_access_quote(actor,p_quote_id,false)) OR q.status<>'approved'
 OR (NOT public.is_staff(actor) AND NOT public.supplier_can_edit_trip(actor,q.trip_id)) THEN
  RAISE EXCEPTION 'Approved quotation access required for reservations' USING ERRCODE='42501'; END IF;
 IF p_row_table NOT IN ('supplier_quote_hotel_rows','supplier_quote_transport_rows','supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows')
 OR p_status NOT IN ('todo','pending','confirmed','issue') THEN RAISE EXCEPTION 'Invalid reservation status or category' USING ERRCODE='22023'; END IF;
 EXECUTE format('UPDATE public.%I SET status=$1 WHERE quote_id=$2 AND ($3 IS NULL OR id=$3)',p_row_table) USING p_status,p_quote_id,p_row_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=0 AND p_row_id IS NOT NULL THEN RAISE EXCEPTION 'Reservation line not found' USING ERRCODE='P0002'; END IF;
 UPDATE public.supplier_trip_quotes SET supplier_execution_status='booking_in_progress',updated_by=actor WHERE id=p_quote_id;
END $$;
CREATE FUNCTION public.set_supplier_quote_execution_status_v1(p_quote_id uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.supplier_trip_quotes%rowtype; actor uuid:=auth.uid(); t text; incomplete boolean; fee_filter text;
BEGIN
 SELECT * INTO q FROM public.supplier_trip_quotes WHERE id=p_quote_id FOR UPDATE;
 IF NOT FOUND OR actor IS NULL OR (NOT public.is_staff(actor) AND NOT public.supplier_can_access_quote(actor,p_quote_id,false)) OR q.status<>'approved'
 OR (NOT public.is_staff(actor) AND NOT public.supplier_can_edit_trip(actor,q.trip_id)) THEN
  RAISE EXCEPTION 'Approved quotation access required for execution' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('to_book','booking_in_progress','operationally_confirmed') THEN RAISE EXCEPTION 'Invalid execution status' USING ERRCODE='22023'; END IF;
 IF p_status='operationally_confirmed' THEN
  FOREACH t IN ARRAY ARRAY['supplier_quote_hotel_rows','supplier_quote_transport_rows','supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows'] LOOP
   fee_filter:=CASE WHEN t='supplier_quote_other_rows' THEN ' AND NOT(coalesce(label ~* ''tapis[[:space:]]+volant[[:space:]]+handling'',false) OR coalesce(comment LIKE ''%Nature Excel : handling fournisseur%'',false))' ELSE '' END;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE quote_id=$1 AND included_in_total AND status<>''confirmed''%s)',t,fee_filter) INTO incomplete USING p_quote_id;
   IF incomplete THEN RAISE EXCEPTION 'All included reservations must be confirmed' USING ERRCODE='22023'; END IF;
  END LOOP;
 END IF;
 UPDATE public.supplier_trip_quotes SET supplier_execution_status=p_status,updated_by=actor WHERE id=p_quote_id;
END $$;
REVOKE ALL ON FUNCTION public.refresh_supplier_handling_v1(), public.guard_supplier_quote_prices_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_supplier_quote_reservation_status_v1(uuid,text,uuid,text),public.set_supplier_quote_execution_status_v1(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_supplier_quote_reservation_status_v1(uuid,text,uuid,text),public.set_supplier_quote_execution_status_v1(uuid,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
