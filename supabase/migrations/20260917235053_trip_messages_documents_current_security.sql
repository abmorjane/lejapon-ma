-- LeJapon.ma only; audited 2026-09-17T23:49:28Z, project nxnncbddtpjusrnhilxk.
-- All four module tables and both buckets were ABSENT in the supplied export.
-- Additive repair, not a replay of either 20260606 historical migration.
-- No quote/financial writes; no public trips policy changes; no data deletion.
-- Run this ONE complete file in the correct SQL Editor after staging verification.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
declare signature text; p record;
begin
  foreach signature in array array[
    'public.is_staff(uuid)', 'public.supplier_can_access_trip(uuid,uuid)',
    'public.supplier_can_edit_trip(uuid,uuid)',
    'public.supplier_can_access_trip_document_file(uuid,text)',
    'public.guard_archived_trip_supplier_writes()'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'Trip centers prerequisite missing: %', signature;
    end if;
    if signature <> 'public.guard_archived_trip_supplier_writes()'
      and not has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE') then
      raise exception 'Trip centers prerequisite not executable by authenticated: %', signature;
    end if;
    if signature like 'public.supplier_can_%'
      and has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE') then
      raise exception 'Unexpected anonymous supplier helper privilege: %', signature;
    end if;
  end loop;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Supabase Storage must exist before installing trip centers';
  end if;
  for p in select * from pg_policies where schemaname='storage' and tablename='objects'
    and (coalesce(qual,'')||coalesce(with_check,'')) ~ '(trip-documents|trip-message-attachments)' loop
    if p.policyname <> all(array[
      'supplier FIT document read','supplier FIT document upload',
      'staff manage trip document files','staff manage trip message attachment files',
      'supplier read trip document files','supplier read authorized trip document files',
      'supplier read own editable trip document uploads','supplier read trip message attachment files',
      'supplier upload trip document files','supplier update own trip document files','supplier delete own trip document files',
      'supplier upload trip message attachment files','supplier update own trip message attachment files','supplier delete own trip message attachment files',
      'trip centers deny anonymous files'
    ]) then
      raise exception 'Unreviewed trip centers Storage policy: %; review before migration',p.policyname;
    end if;
  end loop;
end $preflight$;

create table if not exists public.trip_messages ();
create table if not exists public.trip_message_attachments ();
create table if not exists public.trip_message_reads ();
create table if not exists public.trip_documents ();

-- Complete partial historical schemas without converting types or inventing
-- parent/owner values. Invalid existing data aborts this transaction unchanged.
do $columns$
declare c record; actual_type oid; generated text;
begin
  for c in select * from (values
    ('trip_messages','id','uuid','gen_random_uuid()',true),
    ('trip_messages','trip_id','uuid',null,true),
    ('trip_messages','quote_id','uuid',null,false),
    ('trip_messages','message_type','text','''general''',true),
    ('trip_messages','body','text',null,true),
    ('trip_messages','sender_id','uuid','auth.uid()',true),
    ('trip_messages','sender_name','text',null,false),
    ('trip_messages','sender_role','text',null,false),
    ('trip_messages','sender_source','text','''admin''',true),
    ('trip_messages','metadata','jsonb','''{}''::jsonb',true),
    ('trip_messages','deleted_at','timestamptz',null,false),
    ('trip_messages','created_at','timestamptz','now()',true),
    ('trip_messages','updated_at','timestamptz','now()',true),
    ('trip_message_attachments','id','uuid','gen_random_uuid()',true),
    ('trip_message_attachments','message_id','uuid',null,true),
    ('trip_message_attachments','file_name','text',null,true),
    ('trip_message_attachments','file_path','text',null,false),
    ('trip_message_attachments','file_url','text',null,false),
    ('trip_message_attachments','mime_type','text',null,false),
    ('trip_message_attachments','size_bytes','bigint',null,false),
    ('trip_message_attachments','uploaded_by','uuid','auth.uid()',true),
    ('trip_message_attachments','created_at','timestamptz','now()',true),
    ('trip_message_reads','message_id','uuid',null,true),
    ('trip_message_reads','user_id','uuid','auth.uid()',true),
    ('trip_message_reads','read_at','timestamptz','now()',true),
    ('trip_documents','id','uuid','gen_random_uuid()',true),
    ('trip_documents','trip_id','uuid',null,true),
    ('trip_documents','quote_id','uuid',null,false),
    ('trip_documents','category','text','''other''',true),
    ('trip_documents','title','text','''''',true),
    ('trip_documents','file_name','text','''''',true),
    ('trip_documents','file_path','text',null,false),
    ('trip_documents','file_url','text',null,false),
    ('trip_documents','mime_type','text',null,false),
    ('trip_documents','size_bytes','bigint',null,false),
    ('trip_documents','version','integer','1',true),
    ('trip_documents','uploaded_by','uuid','auth.uid()',true),
    ('trip_documents','uploaded_by_name','text',null,false),
    ('trip_documents','uploaded_by_role','text',null,false),
    ('trip_documents','uploaded_at','timestamptz','now()',true),
    ('trip_documents','metadata','jsonb','''{}''::jsonb',true),
    ('trip_documents','deleted_at','timestamptz',null,false),
    ('trip_documents','created_at','timestamptz','now()',true),
    ('trip_documents','updated_at','timestamptz','now()',true),
    ('trip_documents','supplier_visible','boolean','true',true)
  ) required(table_name,column_name,type_name,default_sql,required_not_null) loop
    execute format('alter table public.%I add column if not exists %I %s%s%s',
      c.table_name,c.column_name,c.type_name,
      case when c.default_sql is null then '' else ' default '||c.default_sql end,
      case when c.required_not_null then ' not null' else '' end);
    select a.atttypid,a.attgenerated::text into actual_type,generated
    from pg_attribute a where a.attrelid=to_regclass('public.'||c.table_name)
      and a.attname=c.column_name and not a.attisdropped;
    if actual_type <> c.type_name::regtype or generated <> '' then
      raise exception 'Incompatible trip centers column %.%: expected ordinary %, found %',
        c.table_name,c.column_name,c.type_name,format_type(actual_type,null);
    end if;
    if c.required_not_null then
      execute format('alter table public.%I alter column %I set not null',c.table_name,c.column_name);
    end if;
    if c.default_sql is not null and not exists(
      select 1 from pg_attrdef d join pg_attribute a
        on a.attrelid=d.adrelid and a.attnum=d.adnum
      where a.attrelid=to_regclass('public.'||c.table_name) and a.attname=c.column_name
    ) then
      execute format('alter table public.%I alter column %I set default %s',c.table_name,c.column_name,c.default_sql);
    end if;
  end loop;
end $columns$;

do $keys$
declare t text; key_columns text[]; expected smallint[]; actual smallint[]; f record;
begin
  foreach t in array array['trip_messages','trip_message_attachments','trip_message_reads','trip_documents'] loop
    key_columns := case when t='trip_message_reads' then array['message_id','user_id'] else array['id'] end;
    select array_agg(a.attnum order by k.ordinality) into expected
    from unnest(key_columns) with ordinality k(column_name,ordinality)
    join pg_attribute a on a.attrelid=to_regclass('public.'||t) and a.attname=k.column_name;
    select conkey into actual from pg_constraint
      where conrelid=to_regclass('public.'||t) and contype='p';
    if actual is null then
      execute format('alter table public.%I add primary key (%s)',t,array_to_string(key_columns,','));
    elsif actual <> expected then
      raise exception 'Incompatible trip centers primary key on %',t;
    end if;
  end loop;
  for f in select * from (values
    ('trip_messages','trip_id','public.trips','cascade'),
    ('trip_messages','quote_id','public.supplier_trip_quotes','set null'),
    ('trip_message_attachments','message_id','public.trip_messages','cascade'),
    ('trip_message_reads','message_id','public.trip_messages','cascade'),
    ('trip_documents','trip_id','public.trips','cascade'),
    ('trip_documents','quote_id','public.supplier_trip_quotes','set null')
  ) fk(table_name,column_name,parent_table,delete_action) loop
    if not exists (select 1 from pg_constraint c join pg_attribute a
      on a.attrelid=c.conrelid and c.conkey=array[a.attnum]::smallint[]
      join pg_attribute parent on parent.attrelid=c.confrelid and parent.attname='id'
      where c.conrelid=to_regclass('public.'||f.table_name) and c.contype='f'
        and a.attname=f.column_name and c.confrelid=to_regclass(f.parent_table)
        and c.confkey=array[parent.attnum]::smallint[]
        and c.confdeltype=case when f.delete_action='cascade' then 'c'::"char" else 'n'::"char" end
    ) then
      execute format('alter table public.%I add constraint %I foreign key (%I) references %s(id) on delete %s',
        f.table_name,'trip_centers_'||f.table_name||'_'||f.column_name||'_fk',f.column_name,f.parent_table,f.delete_action);
    end if;
  end loop;
end $keys$;

do $checks$
declare c record;
begin
  for c in select * from (values
    ('trip_messages','trip_centers_message_type_check',
      $check$message_type in ('general','hotel','transport','activities','guides','urgent')$check$),
    ('trip_messages','trip_centers_sender_source_check',
      $check$sender_source in ('morocco_office','japan_office','admin','supplier')$check$),
    ('trip_documents','trip_centers_document_category_check',
      $check$category in ('hotel_vouchers','transport_vouchers','guide_confirmations','flight_tickets','rooming_lists','emergency_contacts','contracts','other')$check$)
  ) checks(table_name,constraint_name,expression) loop
    if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||c.table_name) and conname=c.constraint_name) then
      execute format('alter table public.%I add constraint %I check (%s)',c.table_name,c.constraint_name,c.expression);
    end if;
  end loop;
