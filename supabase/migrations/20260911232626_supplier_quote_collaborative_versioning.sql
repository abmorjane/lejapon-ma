-- Supplier quotation lifecycle V2.
-- Additive only: trip_suppliers remains the assignment model and each
-- supplier_trip_quotes row becomes one immutable submitted/approved version.

alter table if exists public.supplier_trip_quotes
  add column if not exists version_number integer not null default 1,
  add column if not exists parent_quote_id uuid references public.supplier_trip_quotes(id) on delete set null,
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists revision_requested_at timestamptz;

create index if not exists idx_supplier_trip_quotes_version_history
  on public.supplier_trip_quotes(trip_id,supplier_id,version_number desc,created_at desc)
  where supplier_id is not null;

-- Existing installations can contain more than one historical row for a
-- trip/supplier. Number them deterministically without deleting any history.
with numbered as (
  select id,row_number() over(
    partition by trip_id,supplier_id order by created_at,id
  ) version_number
  from public.supplier_trip_quotes
  where supplier_id is not null
)
update public.supplier_trip_quotes q
set version_number=n.version_number
from numbered n
where q.id=n.id and q.version_number is distinct from n.version_number;

create or replace function public.get_supplier_trip_quote(p_trip_id uuid,p_supplier_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null or p_supplier_id not in(select public.user_supplier_ids(actor))
    or not public.supplier_can_access_trip(actor,p_trip_id) then
    raise exception 'supplier trip access denied' using errcode='42501';
  end if;
  select * into q from public.supplier_trip_quotes
  where trip_id=p_trip_id and supplier_id=p_supplier_id
  order by version_number desc,created_at desc limit 1;
  if not found then return null; end if;
  return to_jsonb(q)-array['commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $$;
revoke all on function public.get_supplier_trip_quote(uuid,uuid) from public,anon;
grant execute on function public.get_supplier_trip_quote(uuid,uuid) to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'supplier_quote_hotel_rows','supplier_quote_transport_rows',
    'supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format(
        'alter table public.%I add column if not exists included_in_total boolean not null default true, add column if not exists review_status text not null default ''pending'', add column if not exists reviewed_by uuid references auth.users(id) on delete set null, add column if not exists reviewed_at timestamptz, add column if not exists source_line_id uuid',
        table_name
      );
      execute format('create index if not exists %I on public.%I(quote_id,included_in_total,sort_order)', 'idx_'||table_name||'_included', table_name);
    end if;
  end loop;
end $$;

-- supplier_quote_comments existed before this migration in production, but
-- older variants did not all expose the same columns.
do $$
begin
  if to_regclass('public.supplier_quote_comments') is not null then
    alter table public.supplier_quote_comments
      add column if not exists row_table text,
      add column if not exists row_id uuid,
      add column if not exists visibility text not null default 'internal',
      add column if not exists body text,
      add column if not exists created_by uuid references auth.users(id) on delete set null,
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz,
      add column if not exists author_name text,
      add column if not exists requires_attention boolean not null default false;
    create index if not exists idx_supplier_quote_comments_line
      on public.supplier_quote_comments(quote_id,row_table,row_id,created_at);
  end if;
end $$;

alter table if exists public.supplier_portal_notifications
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists email_attempt_count integer not null default 0,
  add column if not exists email_last_error text,
  add column if not exists email_sent_at timestamptz;

-- One entry point for trip assignment. It rejects inactive suppliers, keeps
-- history, cancels only the previous active quote-request assignment, creates
-- V1 when needed, and lets the existing assignment trigger create the portal
-- notification/email outbox item.
create or replace function public.assign_supplier_trip_quote_v2(
  p_trip_id uuid,p_supplier_id uuid
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null or not public.is_staff(actor) then
    raise exception 'staff access required' using errcode='42501';
  end if;
  if not exists(select 1 from public.trips where id=p_trip_id) then
    raise exception 'trip not found' using errcode='P0002';
  end if;
  if not exists(select 1 from public.suppliers where id=p_supplier_id and coalesce(status,'active')='active') then
    raise exception 'active supplier not found' using errcode='P0002';
  end if;

  update public.trip_suppliers set status='cancelled',updated_at=statement_timestamp()
  where trip_id=p_trip_id and supplier_id<>p_supplier_id
    and assignment_type='quote_request' and status<>'cancelled';

  insert into public.trip_suppliers(
    trip_id,supplier_id,role,assignment_type,status,assigned_at,assigned_by,updated_at
  ) values(
    p_trip_id,p_supplier_id,'japan_office','quote_request','assigned',statement_timestamp(),actor,statement_timestamp()
  ) on conflict(trip_id,supplier_id) do update set
    role='japan_office',assignment_type='quote_request',status=case when public.trip_suppliers.status='cancelled' then 'assigned' else public.trip_suppliers.status end,
    assigned_at=case when public.trip_suppliers.status='cancelled' then statement_timestamp() else public.trip_suppliers.assigned_at end,
    assigned_by=actor,updated_at=statement_timestamp();

  select * into q from public.supplier_trip_quotes
  where trip_id=p_trip_id and supplier_id=p_supplier_id
    and status in ('draft','submitted','reviewed','revision_requested','approved')
  order by version_number desc,created_at desc limit 1;
  if not found then
    insert into public.supplier_trip_quotes(
      trip_id,supplier_id,status,version_number,created_by,updated_by
    ) values(p_trip_id,p_supplier_id,'draft',1,actor,actor)
    returning * into q;
  end if;
  return jsonb_build_object('assignment_created',true,'quote_id',q.id,'version_number',q.version_number,'status',q.status);
end $$;
revoke all on function public.assign_supplier_trip_quote_v2(uuid,uuid) from public,anon;
grant execute on function public.assign_supplier_trip_quote_v2(uuid,uuid) to authenticated;

create or replace function public.unassign_supplier_trip_quote_v2(p_trip_id uuid)
returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid());
begin
  if actor is null or not public.is_staff(actor) then
    raise exception 'staff access required' using errcode='42501';
  end if;
  update public.trip_suppliers set status='cancelled',updated_at=statement_timestamp()
  where trip_id=p_trip_id and assignment_type='quote_request' and status<>'cancelled';
end $$;
revoke all on function public.unassign_supplier_trip_quote_v2(uuid) from public,anon;
grant execute on function public.unassign_supplier_trip_quote_v2(uuid) to authenticated;

-- Server-owned totals. The supplier amount is the sum of included line
-- snapshots only. Agency commission/exchange calculations remain unchanged.
create or replace function public.recalculate_supplier_quote_totals_v2(p_quote_id uuid)
returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare h numeric:=0;t numeric:=0;a numeric:=0;g numeric:=0;o numeric:=0;
  pct numeric:=0;rate numeric:=0;participants integer:=1;grand numeric:=0;commission numeric:=0;final_jpy numeric:=0;
begin
  select coalesce(sum(subtotal_jpy),0) into h from public.supplier_quote_hotel_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into t from public.supplier_quote_transport_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into a from public.supplier_quote_activity_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into g from public.supplier_quote_guide_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(sum(subtotal_jpy),0) into o from public.supplier_quote_other_rows where quote_id=p_quote_id and included_in_total;
  select coalesce(commission_percentage,0),coalesce(exchange_rate_jpy_mad,0),greatest(1,coalesce(participant_count,1))
    into pct,rate,participants from public.supplier_trip_quotes where id=p_quote_id;
  grand:=h+t+a+g+o; commission:=grand*pct/100; final_jpy:=grand+commission;
  update public.supplier_trip_quotes set
    total_hotels_jpy=h,total_transport_jpy=t,total_activities_jpy=a,total_guides_jpy=g,total_other_jpy=o,
    grand_total_jpy=grand,commission_amount_jpy=commission,final_total_jpy=final_jpy,
    final_total_mad=final_jpy*rate,cost_per_person_jpy=final_jpy/participants,
    cost_per_person_mad=(final_jpy*rate)/participants,updated_at=statement_timestamp()
  where id=p_quote_id;
end $$;
revoke all on function public.recalculate_supplier_quote_totals_v2(uuid) from public,anon,authenticated;

-- Saves one editable supplier version atomically. Existing row ids remain
-- stable, so line comments never disappear because of a blanket delete/reinsert.
create or replace function public.supplier_save_trip_quote_v2(
  p_quote_id uuid,p_trip_id uuid,p_supplier_id uuid,p_status text,
  p_payload jsonb default '{}'::jsonb,p_rows jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype; item jsonb; row_id uuid;
begin
  if actor is null or p_supplier_id not in(select public.user_supplier_ids(actor))
    or not public.supplier_can_access_trip(actor,p_trip_id) then
    raise exception 'supplier trip access denied' using errcode='42501';
  end if;
  if p_status not in ('draft','submitted') then raise exception 'supplier status not allowed' using errcode='22023'; end if;

  if p_quote_id is null then
    if exists(select 1 from public.supplier_trip_quotes where trip_id=p_trip_id and supplier_id=p_supplier_id) then
      raise exception 'select or create a new quote version first' using errcode='55000';
    end if;
    insert into public.supplier_trip_quotes(trip_id,supplier_id,status,version_number,created_by,updated_by)
    values(p_trip_id,p_supplier_id,'draft',1,actor,actor) returning * into q;
  else
    select * into q from public.supplier_trip_quotes
    where id=p_quote_id and trip_id=p_trip_id and supplier_id=p_supplier_id for update;
    if not found then raise exception 'supplier quote not found' using errcode='P0002'; end if;
    if q.status not in ('draft','revision_requested') then
      raise exception 'submitted supplier quote is immutable; create a new version' using errcode='55000';
    end if;
  end if;

  -- Hotels
  for item in select value from jsonb_array_elements(coalesce(p_rows->'hotels','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_hotel_rows(id,quote_id,sort_order,city,hotel_name,check_in,check_out,nights,room_type,rooms_count,room_count,unit_price_jpy,price_per_room_per_night_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'city',''),nullif(item->>'hotel_name',''),nullif(item->>'check_in','')::date,nullif(item->>'check_out','')::date,greatest(0,coalesce((item->>'nights')::int,0)),nullif(item->>'room_type',''),greatest(0,coalesce((item->>'rooms_count')::int,(item->>'room_count')::int,0)),greatest(0,coalesce((item->>'room_count')::int,(item->>'rooms_count')::int,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,(item->>'price_per_room_per_night_jpy')::numeric,0)),greatest(0,coalesce((item->>'price_per_room_per_night_jpy')::numeric,(item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,coalesce(nullif(item->>'status',''),'todo'),statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,city=excluded.city,hotel_name=excluded.hotel_name,check_in=excluded.check_in,check_out=excluded.check_out,nights=excluded.nights,room_type=excluded.room_type,rooms_count=excluded.rooms_count,room_count=excluded.room_count,unit_price_jpy=excluded.unit_price_jpy,price_per_room_per_night_jpy=excluded.price_per_room_per_night_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,status=excluded.status,updated_at=statement_timestamp()
    where public.supplier_quote_hotel_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_hotel_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'hotels','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Transport
  for item in select value from jsonb_array_elements(coalesce(p_rows->'transport','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_transport_rows(id,quote_id,sort_order,service_date,day_number,city_route,transport_type,description,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'service_date','')::date,nullif(item->>'day_number','')::int,nullif(item->>'city_route',''),nullif(item->>'transport_type',''),nullif(item->>'description',''),greatest(0,coalesce((item->>'quantity')::numeric,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,coalesce(nullif(item->>'status',''),'todo'),statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,service_date=excluded.service_date,day_number=excluded.day_number,city_route=excluded.city_route,transport_type=excluded.transport_type,description=excluded.description,quantity=excluded.quantity,unit_price_jpy=excluded.unit_price_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,status=excluded.status,updated_at=statement_timestamp()
    where public.supplier_quote_transport_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_transport_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'transport','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Activities
  for item in select value from jsonb_array_elements(coalesce(p_rows->'activities','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_activity_rows(id,quote_id,sort_order,service_date,day_number,activity_name,participant_count,quantity,unit_price_jpy,subtotal_jpy,optional,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'service_date','')::date,nullif(item->>'day_number','')::int,nullif(item->>'activity_name',''),greatest(0,coalesce((item->>'participant_count')::numeric,(item->>'quantity')::numeric,0)),greatest(0,coalesce((item->>'quantity')::numeric,(item->>'participant_count')::numeric,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),coalesce((item->>'optional')::boolean,false),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,coalesce(nullif(item->>'status',''),'todo'),statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,service_date=excluded.service_date,day_number=excluded.day_number,activity_name=excluded.activity_name,participant_count=excluded.participant_count,quantity=excluded.quantity,unit_price_jpy=excluded.unit_price_jpy,subtotal_jpy=excluded.subtotal_jpy,optional=excluded.optional,comment=excluded.comment,assigned_to=excluded.assigned_to,status=excluded.status,updated_at=statement_timestamp()
    where public.supplier_quote_activity_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_activity_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'activities','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Guides
  for item in select value from jsonb_array_elements(coalesce(p_rows->'guides','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_guide_rows(id,quote_id,sort_order,service_date,day_number,city,guide_type,guides_count,guide_count,daily_price_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'service_date','')::date,nullif(item->>'day_number','')::int,nullif(item->>'city',''),nullif(item->>'guide_type',''),greatest(0,coalesce((item->>'guides_count')::int,(item->>'guide_count')::int,0)),greatest(0,coalesce((item->>'guide_count')::int,(item->>'guides_count')::int,0)),greatest(0,coalesce((item->>'daily_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,coalesce(nullif(item->>'status',''),'todo'),statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,service_date=excluded.service_date,day_number=excluded.day_number,city=excluded.city,guide_type=excluded.guide_type,guides_count=excluded.guides_count,guide_count=excluded.guide_count,daily_price_jpy=excluded.daily_price_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,status=excluded.status,updated_at=statement_timestamp()
    where public.supplier_quote_guide_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_guide_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'guides','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  -- Other
  for item in select value from jsonb_array_elements(coalesce(p_rows->'other','[]'::jsonb)) loop
    row_id:=coalesce(nullif(item->>'id','')::uuid,nullif(item->>'local_id','')::uuid,gen_random_uuid());
    insert into public.supplier_quote_other_rows(id,quote_id,sort_order,label,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,updated_at)
    values(row_id,q.id,coalesce((item->>'sort_order')::int,0),nullif(item->>'label',''),greatest(0,coalesce((item->>'quantity')::numeric,0)),greatest(0,coalesce((item->>'unit_price_jpy')::numeric,0)),greatest(0,coalesce((item->>'subtotal_jpy')::numeric,0)),nullif(item->>'comment',''),nullif(item->>'assigned_to','')::uuid,coalesce(nullif(item->>'status',''),'todo'),statement_timestamp())
    on conflict(id) do update set sort_order=excluded.sort_order,label=excluded.label,quantity=excluded.quantity,unit_price_jpy=excluded.unit_price_jpy,subtotal_jpy=excluded.subtotal_jpy,comment=excluded.comment,assigned_to=excluded.assigned_to,status=excluded.status,updated_at=statement_timestamp()
    where public.supplier_quote_other_rows.quote_id=q.id;
  end loop;
  delete from public.supplier_quote_other_rows r where r.quote_id=q.id and not exists(select 1 from jsonb_array_elements(coalesce(p_rows->'other','[]'::jsonb)) j where coalesce(j->>'id',j->>'local_id')=r.id::text);

  update public.supplier_trip_quotes set
    status=p_status,participant_count=greatest(0,coalesce((p_payload->>'participant_count')::int,participant_count)),
    supplier_notes=case when p_payload ? 'supplier_notes' then nullif(p_payload->>'supplier_notes','') else supplier_notes end,
    validation_status=case when p_payload ? 'validation_status' then coalesce(nullif(p_payload->>'validation_status',''),'draft') else validation_status end,
    validation_snapshot=coalesce(p_payload->'validation_snapshot',validation_snapshot),
    validation_metadata=coalesce(p_payload->'validation_metadata',validation_metadata),
    validation_completion_percentage=coalesce((p_payload->>'validation_completion_percentage')::numeric,validation_completion_percentage),
    validation_updated_by=actor,validation_updated_at=statement_timestamp(),updated_by=actor,
    submitted_at=case when p_status='submitted' then statement_timestamp() else submitted_at end,
    submitted_by=case when p_status='submitted' then actor else submitted_by end,updated_at=statement_timestamp()
  where id=q.id returning * into q;
  perform public.recalculate_supplier_quote_totals_v2(q.id);
  return (select to_jsonb(x)-array['commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'] from public.supplier_trip_quotes x where x.id=q.id);
end $$;
revoke all on function public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.supplier_save_trip_quote_v2(uuid,uuid,uuid,text,jsonb,jsonb) to authenticated;

-- Superseded by the atomic V2 save above; keeping its definition preserves
-- rollback compatibility while removing the non-atomic public entry point.
do $$begin
  if to_regprocedure('public.supplier_save_trip_quote_header(uuid,uuid,uuid,text,jsonb)') is not null then
    revoke execute on function public.supplier_save_trip_quote_header(uuid,uuid,uuid,text,jsonb) from authenticated;
  end if;
end $$;

create or replace function public.create_supplier_quote_version_v2(p_quote_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); source public.supplier_trip_quotes%rowtype; target public.supplier_trip_quotes%rowtype; next_version int;
begin
  select * into source from public.supplier_trip_quotes where id=p_quote_id for update;
  if not found or source.status<>'approved' or not public.supplier_can_access_quote(actor,source.id,false) then
    raise exception 'approved supplier quote access required' using errcode='42501';
  end if;
  if exists(select 1 from public.supplier_trip_quotes where trip_id=source.trip_id and supplier_id=source.supplier_id and status in ('draft','submitted','reviewed','revision_requested')) then
    raise exception 'an active quote version already exists' using errcode='55000';
  end if;
  select coalesce(max(version_number),0)+1 into next_version from public.supplier_trip_quotes where trip_id=source.trip_id and supplier_id=source.supplier_id;
  insert into public.supplier_trip_quotes(
    trip_id,supplier_id,status,version_number,parent_quote_id,participant_count,commission_percentage,exchange_rate_jpy_mad,
    total_hotels_jpy,total_transport_jpy,total_activities_jpy,total_guides_jpy,total_other_jpy,grand_total_jpy,
    commission_amount_jpy,final_total_jpy,final_total_mad,cost_per_person_jpy,cost_per_person_mad,supplier_notes,
    validation_status,validation_snapshot,validation_metadata,validation_completion_percentage,created_by,updated_by
  ) select trip_id,supplier_id,'draft',next_version,id,participant_count,commission_percentage,exchange_rate_jpy_mad,
    total_hotels_jpy,total_transport_jpy,total_activities_jpy,total_guides_jpy,total_other_jpy,grand_total_jpy,
    commission_amount_jpy,final_total_jpy,final_total_mad,cost_per_person_jpy,cost_per_person_mad,supplier_notes,
    'in_progress',validation_snapshot,validation_metadata,validation_completion_percentage,actor,actor
    from public.supplier_trip_quotes where id=source.id returning * into target;
  insert into public.supplier_quote_hotel_rows(quote_id,sort_order,city,hotel_name,check_in,check_out,nights,room_type,rooms_count,room_count,unit_price_jpy,price_per_room_per_night_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,city,hotel_name,check_in,check_out,nights,room_type,rooms_count,room_count,unit_price_jpy,price_per_room_per_night_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_hotel_rows where quote_id=source.id;
  insert into public.supplier_quote_transport_rows(quote_id,sort_order,service_date,day_number,city_route,transport_type,description,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,service_date,day_number,city_route,transport_type,description,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_transport_rows where quote_id=source.id;
  insert into public.supplier_quote_activity_rows(quote_id,sort_order,service_date,day_number,activity_name,participant_count,quantity,unit_price_jpy,subtotal_jpy,optional,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,service_date,day_number,activity_name,participant_count,quantity,unit_price_jpy,subtotal_jpy,optional,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_activity_rows where quote_id=source.id;
  insert into public.supplier_quote_guide_rows(quote_id,sort_order,service_date,day_number,city,guide_type,guides_count,guide_count,daily_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,service_date,day_number,city,guide_type,guides_count,guide_count,daily_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_guide_rows where quote_id=source.id;
  insert into public.supplier_quote_other_rows(quote_id,sort_order,label,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,review_status,source_line_id)
    select target.id,sort_order,label,quantity,unit_price_jpy,subtotal_jpy,comment,assigned_to,status,included_in_total,'pending',id from public.supplier_quote_other_rows where quote_id=source.id;
  return to_jsonb(target)-array['commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $$;
revoke all on function public.create_supplier_quote_version_v2(uuid) from public,anon;
grant execute on function public.create_supplier_quote_version_v2(uuid) to authenticated;

create or replace function public.review_supplier_quote_line_v2(
  p_quote_id uuid,p_row_table text,p_row_id uuid,p_included boolean,p_review_status text
)
returns void language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); quote_status text;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'staff access required' using errcode='42501'; end if;
  if p_row_table not in ('supplier_quote_hotel_rows','supplier_quote_transport_rows','supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows') then raise exception 'invalid row table' using errcode='22023'; end if;
  if p_review_status not in ('pending','approved','rejected') then raise exception 'invalid review status' using errcode='22023'; end if;
  select status into quote_status from public.supplier_trip_quotes where id=p_quote_id for update;
  if quote_status not in ('submitted','reviewed') then raise exception 'quote is not under review' using errcode='55000'; end if;
  execute format('update public.%I set included_in_total=$1,review_status=$2,reviewed_by=$3,reviewed_at=statement_timestamp(),updated_at=statement_timestamp() where id=$4 and quote_id=$5',p_row_table)
    using p_included,p_review_status,actor,p_row_id,p_quote_id;
  perform public.recalculate_supplier_quote_totals_v2(p_quote_id);
end $$;
revoke all on function public.review_supplier_quote_line_v2(uuid,text,uuid,boolean,text) from public,anon;
grant execute on function public.review_supplier_quote_line_v2(uuid,text,uuid,boolean,text) to authenticated;

create or replace function public.review_supplier_quote_v2(
  p_quote_id uuid,p_action text,p_feedback text default null
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'staff access required' using errcode='42501'; end if;
  if p_action not in ('reviewed','revision_requested','approved','rejected') then raise exception 'invalid review action' using errcode='22023'; end if;
  select * into q from public.supplier_trip_quotes where id=p_quote_id for update;
  if not found or q.status not in ('submitted','reviewed','revision_requested') then raise exception 'quote cannot transition' using errcode='55000'; end if;
  perform public.recalculate_supplier_quote_totals_v2(q.id);
  if p_action='approved' then
    update public.supplier_trip_quotes set status='archived',updated_at=statement_timestamp()
      where trip_id=q.trip_id and supplier_id=q.supplier_id and id<>q.id and status='approved';
  end if;
  update public.supplier_trip_quotes set status=p_action,admin_feedback=nullif(trim(p_feedback),''),
    reviewed_at=case when p_action in ('reviewed','revision_requested','approved','rejected') then statement_timestamp() else reviewed_at end,
    approved_at=case when p_action='approved' then statement_timestamp() else approved_at end,
    approved_by=case when p_action='approved' then actor else approved_by end,
    revision_requested_at=case when p_action='revision_requested' then statement_timestamp() else revision_requested_at end,
    updated_by=actor,updated_at=statement_timestamp()
  where id=q.id returning * into q;
  if p_action in ('revision_requested','approved') and q.supplier_id is not null then
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key,email_delivery_status,email_scheduled_at
    ) values(
      q.supplier_id,
      case when p_action='approved' then 'quote_approved' else 'quote_revision_requested' end,
      case when p_action='approved' then 'Devis fournisseur approuvé' else 'Correction demandée sur le devis' end,
      coalesce(nullif(trim(p_feedback),''),case when p_action='approved' then 'La version du devis a été approuvée.' else 'Une correction du devis est demandée.' end),
      'supplier_quote',q.id,'/supplier/trips/'||q.trip_id::text||'/quote',
      'quote-review:'||q.id::text||':'||p_action||':'||extract(epoch from statement_timestamp())::text,
      'pending',statement_timestamp()
    );
  end if;
  return to_jsonb(q);
end $$;
revoke all on function public.review_supplier_quote_v2(uuid,text,text) from public,anon;
grant execute on function public.review_supplier_quote_v2(uuid,text,text) to authenticated;

create or replace function public.admin_save_supplier_quote_settings_v2(
  p_quote_id uuid,p_commission_percentage numeric,p_exchange_rate numeric,
  p_internal_notes text,p_supplier_notes text,p_validation_status text,
  p_validation_snapshot jsonb,p_validation_metadata jsonb,p_validation_completion numeric
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'staff access required' using errcode='42501'; end if;
  if p_validation_status not in ('draft','in_progress','ready_for_japan_office','japan_office_confirmed','ready_to_travel') then raise exception 'invalid validation status' using errcode='22023'; end if;
  update public.supplier_trip_quotes set commission_percentage=greatest(0,coalesce(p_commission_percentage,commission_percentage)),
    exchange_rate_jpy_mad=greatest(0,coalesce(p_exchange_rate,exchange_rate_jpy_mad)),internal_notes=nullif(p_internal_notes,''),
    supplier_notes=p_supplier_notes,validation_status=p_validation_status,validation_snapshot=coalesce(p_validation_snapshot,validation_snapshot),
    validation_metadata=coalesce(p_validation_metadata,validation_metadata),validation_completion_percentage=coalesce(p_validation_completion,validation_completion_percentage),
    validation_updated_by=actor,validation_updated_at=statement_timestamp(),updated_by=actor,updated_at=statement_timestamp()
  where id=p_quote_id and status not in ('approved','archived') returning * into q;
  if not found then raise exception 'quote not found or approved version is immutable' using errcode='55000'; end if;
  perform public.recalculate_supplier_quote_totals_v2(q.id);
  return (select to_jsonb(x) from public.supplier_trip_quotes x where x.id=q.id);
end $$;
revoke all on function public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric) from public,anon;
grant execute on function public.admin_save_supplier_quote_settings_v2(uuid,numeric,numeric,text,text,text,jsonb,jsonb,numeric) to authenticated;

create or replace function public.save_supplier_operational_state_v2(
  p_quote_id uuid,p_supplier_notes text,p_validation_status text,
  p_validation_snapshot jsonb,p_validation_metadata jsonb,p_validation_completion numeric
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype; staff boolean:=public.is_staff(actor);
begin
  if actor is null or (not staff and not public.supplier_can_access_quote(actor,p_quote_id,false)) then raise exception 'quote access denied' using errcode='42501'; end if;
  if (staff and p_validation_status not in ('draft','in_progress','ready_for_japan_office','japan_office_confirmed','ready_to_travel'))
    or (not staff and p_validation_status not in ('draft','in_progress','ready_for_japan_office')) then raise exception 'validation status not allowed' using errcode='22023'; end if;
  update public.supplier_trip_quotes set supplier_notes=p_supplier_notes,validation_status=p_validation_status,
    validation_snapshot=coalesce(p_validation_snapshot,validation_snapshot),validation_metadata=coalesce(p_validation_metadata,validation_metadata),
    validation_completion_percentage=coalesce(p_validation_completion,validation_completion_percentage),validation_updated_by=actor,
    validation_updated_at=statement_timestamp(),updated_by=actor,updated_at=statement_timestamp()
  where id=p_quote_id and status<>'archived' returning * into q;
  if not found then raise exception 'historical quote version is immutable' using errcode='55000'; end if;
  if staff then return to_jsonb(q); end if;
  return to_jsonb(q)-array['commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $$;
revoke all on function public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric) from public,anon;
grant execute on function public.save_supplier_operational_state_v2(uuid,text,text,jsonb,jsonb,numeric) to authenticated;

create or replace function public.add_supplier_quote_comment_v2(
  p_quote_id uuid,p_row_table text,p_row_id uuid,p_body text,p_visibility text default 'supplier',p_requires_attention boolean default false
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); staff boolean:=public.is_staff(actor); line_exists boolean; result jsonb; actor_name text; comment_id uuid;
begin
  if actor is null or trim(coalesce(p_body,''))='' then raise exception 'comment body required' using errcode='22023'; end if;
  if p_row_table not in ('supplier_quote_hotel_rows','supplier_quote_transport_rows','supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows') then raise exception 'invalid row table' using errcode='22023'; end if;
  if not staff and not public.supplier_can_access_quote(actor,p_quote_id,false) then raise exception 'quote access denied' using errcode='42501'; end if;
  if not staff and p_visibility<>'supplier' then raise exception 'supplier comments must be shared' using errcode='42501'; end if;
  if p_visibility not in ('supplier','internal') then raise exception 'invalid visibility' using errcode='22023'; end if;
  if not exists(select 1 from public.supplier_trip_quotes where id=p_quote_id) then raise exception 'quote not found' using errcode='P0002'; end if;
  execute format('select exists(select 1 from public.%I where id=$1 and quote_id=$2)',p_row_table)
    into line_exists using p_row_id,p_quote_id;
  if not line_exists then raise exception 'quote line not found' using errcode='P0002'; end if;
  select full_name into actor_name from public.profiles where id=actor;
  insert into public.supplier_quote_comments(quote_id,row_table,row_id,visibility,body,created_by,author_name,requires_attention)
  values(p_quote_id,p_row_table,p_row_id,p_visibility,trim(p_body),actor,actor_name,p_requires_attention)
  returning id into comment_id;
  select to_jsonb(c) into result from public.supplier_quote_comments c where c.id=comment_id;
  if staff and p_visibility='supplier' then
    insert into public.supplier_portal_notifications(supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key,email_delivery_status)
    select q.supplier_id,'quote_comment','Nouveau commentaire sur le devis',left(trim(p_body),500),
      'supplier_quote',q.id,'/supplier/trips/'||q.trip_id::text||'/quote',
      'quote-comment:'||comment_id::text,'pending'
    from public.supplier_trip_quotes q where q.id=p_quote_id and q.supplier_id is not null
    on conflict(dedupe_key) do nothing;
  end if;
  return result;
end $$;
revoke all on function public.add_supplier_quote_comment_v2(uuid,text,uuid,text,text,boolean) from public,anon;
grant execute on function public.add_supplier_quote_comment_v2(uuid,text,uuid,text,text,boolean) to authenticated;

-- Direct line mutation is removed for authenticated users. Staff and suppliers
-- both use the narrow RPCs above: suppliers own amounts, staff own review flags.
revoke insert,update,delete on public.supplier_quote_hotel_rows,public.supplier_quote_transport_rows,
  public.supplier_quote_activity_rows,public.supplier_quote_guide_rows,public.supplier_quote_other_rows,
  public.supplier_quote_comments from authenticated;
grant select on public.supplier_quote_hotel_rows,public.supplier_quote_transport_rows,
  public.supplier_quote_activity_rows,public.supplier_quote_guide_rows,public.supplier_quote_other_rows,
  public.supplier_quote_comments to authenticated;

create or replace function public.get_supplier_quote_versions_v2(p_trip_id uuid,p_supplier_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
  if actor is null or (
    not public.is_staff(actor) and (
      p_supplier_id not in(select public.user_supplier_ids(actor))
      or not public.supplier_can_access_trip(actor,p_trip_id)
    )
  ) then raise exception 'quote history access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(
    (to_jsonb(q)-array['commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'])
    order by q.version_number desc,q.created_at desc
  ),'[]'::jsonb) into result
  from public.supplier_trip_quotes q where q.trip_id=p_trip_id and q.supplier_id=p_supplier_id;
  return result;
end $$;
revoke all on function public.get_supplier_quote_versions_v2(uuid,uuid) from public,anon;
grant execute on function public.get_supplier_quote_versions_v2(uuid,uuid) to authenticated;

create or replace function public.get_supplier_quote_version_v2(p_quote_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  select * into q from public.supplier_trip_quotes where id=p_quote_id;
  if not found or actor is null or (
    not public.is_staff(actor) and not public.supplier_can_access_quote(actor,p_quote_id,false)
  ) then raise exception 'quote version access denied' using errcode='42501'; end if;
  if public.is_staff(actor) then return to_jsonb(q); end if;
  return to_jsonb(q)-array['commission_percentage','exchange_rate_jpy_mad','commission_amount_jpy','final_total_jpy','final_total_mad','cost_per_person_jpy','cost_per_person_mad','internal_notes'];
end $$;
revoke all on function public.get_supplier_quote_version_v2(uuid) from public,anon;
grant execute on function public.get_supplier_quote_version_v2(uuid) to authenticated;

-- Rich assignment notification while preserving the deployed notification table.
create or replace function public.notify_supplier_trip_assignment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare trip_row record; duration_days integer;
begin
  if tg_op='INSERT' or (old.status='cancelled' and new.status<>'cancelled')
    or (tg_op='UPDATE' and old.supplier_id is distinct from new.supplier_id) then
    select title,start_date,end_date,total_slots into trip_row from public.trips where id=new.trip_id;
    duration_days:=case when trip_row.start_date is not null and trip_row.end_date is not null then (trip_row.end_date-trip_row.start_date)+1 else null end;
    insert into public.supplier_portal_notifications(supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key,metadata,email_delivery_status,email_scheduled_at)
    values(new.supplier_id,'trip_assigned','Nouveau voyage assigné — devis demandé',
      coalesce(trip_row.title,'Un voyage')||' · '||coalesce(to_char(trip_row.start_date,'DD/MM/YYYY'),'date à confirmer')||' → '||coalesce(to_char(trip_row.end_date,'DD/MM/YYYY'),'date à confirmer'),
      'trip',new.trip_id,'/supplier/trips/'||new.trip_id::text||'/quote','trip-assigned:'||new.supplier_id::text||':'||new.trip_id::text,
      jsonb_build_object('trip_title',trip_row.title,'arrival_date',trip_row.start_date,'departure_date',trip_row.end_date,'duration_days',duration_days,'expected_participants',trip_row.total_slots),
      'pending',statement_timestamp())
    on conflict(dedupe_key) do update set title=excluded.title,message=excluded.message,link=excluded.link,metadata=excluded.metadata,read_at=null,email_delivery_status='pending',email_scheduled_at=statement_timestamp(),email_last_error=null,created_at=statement_timestamp();
  end if;
  return new;
end $$;

drop trigger if exists trip_supplier_assignment_notification on public.trip_suppliers;
create trigger trip_supplier_assignment_notification
after insert or update of supplier_id,status on public.trip_suppliers
for each row execute function public.notify_supplier_trip_assignment();
revoke all on function public.notify_supplier_trip_assignment() from public,anon,authenticated;

notify pgrst,'reload schema';
