-- LOCAL ONLY. Requires the disposable audited fixtures and the new migration.
-- Synthetic messages/files only. Never run this write test in production.
-- All tests roll back. No quote save/import/version-creation RPC is called.
begin;
create function public.trip_center_test_assert(ok boolean,label text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'FAIL: %',label; end if;
  perform set_config('lejapon.trip_center_assertions',
    (coalesce(nullif(current_setting('lejapon.trip_center_assertions',true),''),'0')::int+1)::text,true);
  raise notice 'PASS: %',label;
end $$;
create function public.trip_center_test_no_write(command text,label text) returns void
language plpgsql as $$ declare affected bigint; begin
  begin
    execute command; get diagnostics affected=row_count;
    if affected <> 0 then raise exception 'FAIL: unexpected affected rows: %',label; end if;
  exception when sqlstate '42501' or sqlstate '55000' then null;
  end;
  perform public.trip_center_test_assert(true,label);
end $$;

select public.trip_center_test_assert(
 (select count(*) from storage.buckets where id in ('trip-documents','trip-message-attachments') and not public)=2,
 'both target buckets private');
select public.trip_center_test_assert(not exists(select 1 from pg_policies where
 (schemaname='public' and tablename in ('trip_messages','trip_message_attachments','trip_message_reads','trip_documents'))
 and roles<>array['authenticated']::name[]), 'all module policies explicitly authenticated');
select public.trip_center_test_assert(not exists(select 1 from pg_policies where schemaname='storage'
 and policyname like 'supplier %' and ((coalesce(qual,'')||coalesce(with_check,'')) like '%trip-documents%'
 or (coalesce(qual,'')||coalesce(with_check,'')) like '%trip-message-attachments%')
 and roles<>array['authenticated']::name[]), 'all target-bucket supplier policies explicitly authenticated, including shared FIT');
select public.trip_center_test_assert((select count(*) from pg_trigger where not tgisinternal
 and tgname='guard_archived_trip_supplier_writes' and tgenabled='O'
 and tgrelid in ('public.trip_messages'::regclass,'public.trip_message_attachments'::regclass,
 'public.trip_message_reads'::regclass,'public.trip_documents'::regclass))=4,
 'existing archive guard enabled on all four tables');

insert into public.trip_messages(id,trip_id,message_type,body,sender_id,sender_source)
select ('60000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 '21000000-0000-0000-0000-000000000001',message_type,'Synthetic '||message_type,
 case when i=1 then '00000000-0000-0000-0000-000000000003'::uuid else '00000000-0000-0000-0000-000000000001'::uuid end,
 case when i=1 then 'admin' else 'supplier' end
from unnest(array['general','hotel','transport','activities','guides','urgent']) with ordinality t(message_type,i);
insert into public.trip_messages(id,trip_id,body,sender_id,sender_source) values
 ('60000000-0000-0000-0000-000000000007','21000000-0000-0000-0000-000000000002','B private','00000000-0000-0000-0000-000000000002','supplier'),
 ('60000000-0000-0000-0000-000000000008','21000000-0000-0000-0000-000000000003','A history','00000000-0000-0000-0000-000000000001','supplier');
insert into storage.buckets(id,name,public) values ('article-images','article-images',true);
insert into storage.objects(bucket_id,name,owner_id) values
 ('article-images','fixture-public.jpg',null),
 ('trip-documents','21000000-0000-0000-0000-000000000001/other/a.pdf','00000000-0000-0000-0000-000000000001'),
 ('trip-documents','21000000-0000-0000-0000-000000000001/other/hidden.pdf','00000000-0000-0000-0000-000000000003'),
 ('trip-documents','21000000-0000-0000-0000-000000000002/other/b.pdf','00000000-0000-0000-0000-000000000002'),
 ('trip-documents','21000000-0000-0000-0000-000000000003/other/history.pdf','00000000-0000-0000-0000-000000000001'),
 ('trip-message-attachments','21000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000002/a.pdf','00000000-0000-0000-0000-000000000001'),
 ('trip-message-attachments','21000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000007/b.pdf','00000000-0000-0000-0000-000000000002'),
 ('trip-message-attachments','21000000-0000-0000-0000-000000000003/60000000-0000-0000-0000-000000000008/history.pdf','00000000-0000-0000-0000-000000000001');
insert into public.trip_documents(id,trip_id,category,title,file_name,file_path,uploaded_by,supplier_visible) values
 ('70000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','other','A document','a.pdf','21000000-0000-0000-0000-000000000001/other/a.pdf','00000000-0000-0000-0000-000000000001',true),
 ('70000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000001','other','Hidden staff document','hidden.pdf','21000000-0000-0000-0000-000000000001/other/hidden.pdf','00000000-0000-0000-0000-000000000003',false),
 ('70000000-0000-0000-0000-000000000003','21000000-0000-0000-0000-000000000002','other','B document','b.pdf','21000000-0000-0000-0000-000000000002/other/b.pdf','00000000-0000-0000-0000-000000000002',true),
 ('70000000-0000-0000-0000-000000000004','21000000-0000-0000-0000-000000000003','other','A historical document','history.pdf','21000000-0000-0000-0000-000000000003/other/history.pdf','00000000-0000-0000-0000-000000000001',true);
insert into public.trip_documents(trip_id,category,title,file_name,uploaded_by)
select '21000000-0000-0000-0000-000000000001',category,category,'fixture.pdf','00000000-0000-0000-0000-000000000001'
from unnest(array['hotel_vouchers','transport_vouchers','guide_confirmations','flight_tickets','rooming_lists','emergency_contacts','contracts','other']) category;
insert into public.trip_message_attachments(message_id,file_name,file_path,uploaded_by) values
 ('60000000-0000-0000-0000-000000000002','a.pdf','21000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000002/a.pdf','00000000-0000-0000-0000-000000000001'),
 ('60000000-0000-0000-0000-000000000007','b.pdf','21000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000007/b.pdf','00000000-0000-0000-0000-000000000002'),
 ('60000000-0000-0000-0000-000000000008','history.pdf','21000000-0000-0000-0000-000000000003/60000000-0000-0000-0000-000000000008/history.pdf','00000000-0000-0000-0000-000000000001');
insert into public.trip_message_reads values
 ('60000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001',now());

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.trip_center_test_assert((select count(*) from public.trip_messages)=7,'A reads assigned active messages of all six types and historical messages');
select public.trip_center_test_assert((select count(*) from public.trip_message_attachments)=2,'A reads active and historical attachments, not B attachments');
select public.trip_center_test_assert((select count(distinct category) from public.trip_documents)=8,'all eight frontend document categories readable');
select public.trip_center_test_assert(not exists(select 1 from public.trip_documents where id in ('70000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000003')),'hidden staff documents and B documents inaccessible to A');
select public.trip_center_test_assert((select count(*) from public.trip_message_reads)=1,'A reads own historical receipts');
select public.trip_center_test_assert((select count(*) from storage.objects where bucket_id in ('trip-documents','trip-message-attachments'))=4,'A reads active/historical registered files, not hidden/B files');
insert into public.trip_messages(id,trip_id,body,sender_source) values
 ('60000000-0000-0000-0000-000000000011','21000000-0000-0000-0000-000000000001','New A message','japan_office');
update public.trip_messages set body='Edited own A message' where id='60000000-0000-0000-0000-000000000011';
select public.trip_center_test_assert(exists(select 1 from public.trip_messages where id='60000000-0000-0000-0000-000000000011' and body='Edited own A message'),'A creates and edits own active message');
select public.trip_center_test_no_write($q$update public.trip_messages set body='forged' where id='60000000-0000-0000-0000-000000000001'$q$,'supplier cannot modify staff message');
select public.trip_center_test_no_write($q$update public.trip_messages set trip_id='21000000-0000-0000-0000-000000000003' where id='60000000-0000-0000-0000-000000000011'$q$,'supplier cannot move message identity');
select public.trip_center_test_no_write($q$insert into public.trip_messages(trip_id,body,sender_source) values('21000000-0000-0000-0000-000000000002','forged B','supplier')$q$,'supplier cannot insert B trip message');
select public.trip_center_test_no_write($q$insert into public.trip_messages(trip_id,body,sender_id,sender_source) values('21000000-0000-0000-0000-000000000001','forged staff','00000000-0000-0000-0000-000000000003','supplier')$q$,'supplier cannot forge message sender');

-- Storage API writes ownership into owner_id. Verify owner_id-only uploads.
insert into storage.objects(bucket_id,name,owner_id) values
 ('trip-documents','21000000-0000-0000-0000-000000000001/other/new.pdf','00000000-0000-0000-0000-000000000001'),
 ('trip-message-attachments','21000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000011/new.pdf','00000000-0000-0000-0000-000000000001');
insert into public.trip_documents(id,trip_id,category,file_name,file_path) values
 ('70000000-0000-0000-0000-000000000011','21000000-0000-0000-0000-000000000001','other','new.pdf','21000000-0000-0000-0000-000000000001/other/new.pdf');
insert into public.trip_message_attachments(id,message_id,file_name,file_path) values
 ('80000000-0000-0000-0000-000000000011','60000000-0000-0000-0000-000000000011','new.pdf','21000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000011/new.pdf');
update public.trip_documents set title='Own revised document',version=2 where id='70000000-0000-0000-0000-000000000011';
select public.trip_center_test_assert(exists(select 1 from public.trip_documents where id='70000000-0000-0000-0000-000000000011' and version=2),'A uploads, registers and updates own active document without recursive RLS');
update public.trip_message_attachments set file_name='renamed.pdf' where id='80000000-0000-0000-0000-000000000011';
select public.trip_center_test_assert(exists(select 1 from public.trip_message_attachments where id='80000000-0000-0000-0000-000000000011' and file_name='renamed.pdf'),'A registers and updates own active attachment without recursive RLS');
select public.trip_center_test_no_write($q$insert into public.trip_documents(trip_id,file_name,file_path) values('21000000-0000-0000-0000-000000000001','borrowed.pdf','21000000-0000-0000-0000-000000000001/other/hidden.pdf')$q$,'A cannot claim hidden staff file via forged document metadata');
select public.trip_center_test_no_write($q$insert into public.trip_message_attachments(message_id,file_name) values('60000000-0000-0000-0000-000000000001','forged.pdf')$q$,'A cannot attach files to a staff message');
select public.trip_center_test_no_write($q$update public.trip_documents set uploaded_by='00000000-0000-0000-0000-000000000002' where id='70000000-0000-0000-0000-000000000011'$q$,'A cannot reassign document uploader');
insert into public.trip_message_reads(message_id,user_id) values('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')
on conflict(message_id,user_id) do update set read_at=now();
select public.trip_center_test_assert((select count(*) from public.trip_message_reads)=2,'active own read-receipt upsert works');
select public.trip_center_test_no_write($q$insert into public.trip_message_reads(message_id,user_id) values('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')$q$,'cannot forge another user read receipt');
select public.trip_center_test_no_write($q$insert into public.trip_message_reads(message_id,user_id) values('60000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001')$q$,'cannot mark B message read');

-- Shared FIT rules remain usable after TO authenticated hardening.
insert into storage.objects(bucket_id,name,owner) values('trip-documents',
 'fit/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/fixture.pdf',
 '00000000-0000-0000-0000-000000000001');
select public.trip_center_test_assert(exists(select 1 from storage.objects where name like 'fit/%'),'existing authenticated supplier FIT upload/read authorization preserved');

-- Exercise deletes as Storage API would, retaining its audited delete guard.
set local storage.allow_delete_query='true';
delete from public.trip_message_attachments where id='80000000-0000-0000-0000-000000000011';
delete from storage.objects where bucket_id='trip-message-attachments' and name like '%/new.pdf';
update public.trip_documents set deleted_at=now() where id='70000000-0000-0000-0000-000000000011';
select public.trip_center_test_assert(not exists(select 1 from public.trip_documents where id='70000000-0000-0000-0000-000000000011' and deleted_at is null),'own active document soft deletion works with existing frontend filter');
select public.trip_center_test_assert(not exists(select 1 from public.trip_message_attachments where id='80000000-0000-0000-0000-000000000011'),'own active attachment deletion works');
select public.trip_center_test_no_write($q$delete from storage.objects where name like '%/hidden.pdf'$q$,'cannot delete another user file');

-- Archive writes may return zero affected rows under RLS instead of exceptions.
do $$ declare command text; begin
  foreach command in array array[
   $q$insert into public.trip_messages(trip_id,body,sender_source) values('21000000-0000-0000-0000-000000000003','forged history','supplier')$q$,
   $q$update public.trip_messages set body='forged history' where id='60000000-0000-0000-0000-000000000008'$q$,
   $q$delete from public.trip_messages where id='60000000-0000-0000-0000-000000000008'$q$,
   $q$insert into public.trip_message_attachments(message_id,file_name) values('60000000-0000-0000-0000-000000000008','new history')$q$,
   $q$update public.trip_message_attachments set file_name='forged history' where message_id='60000000-0000-0000-0000-000000000008'$q$,
   $q$delete from public.trip_message_attachments where message_id='60000000-0000-0000-0000-000000000008'$q$,
   $q$insert into public.trip_documents(trip_id,file_name) values('21000000-0000-0000-0000-000000000003','new history')$q$,
   $q$update public.trip_documents set title='forged history' where id='70000000-0000-0000-0000-000000000004'$q$,
   $q$delete from public.trip_documents where id='70000000-0000-0000-0000-000000000004'$q$,
   $q$insert into public.trip_message_reads(message_id,user_id) values('60000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001') on conflict(message_id,user_id) do update set read_at=now()$q$,
   $q$delete from public.trip_message_reads where message_id='60000000-0000-0000-0000-000000000008'$q$,
   $q$insert into storage.objects(bucket_id,name,owner_id) values('trip-documents','21000000-0000-0000-0000-000000000003/other/new.pdf','00000000-0000-0000-0000-000000000001')$q$,
   $q$insert into storage.objects(bucket_id,name,owner_id) values('trip-message-attachments','21000000-0000-0000-0000-000000000003/60000000-0000-0000-0000-000000000008/new.pdf','00000000-0000-0000-0000-000000000001')$q$,
   $q$update storage.objects set metadata='{"forged":true}' where name like '21000000-0000-0000-0000-000000000003/%'$q$,
   $q$delete from storage.objects where name like '21000000-0000-0000-0000-000000000003/%'$q$
  ] loop
    perform public.trip_center_test_no_write(command,'archived write rejected: '||split_part(command,' ',1)||' '||split_part(command,' ',3));
  end loop;
end $$;
select public.trip_center_test_no_write($q$insert into storage.objects(bucket_id,name,owner_id) values('trip-documents','not-a-uuid/other/new.pdf','00000000-0000-0000-0000-000000000001')$q$,'malformed trip path rejected without unsafe UUID casts');
select public.trip_center_test_no_write($q$insert into storage.objects(bucket_id,name,owner_id) values('trip-documents','21000000-0000-0000-0000-000000000002/other/new.pdf','00000000-0000-0000-0000-000000000001')$q$,'cannot upload to B trip folder');
select public.trip_center_test_no_write($q$insert into storage.objects(bucket_id,name,owner_id) values('trip-documents','21000000-0000-0000-0000-000000000001/other/forged.pdf','00000000-0000-0000-0000-000000000002')$q$,'cannot forge file ownership');
update storage.objects set metadata='{"owner_update":true}' where bucket_id='trip-documents' and name like '%/a.pdf';
select public.trip_center_test_assert(exists(select 1 from storage.objects where metadata='{"owner_update":true}'::jsonb),'owner can update active file metadata');
select public.trip_center_test_no_write($q$update storage.objects set owner_id='00000000-0000-0000-0000-000000000002' where bucket_id='trip-documents' and name like '%/a.pdf'$q$,'owner cannot transfer file ownership');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select public.trip_center_test_assert((select count(*) from public.trip_messages)=1 and (select count(*) from public.trip_documents)=1 and (select count(*) from public.trip_message_attachments)=1,'B reads only its assigned module content');
select public.trip_center_test_assert((select count(*) from storage.objects where bucket_id in ('trip-documents','trip-message-attachments'))=2,'B cannot read A or FIT files');
select public.trip_center_test_assert((select count(*) from public.trip_message_reads)=0,'B cannot read A receipts');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select public.trip_center_test_assert(exists(select 1 from public.trip_documents where id='70000000-0000-0000-0000-000000000002'),'staff reads hidden documents');
select public.trip_center_test_assert((select count(*) from public.trip_messages)=9,'staff reads both suppliers and archive');
insert into public.trip_messages(trip_id,body,sender_source) values('21000000-0000-0000-0000-000000000003','Staff archive update','admin');
insert into public.trip_documents(trip_id,title,file_name) values('21000000-0000-0000-0000-000000000003','Staff archive document','staff.pdf');
insert into storage.objects(bucket_id,name,owner_id) values('trip-documents','21000000-0000-0000-0000-000000000003/other/staff.pdf','00000000-0000-0000-0000-000000000003');
update public.trip_documents set title='Staff edited historical document' where id='70000000-0000-0000-0000-000000000004';
select public.trip_center_test_assert(exists(select 1 from public.trip_documents where title='Staff edited historical document'),'staff current archive write rules preserved');

-- Prove archive triggers also reject writes through a permissive policy, as
-- defense against future RPC/policy mistakes. These temporary test policies
-- exist only inside this rolled-back, isolated synthetic test transaction.
reset role;
do $$ declare t text; begin
 foreach t in array array['trip_messages','trip_message_attachments','trip_message_reads','trip_documents'] loop
  execute format('create policy "LOCAL archive guard probe" on public.%I for all to authenticated using(true) with check(true)',t);
 end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.trip_center_test_no_write($q$insert into public.trip_messages(trip_id,body,sender_source) values('21000000-0000-0000-0000-000000000003','probe','supplier')$q$,'message archive trigger independently rejects write');
select public.trip_center_test_no_write($q$insert into public.trip_documents(trip_id,file_name) values('21000000-0000-0000-0000-000000000003','probe')$q$,'document archive trigger independently rejects write');
select public.trip_center_test_no_write($q$insert into public.trip_message_attachments(message_id,file_name) values('60000000-0000-0000-0000-000000000008','probe')$q$,'attachment archive trigger resolves parent and independently rejects write');
select public.trip_center_test_no_write($q$insert into public.trip_message_reads(message_id,user_id) values('60000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000099')$q$,'receipt archive trigger resolves parent and independently rejects write');
reset role;
do $$ declare t text; begin
 foreach t in array array['trip_messages','trip_message_attachments','trip_message_reads','trip_documents'] loop
  execute format('drop policy "LOCAL archive guard probe" on public.%I',t);
 end loop;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare t text; begin
 foreach t in array array['trip_messages','trip_message_attachments','trip_message_reads','trip_documents'] loop
  perform public.trip_center_test_no_write('select * from public.'||t,'anon module SELECT denied: '||t);
 end loop;
end $$;
select public.trip_center_test_assert((select count(*) from storage.objects where bucket_id in ('trip-documents','trip-message-attachments'))=0,'anon private-file object SELECT denied, including shared FIT files');
select public.trip_center_test_assert((select count(*) from storage.objects where bucket_id='article-images')=1,'unrelated public file access unchanged');
select public.trip_center_test_assert((select count(*) from public.trips)=3,'anonymous public trips still load active catalogue without supplier helper errors');

reset role;
select public.trip_center_test_assert(not exists(
 (select id,to_jsonb(q) from public.supplier_trip_quotes q except select id,data from public.trip_centers_quote_snapshot)
 union all (select id,data from public.trip_centers_quote_snapshot except select id,to_jsonb(q) from public.supplier_trip_quotes q)
),'all synthetic V1/V2/V3/V4/B quote values byte-for-byte unchanged');
select public.trip_center_test_assert(not exists(
 (select * from public.trip_centers_financial_snapshot except
  (select 'hotels',to_jsonb(r) from public.supplier_quote_hotel_rows r union all select 'transport',to_jsonb(r) from public.supplier_quote_transport_rows r union all select 'activities',to_jsonb(r) from public.supplier_quote_activity_rows r union all select 'guides',to_jsonb(r) from public.supplier_quote_guide_rows r union all select 'other',to_jsonb(r) from public.supplier_quote_other_rows r))
 union all ((select 'hotels',to_jsonb(r) from public.supplier_quote_hotel_rows r union all select 'transport',to_jsonb(r) from public.supplier_quote_transport_rows r union all select 'activities',to_jsonb(r) from public.supplier_quote_activity_rows r union all select 'guides',to_jsonb(r) from public.supplier_quote_guide_rows r union all select 'other',to_jsonb(r) from public.supplier_quote_other_rows r) except select * from public.trip_centers_financial_snapshot)
),'all synthetic financial row values unchanged');
select public.trip_center_test_assert((select count(*) from public.trip_centers_financial_snapshot where data->>'quote_id'='30000000-0000-0000-0000-000000000003')=71,'synthetic V3 71 financial rows preserved');
select public.trip_center_test_assert(not exists(select 1 from public.trip_centers_policy_snapshot s
 left join pg_policies p on p.schemaname=s.schemaname and p.tablename=s.tablename and p.policyname=s.policyname
 where s.schemaname='public' and to_jsonb(s) is distinct from to_jsonb(p)), 'public trips and all existing financial RLS policies unchanged');
select public.trip_center_test_assert(not exists(select 1 from public.trip_centers_policy_snapshot s
 join pg_policies p on p.schemaname=s.schemaname and p.tablename=s.tablename and p.policyname=s.policyname
 where s.policyname like 'supplier FIT %' and (p.qual is distinct from s.qual or p.with_check is distinct from s.with_check or p.cmd<>s.cmd)),'shared FIT policy predicates unchanged');
select current_setting('lejapon.trip_center_assertions') as passed_assertions;
rollback;
