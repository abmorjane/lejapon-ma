-- LeJapon.ma ONLY: project nxnncbddtpjusrnhilxk.
-- Run with an authorized database owner in the SQL editor; return all results.
-- Read-only catalog/count audit. No import/save RPC, DDL, or financial row values.
begin read only;

select current_database(), current_user, current_setting('transaction_read_only');

select c.relname as table_name, c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced, pg_get_userbyid(c.relowner) as owner,
  r.role_name, has_table_privilege(r.role_name,c.oid,'SELECT') as can_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('authenticated'),('anon'),('service_role')) r(role_name)
where n.nspname='public' and c.relname in (
  'supplier_trip_quotes','supplier_quote_hotel_rows','supplier_quote_transport_rows',
  'supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows',
  'supplier_members','trip_suppliers','trips'
)
order by c.relname,r.role_name;

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename in (
  'supplier_trip_quotes','supplier_quote_hotel_rows','supplier_quote_transport_rows',
  'supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows',
  'supplier_members','trip_suppliers','trips'
) order by tablename,policyname;

-- pg_depend finds policy calls; source-name matching also follows nested calls
-- in SQL/plpgsql string bodies that PostgreSQL may not register as dependencies.
-- Overloads are included conservatively. Definitions expose authorization rules.
with recursive helpers(oid) as (
  select d.refobjid from pg_depend d
  join pg_policy pol on d.classid='pg_policy'::regclass and d.objid=pol.oid
  join pg_class c on c.oid=pol.polrelid
  join pg_namespace n on n.oid=c.relnamespace
  where d.refclassid='pg_proc'::regclass and n.nspname='public'
    and c.relname in ('supplier_trip_quotes','supplier_quote_hotel_rows',
      'supplier_quote_transport_rows','supplier_quote_activity_rows',
      'supplier_quote_guide_rows','supplier_quote_other_rows','trips')
  union
  select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
    'get_supplier_trip_quote','get_supplier_quote_versions_v2',
    'get_supplier_quote_version_v2','supplier_can_access_quote',
    'supplier_can_access_trip','supplier_can_edit_trip','user_supplier_ids','is_staff'
  )
  union
  select called.oid from helpers h join pg_proc caller on caller.oid=h.oid
  join pg_proc called on (
    caller.prosrc ~ ('(^|[^a-zA-Z0-9_])' || called.proname || '\s*\(')
    or exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
      and d.objid=caller.oid and d.refclassid='pg_proc'::regclass and d.refobjid=called.oid)
  )
  join pg_namespace n on n.oid=called.pronamespace
  where n.nspname in ('public','auth') and called.prokind='f'
)
select p.oid::regprocedure::text as signature, p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner, p.proconfig, p.proacl,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
  pg_get_functiondef(p.oid) as definition
from helpers h join pg_proc p on p.oid=h.oid
where p.prokind='f' order by signature;

-- All versions and all categories, including archived quotes. Zero is a real
-- privileged count here, not a count inferred from frontend state or RLS.
with line_counts as (
  select quote_id,'hotels' as section,count(*) as row_count from public.supplier_quote_hotel_rows group by quote_id
  union all select quote_id,'transport',count(*) from public.supplier_quote_transport_rows group by quote_id
  union all select quote_id,'activities',count(*) from public.supplier_quote_activity_rows group by quote_id
  union all select quote_id,'guides',count(*) from public.supplier_quote_guide_rows group by quote_id
  union all select quote_id,'other',count(*) from public.supplier_quote_other_rows group by quote_id
)
select q.id as quote_id,q.trip_id,q.supplier_id,q.version_number,q.status,
  q.parent_quote_id,coalesce(q.grand_total_jpy,0)<>0 as has_grand_total,
  s.section,coalesce(l.row_count,0) as persisted_count,
  exists(select 1 from public.trip_suppliers ts where ts.trip_id=q.trip_id
    and ts.supplier_id=q.supplier_id and ts.status<>'cancelled') as has_active_assignment
from public.supplier_trip_quotes q
cross join (values ('hotels'),('transport'),('activities'),('guides'),('other')) s(section)
left join line_counts l on l.quote_id=q.id and l.section=s.section
order by q.trip_id,q.supplier_id,q.version_number,s.section;

-- IDs only: select the actual browser user from these memberships for the
-- authenticated reproduction script. Do not substitute service_role for it.
select sm.user_id,sm.supplier_id,ts.trip_id,ts.status as assignment_status
from public.supplier_members sm join public.trip_suppliers ts on ts.supplier_id=sm.supplier_id
where exists(select 1 from public.supplier_trip_quotes q
  where q.trip_id=ts.trip_id and q.supplier_id=ts.supplier_id)
order by ts.trip_id,sm.supplier_id,sm.user_id;

with lines as (
  select quote_id,'hotels' as section from public.supplier_quote_hotel_rows
  union all select quote_id,'transport' from public.supplier_quote_transport_rows
  union all select quote_id,'activities' from public.supplier_quote_activity_rows
  union all select quote_id,'guides' from public.supplier_quote_guide_rows
  union all select quote_id,'other' from public.supplier_quote_other_rows
)
select l.section,count(*) filter(where q.id is null) as orphan_rows,
  count(*) filter(where q.id is not null and q.supplier_id is null) as rows_without_supplier
from lines l left join public.supplier_trip_quotes q on q.id=l.quote_id group by l.section;

rollback;
