-- LeJapon.ma ONLY: run only in project nxnncbddtpjusrnhilxk.
-- Review the dashboard project ref / connection host before execution.
-- This file performs no schema, data, role, policy or history mutation.
-- It exports metadata only; no auth users, customer rows or stored objects.
-- Inspect the exported definitions for credentials before sharing the file.
-- Common bearer/JWT/secret-key patterns in function bodies are redacted below.

begin;
set transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '1s';

with app_schemas as (
  select oid, nspname
  from pg_namespace
  where nspname = 'public'
     or (
       nspname not like 'pg_%'
       and nspname <> 'information_schema'
       and nspname not in (
         'auth','storage','extensions','realtime','vault','graphql',
         'graphql_public','supabase_migrations','supabase_functions',
         'pgbouncer','pgsodium','pgsodium_masks','cron','net'
       )
     )
), app_relations as (
  select c.*, n.nspname
  from pg_class c
  join app_schemas n on n.oid = c.relnamespace
  where c.relkind in ('r','p','v','m')
)
select jsonb_build_object(
  'audit', jsonb_build_object(
    'intended_project_ref', 'nxnncbddtpjusrnhilxk',
    'captured_at', statement_timestamp(),
    'database', current_database(),
    'actor_role', current_user,
    'server_version', current_setting('server_version'),
    'transaction_read_only', current_setting('transaction_read_only'),
    'customer_data_exported', false
  ),
  'extensions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', extname, 'version', extversion
    ) order by extname), '[]'::jsonb)
    from pg_extension
  ),
  'schemas', (
    select coalesce(jsonb_agg(nspname order by nspname), '[]'::jsonb)
    from app_schemas
  ),
  'relations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', nspname, 'name', relname, 'kind', relkind,
      'rls_enabled', relrowsecurity, 'force_rls', relforcerowsecurity,
      'acl', relacl::text,
      'view_definition', case when relkind in ('v','m') then pg_get_viewdef(oid, true) end
    ) order by nspname, relname), '[]'::jsonb)
    from app_relations
  ),
  'columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', c.nspname, 'table', c.relname, 'column', a.attname,
      'ordinal', a.attnum, 'type', format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull, 'identity', a.attidentity,
      'generated', a.attgenerated, 'default', pg_get_expr(d.adbin, d.adrelid),
      'acl', a.attacl::text
    ) order by c.nspname, c.relname, a.attnum), '[]'::jsonb)
    from app_relations c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
  ),
  'enums', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', t.typname,
      'values', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
    ) order by n.nspname, t.typname), '[]'::jsonb)
    from pg_type t join app_schemas n on n.oid = t.typnamespace
    where t.typtype = 'e'
  ),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', i.schemaname, 'table', i.tablename,
      'name', i.indexname, 'definition', i.indexdef
    ) order by i.schemaname, i.tablename, i.indexname), '[]'::jsonb)
    from pg_indexes i join app_schemas n on n.nspname = i.schemaname
  ),
  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', c.nspname, 'table', c.relname, 'name', k.conname,
      'kind', k.contype, 'validated', k.convalidated,
      'definition', pg_get_constraintdef(k.oid, true)
    ) order by c.nspname, c.relname, k.conname), '[]'::jsonb)
    from pg_constraint k join app_relations c on c.oid = k.conrelid
  ),
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'arguments', pg_get_function_arguments(p.oid),
      'result', pg_get_function_result(p.oid),
      'language', l.lanname, 'security_definer', p.prosecdef,
      'config', p.proconfig, 'acl', p.proacl::text,
      'definition_md5', md5(pg_get_functiondef(p.oid)),
      'definition_redacted', regexp_replace(regexp_replace(regexp_replace(
        pg_get_functiondef(p.oid),
        '(Bearer[[:space:]]+)[A-Za-z0-9_.-]+', '\1[REDACTED]', 'gi'),
        'eyJ[A-Za-z0-9_.-]+', '[REDACTED_JWT]', 'g'),
        '(sb_secret_|sbp_)[A-Za-z0-9_-]+', '[REDACTED_SECRET]', 'g')
    ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    from pg_proc p join app_schemas n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where p.prokind in ('f','p')
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', c.nspname, 'table', c.relname, 'name', t.tgname,
      'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid, true)
    ) order by c.nspname, c.relname, t.tgname), '[]'::jsonb)
    from pg_trigger t join app_relations c on c.oid = t.tgrelid
    where not t.tgisinternal
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
      'permissive', p.permissive, 'roles', p.roles, 'command', p.cmd,
      'using', p.qual, 'with_check', p.with_check
    ) order by p.schemaname, p.tablename, p.policyname), '[]'::jsonb)
    from pg_policies p
    where p.schemaname in (select nspname from app_schemas)
       or p.schemaname = 'storage'
  ),
  'storage_buckets', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'public', public,
      'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types
    ) order by id), '[]'::jsonb)
    from storage.buckets
  ),
  'migration_history_columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', column_name, 'type', data_type
    ) order by ordinal_position), '[]'::jsonb)
    from information_schema.columns
    where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'
  ),
  'optional_catalog_presence', jsonb_build_object(
    'migration_history', to_regclass('supabase_migrations.schema_migrations') is not null,
    'cron_jobs', to_regclass('cron.job') is not null,
    'cron_run_details', to_regclass('cron.job_run_details') is not null
  )
) as lejapon_schema_catalog;

commit;

-- OPTIONAL: execute separately if schema_migrations exists and has the
-- version/name/statements columns. A missing history is itself an audit finding.
-- begin;
-- set transaction read only;
-- set local statement_timeout = '30s';
-- select version, name, cardinality(statements) as statement_count,
--        coalesce(cardinality(statements), 0) = 0 as empty_statements,
--        md5(array_to_string(statements, E';\n')) as statements_md5
-- from supabase_migrations.schema_migrations order by version;
-- commit;

-- OPTIONAL: execute separately only if cron.job exists, still on LeJapon.ma.
-- No bearer token or command body is exported.
-- begin;
-- set transaction read only;
-- select jobid, jobname, schedule, active,
--        command like '%nxnncbddtpjusrnhilxk.supabase.co%' as targets_lejapon_prod,
--        md5(command) as command_md5
-- from cron.job order by jobid;
-- commit;