end $checks$;

create index if not exists idx_trip_messages_trip_created on public.trip_messages(trip_id,created_at desc);
create index if not exists idx_trip_messages_trip_type on public.trip_messages(trip_id,message_type);
create index if not exists idx_trip_messages_quote on public.trip_messages(quote_id);
create index if not exists idx_trip_message_attachments_message on public.trip_message_attachments(message_id);
create index if not exists idx_trip_message_reads_user on public.trip_message_reads(user_id,read_at desc);
create index if not exists idx_trip_documents_trip_category_uploaded on public.trip_documents(trip_id,category,uploaded_at desc);
create index if not exists idx_trip_documents_quote on public.trip_documents(quote_id);
create index if not exists idx_trip_documents_uploaded_by on public.trip_documents(uploaded_by);
create index if not exists idx_trip_documents_file_path on public.trip_documents(file_path);
create index if not exists idx_trip_message_attachments_file_path on public.trip_message_attachments(file_path);

create or replace function public.trip_centers_touch_updated_at()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin new.updated_at=statement_timestamp(); return new; end $$;
revoke all on function public.trip_centers_touch_updated_at() from public,anon,authenticated;

-- Suppliers cannot move existing content between trips, messages or owners.
-- The existing archive guard is reused below, not replaced or weakened.
create or replace function public.guard_trip_center_supplier_identity()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare field text;
begin
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    foreach field in array array['id','trip_id','quote_id','message_id','sender_id','sender_source','uploaded_by','user_id'] loop
      if to_jsonb(new)->field is distinct from to_jsonb(old)->field then
        raise exception 'supplier cannot change trip content identity: %',field using errcode='42501';
      end if;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.guard_trip_center_supplier_identity() from public,anon,authenticated;

