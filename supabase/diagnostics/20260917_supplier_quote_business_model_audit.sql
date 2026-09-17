-- LeJapon.ma ONLY: project nxnncbddtpjusrnhilxk.
-- Run the WHOLE file in its authorized Supabase SQL Editor.
-- One JSON result contains the complete audit; export/copy that result.
-- Catalogs, IDs and counts only: no passenger identities or financial row values.
-- No DDL, import, save, review, version creation, DELETE or UPDATE.
-- No schema repair or migration is generated until these results are reviewed.
begin read only;

with recursive target_names(table_name) as (
  values ('supplier_trip_quotes'),('supplier_quote_hotel_rows'),
    ('supplier_quote_transport_rows'),('supplier_quote_activity_rows'),
    ('supplier_quote_guide_rows'),('supplier_quote_other_rows'),
    ('supplier_quote_comments'),('supplier_members'),('trip_suppliers')
), targets as (
  select t.table_name,c.oid,c.relrowsecurity,c.relforcerowsecurity,c.relowner,c.relkind
  from target_names t
  left join pg_namespace n on n.nspname='public'
  left join pg_class c on c.relnamespace=n.oid and c.relname=t.table_name
), function_targets as (
  select distinct p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and (
    (p.proname ilike '%supplier%' and (p.proname ilike '%quote%' or p.proname ilike '%operational%'))
    or p.proname in ('is_staff','has_role','has_any_role','user_supplier_ids',
      'supplier_can_access_trip','supplier_can_edit_trip','guard_archived_trip_supplier_writes')
  )
  union
  select t.tgfoid from pg_trigger t join targets x on x.oid=t.tgrelid where not t.tgisinternal
  union
  select d.refobjid from pg_depend d join pg_policy pol
    on d.classid='pg_policy'::regclass and d.objid=pol.oid
  join targets x on x.oid=pol.polrelid
  where d.refclassid='pg_proc'::regclass
  union
  -- Follow helpers used by those functions. Source matching also captures
  -- SQL/plpgsql bodies whose calls PostgreSQL does not register in pg_depend.
  -- Overloads are included conservatively; definitions are returned for review.
  select called.oid from function_targets f join pg_proc caller on caller.oid=f.oid
  join pg_proc called on (
    exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
      and d.objid=caller.oid and d.refclassid='pg_proc'::regclass and d.refobjid=called.oid)
    or (called.proname ~ '^[a-z_][a-z0-9_]*$'
      and caller.prosrc ~ ('(^|[^a-zA-Z0-9_])' || called.proname || '\s*\('))
  )
  join pg_namespace n on n.oid=called.pronamespace
  where n.nspname in ('public','auth') and called.prokind='f'
), columns_audit as (
  select c.table_name,c.column_name,c.ordinal_position,c.data_type,c.udt_name,
    c.column_default,c.is_nullable,c.numeric_precision,c.numeric_scale,c.is_generated,c.generation_expression
  from information_schema.columns c join target_names t on t.table_name=c.table_name
  where c.table_schema='public'
), constraints_audit as (
  select x.table_name,con.conname,con.contype,con.convalidated,pg_get_constraintdef(con.oid) as definition
  from targets x join pg_constraint con on con.conrelid=x.oid
), triggers_audit as (
  select x.table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition,
    t.tgfoid::regprocedure::text as function_signature
  from targets x join pg_trigger t on t.tgrelid=x.oid where not t.tgisinternal
), functions_audit as (
  select p.oid::regprocedure::text as signature,pg_get_userbyid(p.proowner) as owner,
    p.prosecdef as security_definer,p.proconfig,p.proacl,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
    pg_get_functiondef(p.oid) as definition
  from function_targets f join pg_proc p on p.oid=f.oid where p.prokind='f'
), grants_audit as (
  select x.table_name,r.role_name,
    has_table_privilege(r.role_name,x.oid,'SELECT') as select_grant,
    has_table_privilege(r.role_name,x.oid,'INSERT') as insert_grant,
    has_table_privilege(r.role_name,x.oid,'UPDATE') as update_grant,
    has_table_privilege(r.role_name,x.oid,'DELETE') as delete_grant
  from targets x cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
  where x.oid is not null
), policies_audit as (
  select p.tablename,p.policyname,p.permissive,p.roles,p.cmd,p.qual,p.with_check
  from pg_policies p join target_names t on t.table_name=p.tablename where p.schemaname='public'
)
select jsonb_build_object(
  'audit',jsonb_build_object('project_ref_expected','nxnncbddtpjusrnhilxk',
    'database',current_database(),'user',current_user,'timestamp',statement_timestamp(),
    'transaction_read_only',current_setting('transaction_read_only')),
  'tables',coalesce((select jsonb_agg(jsonb_build_object('table_name',table_name,
    'exists',oid is not null,'kind',relkind,'rls_enabled',relrowsecurity,
    'rls_forced',relforcerowsecurity,'owner',pg_get_userbyid(relowner)) order by table_name) from targets),'[]'::jsonb),
  'columns',coalesce((select jsonb_agg(to_jsonb(c) order by table_name,ordinal_position) from columns_audit c),'[]'::jsonb),
  'constraints',coalesce((select jsonb_agg(to_jsonb(c) order by table_name,conname) from constraints_audit c),'[]'::jsonb),
  'indexes',coalesce((select jsonb_agg(to_jsonb(i) order by tablename,indexname) from pg_indexes i
    join target_names t on t.table_name=i.tablename where i.schemaname='public'),'[]'::jsonb),
  'triggers',coalesce((select jsonb_agg(to_jsonb(t) order by table_name,tgname) from triggers_audit t),'[]'::jsonb),
  'functions',coalesce((select jsonb_agg(to_jsonb(f) order by signature) from functions_audit f),'[]'::jsonb),
  'table_grants',coalesce((select jsonb_agg(to_jsonb(g) order by table_name,role_name) from grants_audit g),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(to_jsonb(p) order by tablename,policyname) from policies_audit p),'[]'::jsonb)
) as supplier_quote_business_model_schema_audit;

rollback;

-- Optional SECOND read-only result: existing version IDs/statuses and legacy
-- handling counts. Execute separately AFTER the catalog result confirms these
-- two tables exist. The JSON conversion tolerates absent historical columns.
--
-- begin read only;
-- with quotes as (
--   select to_jsonb(q) as data from public.supplier_trip_quotes q
-- ), legacy_rows as (
--   select to_jsonb(r) as data from public.supplier_quote_other_rows r
-- ), version_counts as (
--   select q.data->>'id' as quote_id,q.data->>'trip_id' as trip_id,
--     q.data->>'supplier_id' as supplier_id,q.data->>'version_number' as version_number,
--     q.data->>'status' as status,q.data->>'validation_status' as validation_status,
--     q.data ? 'supplier_handling_percentage' as has_handling_percentage_field,
--     q.data ? 'supplier_handling_categories' as has_handling_categories_field,
--     q.data ? 'supplier_handling_amount_jpy' as has_handling_amount_field,
--     count(r.data) as legacy_handling_row_count
--   from quotes q left join legacy_rows r on r.data->>'quote_id'=q.data->>'id'
--     and (r.data->>'label' ilike '%handling%'
--       or r.data->>'comment' ilike '%Nature Excel : handling fournisseur%')
--   group by q.data
-- )
-- select coalesce(jsonb_agg(to_jsonb(v) order by trip_id,supplier_id,version_number),'[]'::jsonb)
--   as existing_version_legacy_handling_audit from version_counts v;
-- rollback;
