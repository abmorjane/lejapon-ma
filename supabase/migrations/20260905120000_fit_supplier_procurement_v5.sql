-- FIT V5 procurement orchestration. Prices remain owned by the V4 FIT line
-- tables; tasks remain owned by operation_tasks; suppliers remain in suppliers.

create table if not exists public.fit_supplier_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete restrict,
  quote_group_id uuid not null references public.fit_quotes(id) on delete restrict,
  version_number integer not null,
  source_type text not null check(source_type in ('day_cost','cost_line','hotel')),
  source_id uuid not null,
  service_type text not null check(service_type in ('hotels','transport','guide','activities','restaurants','tickets','other')),
  service_label text not null,
  client_promise_snapshot jsonb not null default '{}'::jsonb,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_quote_id uuid,
  assigned_staff_id uuid references auth.users(id) on delete set null,
  status text not null default 'not_requested' check(status in ('not_requested','request_ready','sent','waiting_supplier','supplier_replied','option_hold','confirmed','unavailable','alternative_proposed','cancelled','paid','voucher_received')),
  request_date timestamptz,
  follow_up_at timestamptz,
  follow_up_hours integer not null default 24 check(follow_up_hours between 1 and 720),
  supplier_response text,
  confirmation_number text,
  hold_release_deadline timestamptz,
  cancellation_deadline timestamptz,
  payment_deadline timestamptz,
  supplier_notes text,
  supplier_quoted_cost numeric,
  confirmed_cost numeric,
  final_cost numeric,
  currency text not null default 'JPY' check(currency in ('JPY','MAD','EUR','USD')),
  exchange_rate_to_mad numeric not null default 1 check(exchange_rate_to_mad>0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(quote_id,source_type,source_id)
);

