-- LOCAL ONLY: requires the isolated audited fixture and synthetic seed.
-- Never run against production. All business tests are rolled back.
BEGIN;
CREATE FUNCTION public.test_supplier_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',message; END IF; RAISE NOTICE 'PASS: %',message; END $$;
GRANT EXECUTE ON FUNCTION public.test_supplier_assert(boolean,text) TO authenticated,anon;
SELECT public.test_supplier_assert(NOT EXISTS(SELECT 1 FROM public.audit_old_quotes old JOIN public.supplier_trip_quotes q USING(id) WHERE old.data IS DISTINCT FROM to_jsonb(q)-ARRAY['supplier_handling_percentage','supplier_handling_categories','supplier_handling_base_jpy','supplier_handling_amount_jpy','supplier_total_jpy','supplier_execution_status','admin_feedback','approved_at']),'migration preserved every existing quote financial field');
SELECT public.test_supplier_assert((SELECT count(*) FROM public.audit_old_rows)=72 AND NOT EXISTS(SELECT 1 FROM public.audit_old_rows old WHERE NOT EXISTS(SELECT 1 FROM (SELECT to_jsonb(r) data FROM public.supplier_quote_hotel_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_transport_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_activity_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_guide_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_other_rows r) current_rows WHERE current_rows.data=old.data)),'migration preserved all existing rows');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_hotel_rows WHERE quote_id='30000000-0000-0000-0000-000000000003')=20,'supplier A reads V3 hotels');
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_transport_rows WHERE quote_id='30000000-0000-0000-0000-000000000003')=20,'supplier A reads V3 transport');
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_activity_rows WHERE quote_id='30000000-0000-0000-0000-000000000003')=19,'supplier A reads V3 activities');
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_guide_rows WHERE quote_id='30000000-0000-0000-0000-000000000003')=11,'supplier A reads V3 guides');
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_other_rows WHERE quote_id='30000000-0000-0000-0000-000000000003')=1,'supplier A reads V3 other');
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_other_rows WHERE quote_id='40000000-0000-0000-0000-000000000001')=0,'supplier A cannot read B rows');
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_trip_quotes)=0,'supplier cannot directly read internal quote headers');
SELECT public.test_supplier_assert(jsonb_array_length(public.get_supplier_quote_versions_v2('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'))=4,'V1 V2 V3 V4 history remains readable');
DO $$ DECLARE q jsonb; i integer; BEGIN FOR i IN 1..4 LOOP
 q:=public.get_supplier_quote_version_v2(('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid);
 PERFORM public.test_supplier_assert((q->>'version_number')::integer=i AND NOT(q ?| ARRAY['commission_percent','commission_percentage','internal_notes','admin_notes','commission_amount_jpy']), 'historical V'||i||' identity and internal field redaction');
 END LOOP; END $$;
SELECT public.test_supplier_assert(public.get_supplier_trip_quote('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->>'version_number'='4','latest getter selects V4');
DO $$ BEGIN
 BEGIN UPDATE public.supplier_trip_quotes SET status='approved' WHERE id='30000000-0000-0000-0000-000000000004'; RAISE EXCEPTION 'FAIL: supplier direct self-approval'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: supplier direct self-approval denied'; END;
 BEGIN PERFORM public.review_supplier_quote_v2('30000000-0000-0000-0000-000000000004','approved',NULL); RAISE EXCEPTION 'FAIL: supplier RPC self-approval'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: supplier RPC self-approval denied'; END;
 BEGIN PERFORM public.set_supplier_quote_execution_status_v1('30000000-0000-0000-0000-000000000004','booking_in_progress'); RAISE EXCEPTION 'FAIL: execution before approval'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: execution before approval denied'; END;
END $$;
DO $$ DECLARE q jsonb; rows jsonb; pct numeric; BEGIN
 rows:=jsonb_build_object(
 'hotels',jsonb_build_array(jsonb_build_object('id','50000000-0000-0000-0000-000000000001','hotel_name','H','nights',1,'rooms_count',1,'room_count',1,'unit_price_jpy',1000,'subtotal_jpy',1000)),
 'transport',jsonb_build_array(jsonb_build_object('id','50000000-0000-0000-0000-000000000002','description','T','quantity',1,'unit_price_jpy',2000,'subtotal_jpy',2000)),
 'activities',jsonb_build_array(jsonb_build_object('id','50000000-0000-0000-0000-000000000003','activity_name','A','participant_count',1,'quantity',1,'unit_price_jpy',3000,'subtotal_jpy',3000)),
 'guides',jsonb_build_array(jsonb_build_object('id','50000000-0000-0000-0000-000000000004','guide_type','G','guides_count',1,'guide_count',1,'daily_price_jpy',4000,'subtotal_jpy',4000)),
 'other',jsonb_build_array(jsonb_build_object('id','50000000-0000-0000-0000-000000000005','label','Meals','quantity',1,'unit_price_jpy',5000,'subtotal_jpy',5000)));
 BEGIN PERFORM public.supplier_save_trip_quote_v2('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','draft','{"supplier_handling_percentage":10,"supplier_handling_categories":[]}',rows); RAISE EXCEPTION 'FAIL: empty positive handling scope'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: positive handling requires scope'; END;
 FOREACH pct IN ARRAY ARRAY[8,10,12] LOOP
 q:=public.supplier_save_trip_quote_v2('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','draft',jsonb_build_object('supplier_handling_percentage',pct,'supplier_handling_categories',jsonb_build_array('hotels','transport','activities','guides','other')),rows);
 PERFORM public.test_supplier_assert((q->>'supplier_handling_base_jpy')::numeric=15000 AND (q->>'supplier_handling_amount_jpy')::numeric=15000*pct/100,'all five categories server handling at '||pct||' percent');
 END LOOP;
 q:=public.supplier_save_trip_quote_v2('30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','submitted','{"participant_count":0,"supplier_handling_percentage":10,"supplier_handling_categories":["hotels","transport"],"supplier_handling_amount_jpy":999999,"validation_status":"draft","validation_snapshot":{"passports_complete":false,"rooming_complete":false,"documents_complete":false}}',rows);
 PERFORM public.test_supplier_assert(q->>'status'='submitted','quotation submits without participant passports rooming documents or booking confirmations');
 PERFORM public.test_supplier_assert((q->>'grand_total_jpy')::numeric=15000 AND (q->>'supplier_handling_base_jpy')::numeric=3000 AND (q->>'supplier_handling_amount_jpy')::numeric=300 AND (q->>'supplier_total_jpy')::numeric=15300,'partial category handling calculated server-side, forged amount ignored');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_hotel_rows)=0 AND (SELECT count(*) FROM public.supplier_quote_other_rows)=1,'supplier B isolation from A');
DO $$ BEGIN BEGIN PERFORM public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000003'); RAISE EXCEPTION 'FAIL: cross supplier getter'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: cross supplier getter denied'; END; END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
SELECT public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_hotel_rows)=21 AND (SELECT count(*) FROM public.supplier_trip_quotes)=5,'staff reads all authorized quote headers and rows');
SELECT public.review_supplier_quote_line_v2('30000000-0000-0000-0000-000000000004','supplier_quote_hotel_rows','50000000-0000-0000-0000-000000000001',false,'approved');
SELECT public.test_supplier_assert((public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000004')->>'supplier_handling_base_jpy')::numeric=2000 AND (public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000004')->>'supplier_handling_amount_jpy')::numeric=200,'excluded selected service removed from handling base automatically');
SELECT public.test_supplier_assert((public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000004')->>'commission_amount_jpy')::numeric=1420,'internal commission remains separate on supplier total');
SELECT public.review_supplier_quote_v2('30000000-0000-0000-0000-000000000004','revision_requested','Please revise scope');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE q jsonb; BEGIN
 q:=public.create_supplier_quote_version_v2('30000000-0000-0000-0000-000000000004');
 PERFORM public.test_supplier_assert((q->>'version_number')::integer=5 AND (q->>'supplier_handling_percentage')::numeric=10 AND q->'supplier_handling_categories'='["hotels","transport"]'::jsonb,'LOCAL revision clone versions handling percentage and scope');
 PERFORM public.test_supplier_assert(public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000004')->>'status'='archived','superseded revision remains readable and assignment active');
END $$;
-- Test execution on existing synthetic approved V3; no commercial prices updated.
SELECT public.set_supplier_quote_reservation_status_v1('30000000-0000-0000-0000-000000000003','supplier_quote_hotel_rows',NULL,'confirmed');
DO $$ BEGIN BEGIN PERFORM public.set_supplier_quote_execution_status_v1('30000000-0000-0000-0000-000000000003','operationally_confirmed'); RAISE EXCEPTION 'FAIL: incomplete reservations'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: final execution requires reservations, independent of quotation'; END; END $$;
SELECT public.set_supplier_quote_reservation_status_v1('30000000-0000-0000-0000-000000000003','supplier_quote_transport_rows',NULL,'confirmed');
SELECT public.set_supplier_quote_reservation_status_v1('30000000-0000-0000-0000-000000000003','supplier_quote_activity_rows',NULL,'confirmed');
SELECT public.set_supplier_quote_reservation_status_v1('30000000-0000-0000-0000-000000000003','supplier_quote_guide_rows',NULL,'confirmed');
SELECT public.set_supplier_quote_reservation_status_v1('30000000-0000-0000-0000-000000000003','supplier_quote_other_rows',NULL,'confirmed');
SELECT public.set_supplier_quote_execution_status_v1('30000000-0000-0000-0000-000000000003','operationally_confirmed');
SELECT public.test_supplier_assert(public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000003')->>'supplier_execution_status'='operationally_confirmed' AND (public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000003')->>'grand_total_jpy')::numeric=71,'reservation execution works without modifying approved financial total');
-- Staff approval does not require operational dossier completion.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
-- Access server copy of the locally-created revision, then submit as its supplier.
RESET ROLE;
UPDATE public.supplier_trip_quotes SET status='submitted' WHERE version_number=5 AND supplier_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$ DECLARE latest jsonb; BEGIN
 latest:=public.get_supplier_quote_versions_v2('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->0;
 PERFORM public.review_supplier_quote_v2((latest->>'id')::uuid,'approved','Approved quotation, operations pending');
 PERFORM public.test_supplier_assert(public.get_supplier_quote_version_v2((latest->>'id')::uuid)->>'status'='approved','staff approval independent from operations');
 PERFORM public.test_supplier_assert((public.get_supplier_quote_version_v2('30000000-0000-0000-0000-000000000003')->>'grand_total_jpy')::numeric=71,'superseded approved historical prices preserved');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE parent jsonb; child jsonb; payload jsonb; BEGIN
 parent:=public.get_supplier_quote_versions_v2('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')->0;
 child:=public.create_supplier_quote_version_v2((parent->>'id')::uuid);
 PERFORM public.test_supplier_assert((child->>'supplier_handling_percentage')::numeric=10 AND (child->>'supplier_handling_amount_jpy')::numeric=200,'approved clone preserves handling financial terms');
 payload:=jsonb_build_object(
 'hotels',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.supplier_quote_hotel_rows r WHERE quote_id=(child->>'id')::uuid),
 'transport',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.supplier_quote_transport_rows r WHERE quote_id=(child->>'id')::uuid),
 'activities',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.supplier_quote_activity_rows r WHERE quote_id=(child->>'id')::uuid),
 'guides',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.supplier_quote_guide_rows r WHERE quote_id=(child->>'id')::uuid),
 'other',(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM public.supplier_quote_other_rows r WHERE quote_id=(child->>'id')::uuid));
 child:=public.supplier_save_trip_quote_v2((child->>'id')::uuid,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','draft','{"supplier_handling_percentage":12,"supplier_handling_categories":["activities","guides","other"]}',payload);
 PERFORM public.test_supplier_assert((child->>'supplier_handling_base_jpy')::numeric=12000 AND (child->>'supplier_handling_amount_jpy')::numeric=1440,'new revision scope changes only selected categories');
 PERFORM public.test_supplier_assert(public.get_supplier_quote_version_v2((parent->>'id')::uuid)->'supplier_handling_categories'='["hotels","transport"]'::jsonb AND (public.get_supplier_quote_version_v2((parent->>'id')::uuid)->>'supplier_handling_percentage')::numeric=10 AND (public.get_supplier_quote_version_v2((parent->>'id')::uuid)->>'supplier_handling_amount_jpy')::numeric=200,'approved parent handling percentage scope and amount remain frozen after revision');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
-- Staff must not directly overwrite supplier prices, even when executing owner functions.
RESET ROLE;
DO $$ BEGIN
 BEGIN UPDATE public.supplier_quote_transport_rows SET unit_price_jpy=9999 WHERE id='50000000-0000-0000-0000-000000000002'; RAISE EXCEPTION 'FAIL: staff overwrote supplier price'; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: staff supplier price overwrite denied by trigger'; END;
END $$;
-- Explicit conversion retains the source fee row and prevents double counting on later staff review.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
RESET ROLE;
INSERT INTO public.supplier_quote_other_rows(id,quote_id,label,quantity,unit_price_jpy,subtotal_jpy,comment)
 VALUES('60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Tapis volant Handling',1,10,10,'Nature Excel : handling fournisseur');
SET LOCAL ROLE authenticated;
DO $$ DECLARE q jsonb; payload jsonb; BEGIN
 payload:=jsonb_build_object('other',(SELECT jsonb_agg(to_jsonb(r)) FROM public.supplier_quote_other_rows r WHERE quote_id='40000000-0000-0000-0000-000000000001'));
 BEGIN PERFORM public.supplier_save_trip_quote_v2('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','draft','{"supplier_handling_percentage":10,"supplier_handling_categories":["other"],"supplier_handling_confirmed":false}',payload); RAISE EXCEPTION 'FAIL: silent legacy handling conversion'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: legacy handling conversion requires explicit supplier confirmation'; END;
 q:=public.supplier_save_trip_quote_v2('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','draft','{"supplier_handling_percentage":10,"supplier_handling_categories":["other"],"supplier_handling_confirmed":true}',payload);
 PERFORM public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_other_rows WHERE quote_id='40000000-0000-0000-0000-000000000001')=2 AND (SELECT included_in_total=false AND unit_price_jpy=10 FROM public.supplier_quote_other_rows WHERE id='60000000-0000-0000-0000-000000000001'),'legacy conversion retains source row and price while excluding duplicate fee');
 PERFORM public.test_supplier_assert((q->>'grand_total_jpy')::numeric=1 AND (q->>'supplier_handling_base_jpy')::numeric=1 AND (q->>'supplier_handling_amount_jpy')::numeric=0.1,'legacy fee never enters new handling base');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$ BEGIN
 BEGIN UPDATE public.supplier_quote_other_rows SET included_in_total=true WHERE id='60000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'FAIL: duplicate handling fee re-inclusion'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: re-including a legacy fee alongside quote-level handling denied'; END;