do $triggers$
declare t text;
begin
  foreach t in array array['trip_messages','trip_message_attachments','trip_message_reads','trip_documents'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop trigger if exists guard_archived_trip_supplier_writes on public.%I',t);
    execute format('create trigger guard_archived_trip_supplier_writes before insert or update or delete on public.%I for each row execute function public.guard_archived_trip_supplier_writes()',t);
    execute format('drop trigger if exists guard_trip_center_supplier_identity on public.%I',t);
    execute format('create trigger guard_trip_center_supplier_identity before update on public.%I for each row execute function public.guard_trip_center_supplier_identity()',t);
  end loop;
  foreach t in array array['trip_messages','trip_documents'] loop
    execute format('drop trigger if exists %I on public.%I',t||'_updated_at',t);
    execute format('create trigger %I before update on public.%I for each row execute function public.trip_centers_touch_updated_at()',t||'_updated_at',t);
  end loop;
end $triggers$;

-- Normalize only reviewed historical/current policy names. Unknown policies
-- on a partially deployed table require review, rather than silently keeping
-- an OR-based authorization bypass or deleting a custom protection.
do $policies$
declare p record;
begin
  for p in select * from pg_policies where schemaname='public'
    and tablename in ('trip_messages','trip_message_attachments','trip_message_reads','trip_documents') loop
    if p.policyname <> all(array[
      'staff manage trip messages','supplier read accessible trip messages',
      'supplier insert accessible trip messages','supplier update own trip messages',
      'staff manage trip message attachments','supplier read accessible trip message attachments',
      'supplier insert own trip message attachments','supplier update own trip message attachments',
      'supplier delete own trip message attachments','staff manage trip message reads',
      'users manage own trip message reads','supplier read own trip message reads',
      'supplier insert own trip message reads','supplier update own trip message reads',
      'supplier delete own trip message reads','staff manage trip documents',
      'supplier read accessible trip documents','supplier insert trip documents','supplier update trip documents'
    ]) then
      raise exception 'Unreviewed trip centers policy on %: %; review before migration',p.tablename,p.policyname;
    end if;
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
end $policies$;

revoke all on public.trip_messages,public.trip_message_attachments,public.trip_message_reads,public.trip_documents from public,anon,authenticated;
-- Also remove explicit column grants from a partial historical deployment.
do $column_grants$
declare t text; column_list text;
begin
  foreach t in array array['trip_messages','trip_message_attachments','trip_message_reads','trip_documents'] loop
    select string_agg(quote_ident(attname),',' order by attnum) into column_list
      from pg_attribute where attrelid=to_regclass('public.'||t) and attnum>0 and not attisdropped;
    execute format('revoke all (%s) on public.%I from public,anon,authenticated',column_list,t);
  end loop;
end $column_grants$;
grant select,insert,update,delete on public.trip_messages,public.trip_message_attachments,public.trip_message_reads,public.trip_documents to authenticated,service_role;

create policy "staff manage trip messages" on public.trip_messages for all to authenticated
using (public.is_staff((select auth.uid())))
with check (public.is_staff((select auth.uid())));

create policy "staff manage trip message attachments" on public.trip_message_attachments for all to authenticated
using (public.is_staff((select auth.uid())))
with check (public.is_staff((select auth.uid())));

create policy "staff manage trip message reads" on public.trip_message_reads for all to authenticated
using (public.is_staff((select auth.uid())))
with check (public.is_staff((select auth.uid())));

create policy "staff manage trip documents" on public.trip_documents for all to authenticated
using (public.is_staff((select auth.uid())))
with check (public.is_staff((select auth.uid())));

create policy "supplier read accessible trip messages" on public.trip_messages for select to authenticated
using (deleted_at is null and public.supplier_can_access_trip((select auth.uid()),trip_id));

create policy "supplier insert accessible trip messages" on public.trip_messages for insert to authenticated
with check (sender_id=(select auth.uid()) and sender_source in ('japan_office','supplier') and public.supplier_can_edit_trip((select auth.uid()),trip_id) and deleted_at is null);

create policy "supplier update own trip messages" on public.trip_messages for update to authenticated
using (sender_id=(select auth.uid()) and sender_source in ('japan_office','supplier') and public.supplier_can_edit_trip((select auth.uid()),trip_id) and deleted_at is null)
with check (sender_id=(select auth.uid()) and sender_source in ('japan_office','supplier') and public.supplier_can_edit_trip((select auth.uid()),trip_id));

create policy "supplier read accessible trip message attachments" on public.trip_message_attachments for select to authenticated
using (exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and public.supplier_can_access_trip((select auth.uid()),m.trip_id)));