create table if not exists public.fit_supplier_alternatives (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.fit_supplier_requests(id) on delete cascade,
  title text not null,
  description text,
  proposed_cost numeric not null default 0 check(proposed_cost>=0),
  currency text not null default 'JPY' check(currency in ('JPY','MAD','EUR','USD')),
  price_difference_mad numeric not null default 0,
  operational_impact text,
  margin_impact_mad numeric not null default 0,
  decision text not null default 'pending' check(decision in ('pending','accepted','rejected','client_revision')),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.fit_supplier_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.fit_supplier_requests(id) on delete cascade,
  document_type text not null default 'confirmation' check(document_type in ('request','response','confirmation','invoice','voucher','other')),
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.fit_supplier_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.fit_supplier_requests(id) on delete cascade,
  event text not null,
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fit_supplier_requests_control_idx on public.fit_supplier_requests(status,follow_up_at,hold_release_deadline,payment_deadline);
create index if not exists fit_supplier_requests_supplier_idx on public.fit_supplier_requests(supplier_id,status);
create index if not exists fit_supplier_alternatives_pending_idx on public.fit_supplier_alternatives(request_id) where decision='pending';
create index if not exists fit_supplier_attachments_request_idx on public.fit_supplier_request_attachments(request_id,created_at desc);
create unique index if not exists operation_tasks_fit_supplier_source_key_uidx
  on public.operation_tasks((metadata->>'source_key'))
  where metadata->>'source_key' like 'fit-supplier-%';

alter table public.fit_supplier_requests enable row level security;
alter table public.fit_supplier_alternatives enable row level security;
alter table public.fit_supplier_request_attachments enable row level security;
alter table public.fit_supplier_request_events enable row level security;

drop policy if exists "FIT procurement staff manage" on public.fit_supplier_requests;
create policy "FIT procurement staff manage" on public.fit_supplier_requests for all using(public.can_view_fit_internal_costs(auth.uid())) with check(public.can_view_fit_internal_costs(auth.uid()));
drop policy if exists "FIT supplier reads assigned requests" on public.fit_supplier_requests;
create policy "FIT supplier reads assigned requests" on public.fit_supplier_requests for select using(
  status not in ('not_requested','request_ready')
  and supplier_id in(select public.user_supplier_ids(auth.uid()))
);
drop policy if exists "FIT procurement staff manage alternatives" on public.fit_supplier_alternatives;
create policy "FIT procurement staff manage alternatives" on public.fit_supplier_alternatives for all using(exists(select 1 from public.fit_supplier_requests r where r.id=request_id and public.can_view_fit_internal_costs(auth.uid()))) with check(exists(select 1 from public.fit_supplier_requests r where r.id=request_id and public.can_view_fit_internal_costs(auth.uid())));
drop policy if exists "FIT supplier reads own alternatives" on public.fit_supplier_alternatives;
drop policy if exists "FIT procurement attachment access" on public.fit_supplier_request_attachments;
create policy "FIT procurement attachment access" on public.fit_supplier_request_attachments for all using(exists(select 1 from public.fit_supplier_requests r where r.id=request_id and (public.can_view_fit_internal_costs(auth.uid()) or r.supplier_id in(select public.user_supplier_ids(auth.uid()))))) with check(uploaded_by=auth.uid() and exists(select 1 from public.fit_supplier_requests r where r.id=request_id and (public.can_view_fit_internal_costs(auth.uid()) or r.supplier_id in(select public.user_supplier_ids(auth.uid())))));
drop policy if exists "FIT procurement events staff read" on public.fit_supplier_request_events;
create policy "FIT procurement events staff read" on public.fit_supplier_request_events for select using(exists(select 1 from public.fit_supplier_requests r where r.id=request_id and public.can_view_fit_internal_costs(auth.uid())));

revoke all on public.fit_supplier_requests,public.fit_supplier_alternatives,public.fit_supplier_request_attachments,public.fit_supplier_request_events from anon;
grant select,insert,update,delete on public.fit_supplier_requests,public.fit_supplier_alternatives to authenticated;
grant select,insert on public.fit_supplier_request_attachments to authenticated;
grant select on public.fit_supplier_request_events to authenticated;

create or replace function public.generate_fit_supplier_requests_v5(p_quote_id uuid,p_follow_up_hours integer default 24)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.fit_quotes%rowtype; actor uuid:=auth.uid(); inserted_count integer;
begin
  if actor is null or not public.can_view_fit_internal_costs(actor) or not public.can_access_fit_quote(p_quote_id,actor) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id for update;
  if q.accepted_snapshot_id is null or q.commercial_status not in ('accepted','deposit_pending','deposit_paid','converted_to_booking') then raise exception 'accepted quote required'; end if;
  insert into public.fit_supplier_requests(quote_id,quote_group_id,version_number,source_type,source_id,service_type,service_label,client_promise_snapshot,supplier_id,supplier_quote_id,status,follow_up_hours,created_by,currency,exchange_rate_to_mad,supplier_quoted_cost,confirmed_cost,final_cost)
  select q.id,q.quote_group_id,q.version_number,x.source_type,x.source_id,
    case when x.component_type in ('hotels','transport','guide','activities','restaurants','tickets') then x.component_type else 'other' end,
    coalesce(nullif(x.label,''),x.component_type),jsonb_build_object('service_type',x.component_type,'label',x.label,'version',q.version_number),x.supplier_id,x.supplier_quote_id,
    case when x.supplier_id is null then 'not_requested' else 'request_ready' end,greatest(1,least(coalesce(p_follow_up_hours,24),720)),actor,x.currency,x.exchange_rate,x.supplier_quoted_cost,x.confirmed_cost,x.final_cost
  from public._fit_financial_components_v4(q.id)x
  where x.source_type<>'flight' and x.component_type not in ('agency_fee','adjustment','discount')
  on conflict(quote_id,source_type,source_id) do nothing;
  get diagnostics inserted_count=row_count;
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload) values(q.id,q.partner_organization_id,actor,'supplier_requests_generated',jsonb_build_object('created',inserted_count,'follow_up_hours',p_follow_up_hours));
  return jsonb_build_object('ok',true,'created',inserted_count);
end $$;
revoke all on function public.generate_fit_supplier_requests_v5(uuid,integer) from public,anon;
grant execute on function public.generate_fit_supplier_requests_v5(uuid,integer) to authenticated;

