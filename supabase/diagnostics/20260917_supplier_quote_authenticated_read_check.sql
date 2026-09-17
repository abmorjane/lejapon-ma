-- LeJapon.ma ONLY: nxnncbddtpjusrnhilxk. Run AFTER the catalog audit.
-- SQL editor/database owner role needed to SET LOCAL ROLE authenticated/anon.
-- Replace five placeholders with EXISTING IDs. No credentials are required.
-- Counts/RPC metadata only; no financial values or imports; always READ ONLY.
-- Role/JWT impersonation proves database RLS, not the browser's actual JWT or UI.
begin read only;
select set_config('lejapon.audit.v3_quote_id','REPLACE_V3_QUOTE_UUID',true);
select set_config('lejapon.audit.browser_user_id','REPLACE_ACTUAL_BROWSER_USER_UUID',true);
select set_config('lejapon.audit.other_quote_id','REPLACE_EXISTING_SUPPLIER_B_QUOTE_UUID',true);
select set_config('lejapon.audit.other_user_id','REPLACE_SUPPLIER_B_USER_UUID',true);
select set_config('lejapon.audit.staff_user_id','REPLACE_EXISTING_ADMIN_OR_STAFF_USER_UUID',true);

do $$
declare
  owner_role text := current_user;
  v3 uuid := current_setting('lejapon.audit.v3_quote_id')::uuid;
  browser_actor uuid := current_setting('lejapon.audit.browser_user_id')::uuid;
  other_quote uuid := current_setting('lejapon.audit.other_quote_id')::uuid;
  other_actor uuid := current_setting('lejapon.audit.other_user_id')::uuid;
  staff_actor uuid := current_setting('lejapon.audit.staff_user_id')::uuid;
  source_quote public.supplier_trip_quotes%rowtype;
  q record; actor record; table_name text;
  permitted boolean; expected_count bigint; received_count bigint;
  reply jsonb; latest_id uuid; expected_ids uuid[]; received_ids uuid[];