create policy "supplier insert own trip message attachments" on public.trip_message_attachments for insert to authenticated
with check (uploaded_by=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and m.sender_id=(select auth.uid()) and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)) and (file_path is null or exists(select 1 from public.trip_messages m join storage.objects o on o.name=file_path and o.bucket_id='trip-message-attachments' where m.id=message_id and split_part(file_path,'/',1)=m.trip_id::text and split_part(file_path,'/',2)=m.id::text and coalesce(o.owner_id,o.owner::text)=(select auth.uid())::text)));

create policy "supplier update own trip message attachments" on public.trip_message_attachments for update to authenticated
using (uploaded_by=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and m.sender_id=(select auth.uid()) and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)))
with check (uploaded_by=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and m.sender_id=(select auth.uid()) and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)) and (file_path is null or exists(select 1 from public.trip_messages m join storage.objects o on o.name=file_path and o.bucket_id='trip-message-attachments' where m.id=message_id and split_part(file_path,'/',1)=m.trip_id::text and split_part(file_path,'/',2)=m.id::text and coalesce(o.owner_id,o.owner::text)=(select auth.uid())::text)));

create policy "supplier delete own trip message attachments" on public.trip_message_attachments for delete to authenticated
using (uploaded_by=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and m.sender_id=(select auth.uid()) and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)));