create or replace function public.fit_supplier_request_before_write_v5()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if old.status='not_requested' and new.status='not_requested' and old.supplier_id is null and new.supplier_id is not null then
    new.status:='request_ready';
  end if;
  if new.status is distinct from old.status and not (
    new.status='cancelled'
    or (old.status='not_requested' and new.status='request_ready')
    or (old.status='request_ready' and new.status='sent')
    or (old.status='sent' and new.status in ('waiting_supplier','supplier_replied','option_hold','confirmed','unavailable','alternative_proposed'))
    or (old.status='waiting_supplier' and new.status in ('supplier_replied','option_hold','confirmed','unavailable','alternative_proposed'))
    or (old.status in ('supplier_replied','alternative_proposed') and new.status in ('request_ready','option_hold','confirmed','unavailable'))
    or (old.status='option_hold' and new.status in ('confirmed','unavailable','request_ready'))
    or (old.status='unavailable' and new.status in ('request_ready','alternative_proposed'))
    or (old.status='confirmed' and new.status in ('paid','voucher_received'))
    or (old.status='paid' and new.status='voucher_received')
  ) then raise exception 'invalid supplier workflow transition: % -> %',old.status,new.status; end if;
  if new.status in ('sent','waiting_supplier') and new.supplier_id is null then raise exception 'supplier required before sending'; end if;
  if new.status in ('confirmed','paid','voucher_received') and (new.supplier_id is null or new.confirmed_cost is null or nullif(trim(coalesce(new.confirmation_number,'')),'') is null) then raise exception 'supplier, confirmed cost and confirmation number are required'; end if;
  if new.status='sent' and old.status is distinct from 'sent' then new.request_date=coalesce(new.request_date,statement_timestamp()); new.follow_up_at=coalesce(new.follow_up_at,statement_timestamp()+make_interval(hours=>new.follow_up_hours)); end if;
  new.updated_at=statement_timestamp();
  return new;
end $$;
drop trigger if exists fit_supplier_request_validate on public.fit_supplier_requests;
create trigger fit_supplier_request_validate before update on public.fit_supplier_requests for each row execute function public.fit_supplier_request_before_write_v5();

create or replace function public.fit_supplier_request_created_v5()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  insert into public.fit_supplier_request_events(request_id,event,actor_id,payload)
  values(new.id,'request_created',coalesce(auth.uid(),new.created_by),jsonb_build_object('status',new.status,'source_type',new.source_type,'source_id',new.source_id));
  return new;
end $$;
drop trigger if exists fit_supplier_request_created_audit on public.fit_supplier_requests;
create trigger fit_supplier_request_created_audit after insert on public.fit_supplier_requests for each row execute function public.fit_supplier_request_created_v5();