END $$;
-- Import tests use only synthetic supplier B data. Failure is atomic, successful import is rolled back below.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$ DECLARE q jsonb; services jsonb:='{"other":[{"label":"Restaurant","quantity":1,"unit_price_jpy":100}]}'; metadata jsonb;
BEGIN
 metadata:='{"financial_summary":{"supplierHandlingJpy":12},"supplier_handling":{"percentage":12,"categories":["other"],"scope_confirmed":false,"source_rows":[{"source_row":42,"amount_jpy":12}]}}';
 BEGIN PERFORM public.import_supplier_quote_excel_v1('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','new_version','fixture.xlsx','First sheet',services,0,metadata); RAISE EXCEPTION 'FAIL: import unconfirmed handling scope'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: import requires handling scope confirmation'; END;
 metadata:=jsonb_set(metadata,'{supplier_handling,scope_confirmed}','true');
 metadata:=jsonb_set(metadata,'{financial_summary,supplierHandlingJpy}','15');
 BEGIN PERFORM public.import_supplier_quote_excel_v1('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','new_version','fixture.xlsx','First sheet',services,0,metadata); RAISE EXCEPTION 'FAIL: unacknowledged import discrepancy'; EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS: import discrepancy requires acknowledgment and rolls back'; END;
 PERFORM public.test_supplier_assert(jsonb_array_length(public.get_supplier_quote_versions_v2('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'))=1,'failed import did not create a version');
 metadata:=metadata||'{"supplier_handling":{"percentage":12,"categories":["other"],"scope_confirmed":true,"mismatch_acknowledged":true,"source_amount_jpy":15,"source_rows":[{"source_row":42,"amount_jpy":15}]}}';
 q:=public.import_supplier_quote_excel_v1('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','new_version','fixture.xlsx','First sheet',services,0,metadata);
 PERFORM public.test_supplier_assert((q->>'imported_line_count')::integer=1 AND (q->>'supplier_handling_percentage')::numeric=12 AND (q->>'supplier_handling_amount_jpy')::numeric=12 AND (q->>'supplier_total_jpy')::numeric=112,'import handling is quote level, generic meal service preserved');
 PERFORM public.test_supplier_assert((SELECT count(*) FROM public.supplier_quote_other_rows WHERE quote_id=(q->>'id')::uuid)=1,'import creates no handling Other row');
 PERFORM public.test_supplier_assert(q->'validation_metadata'->'excel_import'->'handling_reconciliation'->>'source_amount_jpy'='15' AND (q->'validation_metadata'->'excel_import'->'handling_reconciliation'->>'calculated_amount_jpy')::numeric=12,'import preserves mismatching source amount and calculated amount separately');
 q:=public.save_supplier_operational_state_v2((q->>'id')::uuid,NULL,'draft','{}','{}',0);
 PERFORM public.test_supplier_assert(q->'validation_metadata'->'excel_import'->'supplier_handling'->'source_rows' IS NOT NULL,'operational save preserves Excel source audit');
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['supplier_quote_hotel_rows','supplier_quote_transport_rows','supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows','supplier_trip_quotes'] LOOP
 BEGIN EXECUTE format('SELECT 1 FROM public.%I',t); RAISE EXCEPTION 'FAIL: anon read %',t; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: anon denied %',t; END;
 END LOOP;
END $$;
SELECT public.test_supplier_assert(NOT has_function_privilege('anon','public.set_supplier_quote_execution_status_v1(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','public.set_supplier_quote_reservation_status_v1(uuid,text,uuid,text)','EXECUTE'),'anon cannot invoke new execution or reservation RPCs');
ROLLBACK;
