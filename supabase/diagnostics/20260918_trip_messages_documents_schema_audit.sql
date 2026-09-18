-- LeJapon.ma ONLY: expected project nxnncbddtpjusrnhilxk.
-- This is an AUDIT, not a migration. Run the entire file in that project's
-- Supabase SQL Editor and export the single JSON result (CSV export is fine).
-- The previous supplier quote export did NOT inventory these four tables
-- or either Storage bucket. Missing objects are reported explicitly here.
-- READ ONLY: catalogs, function definitions and two bucket configurations.
-- No message bodies, document contents, object paths, passenger identities,
-- financial values, row writes, imports, quote versions or schema changes.
begin read only;
set local statement_timeout = '60s';

with recursive target_names(schema_name, table_name) as (
  values ('public', 'trip_messages'),
    ('public', 'trip_message_attachments'),
    ('public', 'trip_message_reads'),
    ('public', 'trip_documents'),
    ('public', 'trips'),
    ('public', 'supplier_trip_quotes'),
    ('public', 'supplier_members'),
    ('public', 'trip_suppliers'),
    ('storage', 'objects'),
    ('storage', 'buckets')
), targets as (
  select x.schema_name, x.table_name, c.oid, c.relkind,
    c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.relacl
  from target_names x
  left join pg_namespace n on n.nspname = x.schema_name
  left join pg_class c on c.relnamespace = n.oid and c.relname = x.table_name
), policies_audit as (
  -- ALL Storage object policies are intentional: an unrelated permissive
  -- policy can accidentally authorize these buckets through OR evaluation.
  select p.schemaname, p.tablename, p.policyname, p.permissive,
    p.roles, p.cmd, p.qual, p.with_check
  from pg_policies p
  join target_names x on x.schema_name = p.schemaname and x.table_name = p.tablename
), function_targets(oid) as (
  select distinct p.oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f' and (
    (n.nspname = 'public' and p.proname in (
      'is_staff', 'has_role', 'has_any_role', 'supplier_can_access_trip',
      'supplier_can_edit_trip', 'guard_archived_trip_supplier_writes',
      'trip_messages_set_updated_at', 'trip_documents_set_updated_at'
    ))
    or (n.nspname in ('public', 'storage') and p.prosrc ~
      '(trip_messages|trip_message_attachments|trip_message_reads|trip_documents|trip-message-attachments|trip-documents)')
  )
  union
  select t.tgfoid from pg_trigger t join targets x on x.oid = t.tgrelid
  where not t.tgisinternal
  union
  select d.refobjid
  from pg_depend d join pg_policy pol
    on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
  join targets x on x.oid = pol.polrelid
  where d.refclassid = 'pg_proc'::regclass
  union
  -- Catalog dependencies plus source matching for string-body SQL/PLpgSQL.
  -- Include overloads conservatively; their signatures are returned below.
  select called.oid
  from function_targets f join pg_proc caller on caller.oid = f.oid
  join pg_proc called on (
    exists (
      select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
        and d.objid = caller.oid and d.refclassid = 'pg_proc'::regclass
        and d.refobjid = called.oid
    )
    or (called.proname ~ '^[a-z_][a-z0-9_]*$'
      and caller.prosrc ~ ('(^|[^a-zA-Z0-9_])' || called.proname || '\s*\('))
  )
  join pg_namespace n on n.oid = called.pronamespace
  where called.prokind = 'f' and n.nspname in ('public', 'auth', 'storage')
), columns_audit as (
  select x.schema_name, x.table_name, a.attname as column_name,
    a.attnum as ordinal_position, format_type(a.atttypid, a.atttypmod) as type,
    a.attnotnull as not_null, a.attidentity as identity_kind,
    a.attgenerated as generated_kind, a.attacl as column_acl,
    pg_get_expr(d.adbin, d.adrelid) as default_or_generation_expression
  from targets x join pg_attribute a on a.attrelid = x.oid
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
), required_columns(table_name, column_name) as (
  select 'trip_documents', unnest(array[
    'id', 'trip_id', 'quote_id', 'category', 'title', 'file_name', 'file_path',
    'file_url', 'mime_type', 'size_bytes', 'version', 'uploaded_by',
    'uploaded_by_name', 'uploaded_by_role', 'uploaded_at', 'metadata',
    'deleted_at', 'created_at', 'updated_at', 'supplier_visible'
  ])
  union all
  select 'trip_messages', unnest(array[
    'id', 'trip_id', 'quote_id', 'message_type', 'body', 'sender_id',
    'sender_name', 'sender_role', 'sender_source', 'metadata', 'deleted_at',
    'created_at', 'updated_at'
  ])
  union all
  select 'trip_message_attachments', unnest(array[
    'id', 'message_id', 'file_name', 'file_path', 'file_url', 'mime_type',
    'size_bytes', 'uploaded_by', 'created_at'
  ])
  union all
  select 'trip_message_reads', unnest(array['message_id', 'user_id', 'read_at'])
), functions_audit as (
  select p.oid::regprocedure::text as signature,
    pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
    p.provolatile as volatility, p.proconfig, p.proacl,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    pg_get_functiondef(p.oid) as definition
  from function_targets f join pg_proc p on p.oid = f.oid
  where p.prokind = 'f'
), grants_audit as (
  select x.schema_name, x.table_name, r.role_name,
    has_table_privilege(r.role_name, x.oid, 'SELECT') as select_grant,
    has_table_privilege(r.role_name, x.oid, 'INSERT') as insert_grant,
    has_table_privilege(r.role_name, x.oid, 'UPDATE') as update_grant,
    has_table_privilege(r.role_name, x.oid, 'DELETE') as delete_grant,
    has_any_column_privilege(r.role_name, x.oid, 'SELECT') as any_column_select_grant,
    has_any_column_privilege(r.role_name, x.oid, 'INSERT') as any_column_insert_grant,
    has_any_column_privilege(r.role_name, x.oid, 'UPDATE') as any_column_update_grant
  from targets x
  cross join (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
  where x.oid is not null
), bucket_audit as (
  -- Dynamic SELECT avoids a parse-time missing-relation error if Storage has
  -- not been provisioned. to_jsonb avoids assuming optional bucket columns.
  -- XMLTABLE extracts escaped JSON text correctly (unlike casting xpath XML).
  select case when to_regclass('storage.buckets') is null then '[]'::jsonb
    else (
      select b.inventory::jsonb from xmltable('/table/row'
        passing query_to_xml($bucket_query$
          select coalesce(jsonb_agg(to_jsonb(b) order by to_jsonb(b)->>'id'), '[]'::jsonb) as inventory
          from storage.buckets b
          where to_jsonb(b)->>'id' in ('trip-message-attachments', 'trip-documents')
        $bucket_query$, true, false, '')
        columns inventory text path 'inventory'
      ) b
    ) end as inventory
)
select jsonb_build_object(
  'audit', jsonb_build_object(
    'expected_project_ref', 'nxnncbddtpjusrnhilxk',
    'database', current_database(), 'user', current_user,
    'timestamp', statement_timestamp(),
    'transaction_read_only', current_setting('transaction_read_only'),
    'note', 'Expected ref is a label; verify the selected SQL Editor project before running.'
  ),
  'tables', coalesce((select jsonb_agg(jsonb_build_object(
    'schema_name', schema_name, 'table_name', table_name, 'exists', oid is not null,
    'kind', relkind, 'owner', pg_get_userbyid(relowner),
    'rls_enabled', relrowsecurity, 'rls_forced', relforcerowsecurity,
    'acl', relacl
  ) order by schema_name, table_name) from targets), '[]'::jsonb),
  'columns', coalesce((select jsonb_agg(to_jsonb(c) order by schema_name, table_name, ordinal_position)
    from columns_audit c), '[]'::jsonb),
  'required_frontend_columns', coalesce((select jsonb_agg(jsonb_build_object(
    'table_name', r.table_name, 'column_name', r.column_name,
    'exists', exists (select 1 from columns_audit c where c.schema_name = 'public'
      and c.table_name = r.table_name and c.column_name = r.column_name)
  ) order by r.table_name, r.column_name) from required_columns r), '[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(jsonb_build_object(
    'schema_name', x.schema_name, 'table_name', x.table_name,
    'name', c.conname, 'type', c.contype, 'validated', c.convalidated,
    'definition', pg_get_constraintdef(c.oid)
  ) order by x.schema_name, x.table_name, c.conname)
    from targets x join pg_constraint c on c.conrelid = x.oid), '[]'::jsonb),
  'indexes', coalesce((select jsonb_agg(to_jsonb(i) order by i.schemaname, i.tablename, i.indexname)
    from pg_indexes i join target_names x
      on x.schema_name = i.schemaname and x.table_name = i.tablename), '[]'::jsonb),
  'triggers', coalesce((select jsonb_agg(jsonb_build_object(
    'schema_name', x.schema_name, 'table_name', x.table_name,
    'name', t.tgname, 'enabled', t.tgenabled,
    'function_signature', t.tgfoid::regprocedure::text,
    'definition', pg_get_triggerdef(t.oid)
  ) order by x.schema_name, x.table_name, t.tgname)
    from targets x join pg_trigger t on t.tgrelid = x.oid
    where not t.tgisinternal), '[]'::jsonb),
  'policies', coalesce((select jsonb_agg(to_jsonb(p) order by schemaname, tablename, policyname)
    from policies_audit p), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(to_jsonb(f) order by signature)
    from functions_audit f), '[]'::jsonb),
  'table_grants', coalesce((select jsonb_agg(to_jsonb(g) order by schema_name, table_name, role_name)
    from grants_audit g), '[]'::jsonb),
  'buckets', (select inventory from bucket_audit),
  'expected_buckets', jsonb_build_array('trip-message-attachments', 'trip-documents'),
  'enum_values', coalesce((select jsonb_agg(jsonb_build_object(
    'schema_name', n.nspname, 'type_name', t.typname, 'label', e.enumlabel
  ) order by n.nspname, t.typname, e.enumsortorder)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where exists (select 1 from targets x join pg_attribute a on a.attrelid = x.oid
      where a.attnum > 0 and not a.attisdropped and a.atttypid = t.oid)), '[]'::jsonb),
  'default_privileges', coalesce((select jsonb_agg(jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole), 'schema_name', n.nspname,
    'object_type', d.defaclobjtype, 'acl', d.defaclacl
  ) order by d.defaclrole, d.defaclnamespace, d.defaclobjtype)
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclnamespace = 0 or n.nspname in ('public', 'storage')), '[]'::jsonb)
) as trip_messages_documents_schema_audit;

rollback;