create policy "supplier read own trip message reads" on public.trip_message_reads for select to authenticated
using (user_id=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and public.supplier_can_access_trip((select auth.uid()),m.trip_id)));

create policy "supplier insert own trip message reads" on public.trip_message_reads for insert to authenticated
with check (user_id=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)));

create policy "supplier update own trip message reads" on public.trip_message_reads for update to authenticated
using (user_id=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)))
with check (user_id=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)));

create policy "supplier delete own trip message reads" on public.trip_message_reads for delete to authenticated
using (user_id=(select auth.uid()) and exists(select 1 from public.trip_messages m where m.id=message_id and m.deleted_at is null and public.supplier_can_edit_trip((select auth.uid()),m.trip_id)));

create policy "supplier read accessible trip documents" on public.trip_documents for select to authenticated
-- Keep the owner's metadata SELECT-visible after a soft delete so PostgreSQL
-- can validate the supplier's UPDATE. The frontend explicitly filters deleted
-- rows; other suppliers only read undeleted supplier-visible records.
using (((deleted_at is null and supplier_visible) or uploaded_by=(select auth.uid())) and public.supplier_can_access_trip((select auth.uid()),trip_id));

create policy "supplier insert trip documents" on public.trip_documents for insert to authenticated
with check (uploaded_by=(select auth.uid()) and public.supplier_can_edit_trip((select auth.uid()),trip_id) and deleted_at is null and (file_path is null or (split_part(file_path,'/',1)=trip_id::text and exists(select 1 from storage.objects o where o.bucket_id='trip-documents' and o.name=file_path and coalesce(o.owner_id,o.owner::text)=(select auth.uid())::text))));

create policy "supplier update trip documents" on public.trip_documents for update to authenticated
using (uploaded_by=(select auth.uid()) and public.supplier_can_edit_trip((select auth.uid()),trip_id) and deleted_at is null)
with check (uploaded_by=(select auth.uid()) and public.supplier_can_edit_trip((select auth.uid()),trip_id) and (file_path is null or (split_part(file_path,'/',1)=trip_id::text and exists(select 1 from storage.objects o where o.bucket_id='trip-documents' and o.name=file_path and coalesce(o.owner_id,o.owner::text)=(select auth.uid())::text))));


-- Private buckets; retain existing custom limits/configuration where present.
insert into storage.buckets as b(id,name,public,file_size_limit) values
  ('trip-message-attachments','trip-message-attachments',false,10485760),
  ('trip-documents','trip-documents',false,52428800)
on conflict(id) do update set public=false,
  file_size_limit=coalesce(b.file_size_limit,excluded.file_size_limit);