begin
  select * into strict source_quote from public.supplier_trip_quotes where id=v3;
  if source_quote.version_number<>3 then raise exception 'Target is not existing V3'; end if;
  if public.is_staff(browser_actor) or public.is_staff(other_actor) then
    raise exception 'Supplier isolation tests require non-staff supplier identities';
  end if;
  if not public.is_staff(staff_actor) then raise exception 'Staff test ID is not internal staff'; end if;
  if not exists(select 1 from public.supplier_members where user_id=browser_actor and supplier_id=source_quote.supplier_id) then
    raise exception 'Browser user does not belong to V3 supplier';
  end if;
  if not exists(select 1 from public.supplier_trip_quotes qb join public.supplier_members sm on sm.supplier_id=qb.supplier_id
    where qb.id=other_quote and sm.user_id=other_actor and qb.supplier_id<>source_quote.supplier_id) then
    raise exception 'Supplier B quote/membership is invalid';
  end if;
  if exists(select 1 from public.supplier_members where user_id=other_actor and supplier_id=source_quote.supplier_id)
    or exists(select 1 from public.supplier_trip_quotes qb join public.supplier_members sm on sm.supplier_id=qb.supplier_id
      where qb.id=other_quote and sm.user_id=browser_actor) then
    raise exception 'Selected suppliers share memberships; select independent supplier identities';
  end if;
  if (select count(distinct version_number) from public.supplier_trip_quotes
    where trip_id=source_quote.trip_id and supplier_id=source_quote.supplier_id and version_number between 1 and 4)<>4 then
    raise exception 'V1/V2/V3/V4 are not all present; investigate instead of creating a version';
  end if;

  for actor in select * from (values
    ('browser_supplier',browser_actor),('other_supplier',other_actor),('staff',staff_actor)
  ) a(label,user_id) loop
    for q in select * from public.supplier_trip_quotes
      where (trip_id=source_quote.trip_id and supplier_id=source_quote.supplier_id and version_number between 1 and 4)
        or id=other_quote order by version_number loop
      permitted := actor.label='staff' or exists(
        select 1 from public.supplier_members sm join public.trip_suppliers ts on ts.supplier_id=sm.supplier_id
        where sm.user_id=actor.user_id and sm.supplier_id=q.supplier_id and ts.trip_id=q.trip_id and ts.status<>'cancelled'
      );
      -- Own supplier versions must be readable, including archived versions.
      if actor.label='browser_supplier' and q.supplier_id=source_quote.supplier_id and not permitted then
        raise exception 'V% assignment is not active; inspect assignment lifecycle',q.version_number;
      end if;
      foreach table_name in array array['supplier_quote_hotel_rows','supplier_quote_transport_rows',
        'supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows'] loop
        execute format('select count(*) from public.%I where quote_id=$1',table_name) into expected_count using q.id;
        perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
        perform set_config('request.jwt.claim.role','authenticated',true);
        perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.user_id,'role','authenticated')::text,true);
        perform set_config('role','authenticated',true);
        begin
          execute format('select count(*) from (select * from public.%I where quote_id=$1 order by sort_order) loaded',table_name)
            into received_count using q.id;
          raise notice '%',jsonb_build_object('test','section_select','actor',actor.label,'user_id',actor.user_id,
            'quote_id',q.id,'version',q.version_number,'status',q.status,'table',table_name,
            'persisted_count',expected_count,'expected_visible',case when permitted then expected_count else 0 end,
            'received_count',received_count,'result',case when received_count=(case when permitted then expected_count else 0 end) then 'PASS' else 'FAIL' end);
        exception when others then
          raise notice '%',jsonb_build_object('test','section_select','actor',actor.label,'quote_id',q.id,
            'table',table_name,'persisted_count',expected_count,'result','ERROR','code',sqlstate,'message',sqlerrm);
        end;
        perform set_config('role',owner_role,true);
      end loop;
      perform set_config('role','authenticated',true);
      begin
        reply := public.get_supplier_quote_version_v2(q.id);
        raise notice '%',jsonb_build_object('test','historical_rpc','actor',actor.label,'quote_id',q.id,
          'version',q.version_number,'result',case when permitted and (reply->>'id')::uuid=q.id then 'PASS' else 'FAIL' end);
      exception when others then
        raise notice '%',jsonb_build_object('test','historical_rpc','actor',actor.label,'quote_id',q.id,
          'result',case when not permitted and sqlstate='42501' then 'PASS' else 'ERROR' end,'code',sqlstate,'message',sqlerrm);
      end;
      perform set_config('role',owner_role,true);
    end loop;
  end loop;

  select id into latest_id from public.supplier_trip_quotes where trip_id=source_quote.trip_id
    and supplier_id=source_quote.supplier_id order by version_number desc,created_at desc limit 1;
  select array_agg(id order by version_number desc,created_at desc) into expected_ids
    from public.supplier_trip_quotes where trip_id=source_quote.trip_id and supplier_id=source_quote.supplier_id;
  perform set_config('request.jwt.claim.sub',browser_actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',browser_actor,'role','authenticated')::text,true);
  perform set_config('role','authenticated',true);
  begin
    reply := public.get_supplier_trip_quote(source_quote.trip_id,source_quote.supplier_id);
    raise notice '%',jsonb_build_object('test','latest_rpc','expected_quote_id',latest_id,'received_quote_id',reply->>'id',
      'result',case when (reply->>'id')::uuid=latest_id then 'PASS' else 'FAIL' end);
    reply := public.get_supplier_quote_versions_v2(source_quote.trip_id,source_quote.supplier_id);
    select array_agg((value->>'id')::uuid order by ordinality) into received_ids from jsonb_array_elements(reply) with ordinality;
    raise notice '%',jsonb_build_object('test','version_list_rpc','expected_ids',expected_ids,'received_ids',received_ids,
      'result',case when received_ids=expected_ids then 'PASS' else 'FAIL' end);
  exception when others then
    raise notice '%',jsonb_build_object('test','latest_and_version_list_rpc','result','ERROR','code',sqlstate,'message',sqlerrm);
  end;
  perform set_config('role',owner_role,true);

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  perform set_config('role','anon',true);
  foreach table_name in array array['supplier_quote_hotel_rows','supplier_quote_transport_rows',
    'supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows'] loop
    begin
      execute format('select count(*) from public.%I',table_name) into received_count;
      raise notice '%',jsonb_build_object('test','anon_sections','table',table_name,'received_count',received_count,
        'result',case when received_count=0 then 'PASS' else 'FAIL' end);
    exception when insufficient_privilege then
      raise notice '%',jsonb_build_object('test','anon_sections','table',table_name,'result','PASS','code',sqlstate,'message',sqlerrm);
    when others then
      raise notice '%',jsonb_build_object('test','anon_sections','table',table_name,'result','ERROR','code',sqlstate,'message',sqlerrm);
    end;
  end loop;
  begin
    select count(*) into received_count from public.trips;
    raise notice '%',jsonb_build_object('test','anon_trips','visible_count',received_count,
      'result',case when received_count>0 then 'PASS' else 'FAIL' end);
  exception when others then
    raise notice '%',jsonb_build_object('test','anon_trips','result','ERROR','code',sqlstate,'message',sqlerrm);
  end;
  perform set_config('role',owner_role,true);
end $$;
rollback;