create or replace function public.fit_supplier_request_after_write_v5()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare task_key text:='fit-supplier-followup:'||new.id::text; hold_key text:='fit-supplier-hold:'||new.id::text; table_name text;
begin
  insert into public.fit_supplier_request_events(request_id,event,actor_id,payload) values(new.id,new.status,auth.uid(),jsonb_build_object('from',old.status,'to',new.status));
  if new.status in ('sent','waiting_supplier') and new.follow_up_at is not null then
    insert into public.operation_tasks(title,description,priority,status,assigned_to,booking_id,category,deadline,created_by,metadata)
    select 'Relancer fournisseur — '||new.service_label,'Aucune réponse fournisseur enregistrée.','high','todo',new.assigned_staff_id,q.converted_booking_id,'supplier_follow_up',new.follow_up_at,auth.uid(),jsonb_build_object('source_key',task_key,'fit_supplier_request_id',new.id,'fit_quote_id',new.quote_id) from public.fit_quotes q where q.id=new.quote_id
    on conflict do nothing;
    update public.operation_tasks set title='Relancer fournisseur — '||new.service_label,assigned_to=new.assigned_staff_id,deadline=new.follow_up_at
    where metadata->>'source_key'=task_key and status not in ('completed','cancelled');
  elsif new.status in ('supplier_replied','option_hold','confirmed','unavailable','alternative_proposed','cancelled','paid','voucher_received') then
    update public.operation_tasks set status='completed',completed_at=statement_timestamp(),completed_by=auth.uid() where metadata->>'source_key'=task_key and status not in ('completed','cancelled');
  end if;
  if new.status='option_hold' and new.hold_release_deadline is not null then
    insert into public.operation_tasks(title,description,priority,status,assigned_to,booking_id,category,deadline,created_by,metadata)
    select 'Option fournisseur à libérer — '||new.service_label,'Confirmer ou libérer l’option avant expiration.','critical','todo',new.assigned_staff_id,q.converted_booking_id,'supplier_hold',greatest(statement_timestamp(),new.hold_release_deadline-interval '24 hours'),auth.uid(),jsonb_build_object('source_key',hold_key,'fit_supplier_request_id',new.id,'fit_quote_id',new.quote_id) from public.fit_quotes q where q.id=new.quote_id
    on conflict do nothing;
    update public.operation_tasks set title='Option fournisseur à libérer — '||new.service_label,assigned_to=new.assigned_staff_id,deadline=greatest(statement_timestamp(),new.hold_release_deadline-interval '24 hours'),priority='critical'
    where metadata->>'source_key'=hold_key and status not in ('completed','cancelled');
  elsif new.status not in ('option_hold') then update public.operation_tasks set status='completed',completed_at=statement_timestamp(),completed_by=auth.uid() where metadata->>'source_key'=hold_key and status not in ('completed','cancelled'); end if;
  table_name:=case new.source_type when 'day_cost' then 'fit_quote_day_cost_lines' when 'cost_line' then 'fit_quote_cost_lines' when 'hotel' then 'fit_quote_hotel_lines' end;
  if table_name is not null then execute format('update public.%I set supplier_id=$1,supplier_quote_id=$2,supplier_quoted_cost=$3,confirmed_cost=$4,final_cost=$5,cost_currency=$6,exchange_rate_to_mad=$7,supplier_payment_status=$8,financial_updated_at=statement_timestamp() where id=$9',table_name) using new.supplier_id,new.supplier_quote_id,new.supplier_quoted_cost,new.confirmed_cost,new.final_cost,new.currency,new.exchange_rate_to_mad,case when new.status in ('paid','voucher_received') then 'paid' when new.status='confirmed' then 'pending' else 'not_due' end,new.source_id; end if;
  return new;
end $$;
drop trigger if exists fit_supplier_request_orchestrate on public.fit_supplier_requests;
create trigger fit_supplier_request_orchestrate after update on public.fit_supplier_requests for each row when(old.* is distinct from new.*) execute function public.fit_supplier_request_after_write_v5();