-- FIT uses the SAME document bucket. Preserve its rules and paths verbatim;
-- only remove PUBLIC targeting of its authenticated-only supplier helper.
do $fit_roles$
declare p text;
begin
  foreach p in array array['supplier FIT document read','supplier FIT document upload'] loop
    if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname=p) then
      execute format('alter policy %I on storage.objects to authenticated',p);
    end if;
  end loop;
end $fit_roles$;

drop policy if exists "staff manage trip document files" on storage.objects;
drop policy if exists "staff manage trip message attachment files" on storage.objects;
drop policy if exists "supplier read trip document files" on storage.objects;
drop policy if exists "supplier read authorized trip document files" on storage.objects;
drop policy if exists "supplier read own editable trip document uploads" on storage.objects;
drop policy if exists "supplier read trip message attachment files" on storage.objects;
drop policy if exists "supplier upload trip document files" on storage.objects;
drop policy if exists "supplier update own trip document files" on storage.objects;
drop policy if exists "supplier delete own trip document files" on storage.objects;
drop policy if exists "supplier upload trip message attachment files" on storage.objects;
drop policy if exists "supplier update own trip message attachment files" on storage.objects;
drop policy if exists "supplier delete own trip message attachment files" on storage.objects;
drop policy if exists "trip centers deny anonymous files" on storage.objects;

-- This restrictive policy grants nothing and only denies the two private
-- buckets to anon; it leaves every other bucket's existing rules unchanged.
create policy "trip centers deny anonymous files" on storage.objects as restrictive
for all to anon using (bucket_id not in ('trip-documents','trip-message-attachments'))
with check (bucket_id not in ('trip-documents','trip-message-attachments'));

create policy "staff manage trip document files" on storage.objects for all to authenticated
using (bucket_id='trip-documents' and public.is_staff((select auth.uid())))
with check (bucket_id='trip-documents' and public.is_staff((select auth.uid())));

create policy "supplier upload trip document files" on storage.objects for insert to authenticated
with check (bucket_id='trip-documents' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end);

create policy "supplier update own trip document files" on storage.objects for update to authenticated
using (bucket_id='trip-documents' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end)
with check (bucket_id='trip-documents' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end);

create policy "supplier delete own trip document files" on storage.objects for delete to authenticated
using (bucket_id='trip-documents' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end);

create policy "supplier read authorized trip document files" on storage.objects for select to authenticated
using (bucket_id='trip-documents' and public.supplier_can_access_trip_document_file((select auth.uid()),name));

create policy "supplier read own editable trip document uploads" on storage.objects for select to authenticated
using (bucket_id='trip-documents' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end);

create policy "staff manage trip message attachment files" on storage.objects for all to authenticated
using (bucket_id='trip-message-attachments' and public.is_staff((select auth.uid())))
with check (bucket_id='trip-message-attachments' and public.is_staff((select auth.uid())));

create policy "supplier upload trip message attachment files" on storage.objects for insert to authenticated
with check (bucket_id='trip-message-attachments' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end);

create policy "supplier update own trip message attachment files" on storage.objects for update to authenticated
using (bucket_id='trip-message-attachments' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end)
with check (bucket_id='trip-message-attachments' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end);

create policy "supplier delete own trip message attachment files" on storage.objects for delete to authenticated
using (bucket_id='trip-message-attachments' and coalesce(owner_id,owner::text)=(select auth.uid())::text and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end);

create policy "supplier read trip message attachment files" on storage.objects for select to authenticated
-- Resolve the message from the path without querying attachments here: an
-- attachment INSERT also checks Storage ownership, so querying attachments
-- from its Storage SELECT policy would cause recursive RLS evaluation.
using (bucket_id='trip-message-attachments' and (
  exists(select 1 from public.trip_messages m where m.id::text=split_part(objects.name,'/',2)
    and m.trip_id::text=split_part(objects.name,'/',1) and m.deleted_at is null
    and public.supplier_can_access_trip((select auth.uid()),m.trip_id))
  or (coalesce(owner_id,owner::text)=(select auth.uid())::text
    and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_edit_trip((select auth.uid()),((storage.foldername(name))[1])::uuid) else false end)
));

notify pgrst,'reload schema';
commit;
