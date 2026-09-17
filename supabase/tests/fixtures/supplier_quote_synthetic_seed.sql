-- Synthetic local-only test data, not production quote data.
INSERT INTO auth.users(id) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,3) i;
INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-000000000003','admin');
INSERT INTO public.suppliers(id,name) VALUES ('10000000-0000-0000-0000-000000000001','A'),('10000000-0000-0000-0000-000000000002','B');
INSERT INTO public.supplier_members(supplier_id,user_id) VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
INSERT INTO public.trips(id,title) VALUES ('20000000-0000-0000-0000-000000000001','Synthetic trip');
INSERT INTO public.supplier_trip_quotes(id,trip_id,supplier_id,version_number,status,grand_total_jpy,commission_percent,admin_notes)
 SELECT ('30000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',i,CASE WHEN i=3 THEN 'approved' WHEN i=4 THEN 'draft' ELSE 'archived' END,71,17,'PRIVATE'
 FROM generate_series(1,4) i;
INSERT INTO public.supplier_trip_quotes(id,trip_id,supplier_id,status) VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','draft');
INSERT INTO public.supplier_quote_hotel_rows(quote_id,hotel_name,rooms_count,room_count,nights,unit_price_jpy,subtotal_jpy) SELECT '30000000-0000-0000-0000-000000000003','Hotel',1,1,1,1,1 FROM generate_series(1,20);
INSERT INTO public.supplier_quote_transport_rows(quote_id,description,quantity,unit_price_jpy,subtotal_jpy) SELECT '30000000-0000-0000-0000-000000000003','Transport',1,1,1 FROM generate_series(1,20);
INSERT INTO public.supplier_quote_activity_rows(quote_id,activity_name,participant_count,quantity,unit_price_jpy,subtotal_jpy) SELECT '30000000-0000-0000-0000-000000000003','Activity',1,1,1,1 FROM generate_series(1,19);
INSERT INTO public.supplier_quote_guide_rows(quote_id,guide_type,guides_count,guide_count,daily_price_jpy,subtotal_jpy) SELECT '30000000-0000-0000-0000-000000000003','Guide',1,1,1,1 FROM generate_series(1,11);
INSERT INTO public.supplier_quote_other_rows(quote_id,label,quantity,unit_price_jpy,subtotal_jpy) VALUES ('30000000-0000-0000-0000-000000000003','Meal',1,1,1);
INSERT INTO public.supplier_quote_other_rows(quote_id,label,quantity,unit_price_jpy,subtotal_jpy) VALUES ('40000000-0000-0000-0000-000000000001','B private cost',1,1,1);
CREATE TABLE public.audit_old_quotes AS SELECT id,to_jsonb(q) data FROM public.supplier_trip_quotes q;
CREATE TABLE public.audit_old_rows AS SELECT to_jsonb(r) data FROM public.supplier_quote_hotel_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_transport_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_activity_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_guide_rows r UNION ALL SELECT to_jsonb(r) FROM public.supplier_quote_other_rows r;