create or replace function public.supplier_update_fit_request_v5(p_request_id uuid,p_status text,p_response text default null,p_quoted_cost numeric default null,p_confirmed_cost numeric default null,p_confirmation_number text default null,p_hold_deadline timestamptz default null,p_notes text default null,p_alternative jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.fit_supplier_requests%rowtype; actor uuid:=auth.uid(); alt_id uuid;
begin
  select * into r from public.fit_supplier_requests where id=p_request_id and status not in ('not_requested','request_ready','cancelled') and supplier_id in(select public.user_supplier_ids(actor)) for update;
  if not found then raise exception 'not authorized'; end if;
  if p_status not in ('supplier_replied','option_hold','confirmed','unavailable','alternative_proposed') then raise exception 'supplier status not allowed'; end if;
  update public.fit_supplier_requests set status=p_status,supplier_response=nullif(trim(p_response),''),supplier_quoted_cost=coalesce(p_quoted_cost,supplier_quoted_cost),confirmed_cost=case when p_status='confirmed' then p_confirmed_cost else confirmed_cost end,confirmation_number=case when p_status='confirmed' then nullif(trim(p_confirmation_number),'') else confirmation_number end,hold_release_deadline=p_hold_deadline,supplier_notes=nullif(trim(p_notes),'') where id=p_request_id returning * into r;
  if p_status='alternative_proposed' and p_alternative is not null then
    insert into public.fit_supplier_alternatives(request_id,title,description,proposed_cost,currency,price_difference_mad,operational_impact,margin_impact_mad,created_by)
    values(r.id,coalesce(nullif(trim(p_alternative->>'title'),''),'Alternative fournisseur'),p_alternative->>'description',coalesce((p_alternative->>'proposed_cost')::numeric,0),coalesce(p_alternative->>'currency',r.currency),(coalesce((p_alternative->>'proposed_cost')::numeric,0)*r.exchange_rate_to_mad)-coalesce(r.confirmed_cost,r.supplier_quoted_cost,0)*r.exchange_rate_to_mad,p_alternative->>'operational_impact',-((coalesce((p_alternative->>'proposed_cost')::numeric,0)-coalesce(r.confirmed_cost,r.supplier_quoted_cost,0))*r.exchange_rate_to_mad),actor) returning id into alt_id;
  end if;
  return jsonb_build_object('ok',true,'status',r.status,'alternative_id',alt_id);
end $$;
revoke all on function public.supplier_update_fit_request_v5(uuid,text,text,numeric,numeric,text,timestamptz,text,jsonb) from public,anon;
grant execute on function public.supplier_update_fit_request_v5(uuid,text,text,numeric,numeric,text,timestamptz,text,jsonb) to authenticated;

create or replace function public.decide_fit_supplier_alternative_v5(p_alternative_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.fit_supplier_alternatives%rowtype; r public.fit_supplier_requests%rowtype; actor uuid:=auth.uid();
begin
  if p_decision not in ('accepted','rejected','client_revision') then raise exception 'invalid decision'; end if;
  select * into a from public.fit_supplier_alternatives where id=p_alternative_id for update; select * into r from public.fit_supplier_requests where id=a.request_id;
  if actor is null or not public.can_view_fit_internal_costs(actor) or not public.can_access_fit_quote(r.quote_id,actor) then raise exception 'not authorized'; end if;
  update public.fit_supplier_alternatives set decision=p_decision,decided_at=statement_timestamp(),decided_by=actor where id=a.id;
  update public.fit_supplier_requests set status=case when p_decision='accepted' then 'supplier_replied' when p_decision='client_revision' then 'alternative_proposed' else 'unavailable' end,confirmed_cost=case when p_decision='accepted' then a.proposed_cost else confirmed_cost end where id=r.id;
  return jsonb_build_object('ok',true,'decision',p_decision,'quote_id',r.quote_id,'suggest_client_revision',p_decision='client_revision');
end $$;
revoke all on function public.decide_fit_supplier_alternative_v5(uuid,text) from public,anon;
grant execute on function public.decide_fit_supplier_alternative_v5(uuid,text) to authenticated;

-- Reuse the existing private trip-documents bucket with a FIT-specific path:
-- fit/<supplier_id>/<request_id>/<file>.
drop policy if exists "supplier FIT document read" on storage.objects;
create policy "supplier FIT document read" on storage.objects for select using(bucket_id='trip-documents' and case when (storage.foldername(name))[1]='fit' and coalesce((storage.foldername(name))[2],'')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and coalesce((storage.foldername(name))[3],'')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (storage.foldername(name))[2]::uuid in(select public.user_supplier_ids(auth.uid())) and exists(select 1 from public.fit_supplier_requests r where r.id=((storage.foldername(name))[3])::uuid and r.supplier_id=((storage.foldername(name))[2])::uuid) else false end);
drop policy if exists "supplier FIT document upload" on storage.objects;
create policy "supplier FIT document upload" on storage.objects for insert with check(bucket_id='trip-documents' and owner=auth.uid() and case when (storage.foldername(name))[1]='fit' and coalesce((storage.foldername(name))[2],'')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and coalesce((storage.foldername(name))[3],'')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (storage.foldername(name))[2]::uuid in(select public.user_supplier_ids(auth.uid())) and exists(select 1 from public.fit_supplier_requests r where r.id=((storage.foldername(name))[3])::uuid and r.supplier_id=((storage.foldername(name))[2])::uuid) else false end);

notify pgrst,'reload schema';
