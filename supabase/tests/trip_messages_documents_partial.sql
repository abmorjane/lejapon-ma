-- LOCAL ONLY: checks after migrating the synthetic centers_partial fixture.
-- Read-only checks; production schema/data must never be used as this fixture.
begin read only;
do $$ begin
 if not exists(select 1 from public.trip_messages where
  id='61000000-0000-0000-0000-000000000001' and body='Preserved historical message'
  and sender_source='supplier' and metadata='{"audit":"preserve"}'::jsonb)
 then raise exception 'Partial message history was changed'; end if;
 if not exists(select 1 from public.trip_documents where
  id='71000000-0000-0000-0000-000000000001' and title='Preserved historical voucher'
  and category='hotel_vouchers' and file_name='legacy.pdf'
  and metadata='{"audit":"preserve"}'::jsonb and supplier_visible)
 then raise exception 'Partial document history or supplier visibility was changed'; end if;
 if not exists(select 1 from storage.buckets where id='trip-documents' and not public
  and name='custom historical documents' and file_size_limit=123456
  and allowed_mime_types=array['application/pdf'])
 then raise exception 'Existing bucket privacy/configuration repair failed'; end if;
 if has_any_column_privilege('anon','public.trip_messages','SELECT')
  or has_table_privilege('anon','public.trip_documents','SELECT')
 then raise exception 'Historical anon column/table grants remain'; end if;
 if exists(select 1 from pg_policies where schemaname='public'
  and tablename in ('trip_messages','trip_message_attachments','trip_message_reads','trip_documents')
  and roles<>array['authenticated']::name[])
 then raise exception 'Historical PUBLIC module policies remain'; end if;
 if exists(select 1 from pg_policies where schemaname='storage' and policyname='supplier read trip document files')
 then raise exception 'Historical folder-only document read bypass remains'; end if;
 if (select count(*) from pg_trigger where tgname='guard_archived_trip_supplier_writes'
  and tgenabled='O' and tgrelid in ('public.trip_messages'::regclass,'public.trip_message_attachments'::regclass,
  'public.trip_message_reads'::regclass,'public.trip_documents'::regclass))<>4
 then raise exception 'Partial deployment archive guards missing'; end if;
 raise notice 'PASS: nonempty partial history preserved, columns completed, bucket configuration preserved, PUBLIC/anon grants repaired, archive guards attached';
end $$;
rollback;
