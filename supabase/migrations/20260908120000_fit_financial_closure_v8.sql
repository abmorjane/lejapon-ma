-- FIT V8: financial settlement and closure overlay.
-- Reuses payments for client money, international_payment_files for supplier
-- money, V4 components for profitability, and commission snapshots.

alter table public.payments
  add column if not exists due_date date,
  add column if not exists refund_of_payment_id uuid references public.payments(id) on delete restrict;

alter table public.international_payment_files
  alter column trip_id drop not null,
  add column if not exists fit_quote_id uuid references public.fit_quotes(id) on delete restrict,
  add column if not exists fit_source_type text,
  add column if not exists fit_source_id uuid,
  add column if not exists exchange_rate_to_mad numeric not null default 1,
  add column if not exists idempotency_key text;

alter table public.international_payment_files
  drop constraint if exists international_payment_files_fit_source_type_check;
alter table public.international_payment_files
  add constraint international_payment_files_fit_source_type_check
  check(fit_source_type is null or fit_source_type in ('day_cost','cost_line','hotel','flight'));
alter table public.international_payment_files
  drop constraint if exists international_payment_files_fit_source_pair_check;
alter table public.international_payment_files
  add constraint international_payment_files_fit_source_pair_check
  check((fit_source_type is null)=(fit_source_id is null));
alter table public.international_payment_files
  drop constraint if exists international_payment_files_trip_or_fit_check;
alter table public.international_payment_files
  add constraint international_payment_files_trip_or_fit_check
  check(trip_id is not null or fit_quote_id is not null);
alter table public.international_payment_files
  drop constraint if exists international_payment_files_exchange_rate_check;
alter table public.international_payment_files
  add constraint international_payment_files_exchange_rate_check check(exchange_rate_to_mad>0);

create unique index if not exists international_payment_files_fit_source_uidx
  on public.international_payment_files(fit_quote_id,fit_source_type,fit_source_id)
  where fit_quote_id is not null and fit_source_id is not null;
create unique index if not exists international_payment_files_idempotency_uidx
  on public.international_payment_files(idempotency_key) where idempotency_key is not null;
create index if not exists payments_fit_quote_due_idx
  on public.payments(fit_quote_id,due_date,status) where fit_quote_id is not null;

alter table public.fit_quotes
  add column if not exists financial_status text not null default 'financially_open',
  add column if not exists financially_closed_at timestamptz,
  add column if not exists financially_closed_by uuid references auth.users(id) on delete set null;
alter table public.fit_quotes drop constraint if exists fit_quotes_financial_status_check;
alter table public.fit_quotes add constraint fit_quotes_financial_status_check
  check(financial_status in ('financially_open','ready_for_closure','closed'));

alter table public.bookings
  add column if not exists financial_status text not null default 'financially_open',
  add column if not exists financially_closed_at timestamptz,
  add column if not exists financially_closed_by uuid references auth.users(id) on delete set null;
alter table public.bookings drop constraint if exists bookings_financial_status_check;
alter table public.bookings add constraint bookings_financial_status_check
  check(financial_status in ('financially_open','ready_for_closure','closed'));

create or replace function public.reset_copied_fit_financial_state_v8()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.duplicated_from_id is not null or new.previous_version_id is not null then
    new.financial_status:='financially_open';
    new.financially_closed_at:=null;
    new.financially_closed_by:=null;
  end if;
  return new;
end $$;
drop trigger if exists fit_quotes_reset_copied_financial_state on public.fit_quotes;
create trigger fit_quotes_reset_copied_financial_state before insert on public.fit_quotes
for each row execute function public.reset_copied_fit_financial_state_v8();

create or replace function public.record_fit_client_transaction_v8(
  p_quote_id uuid,
  p_amount_mad numeric,
  p_kind text,
  p_method text default null,
  p_reference text default null,
  p_due_date date default null,
  p_idempotency_key text default null,
  p_notes text default null
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare q public.fit_quotes%rowtype; actor uuid:=auth.uid(); payment_row public.payments%rowtype; key_value text; net_paid numeric;
begin
  if actor is null or not public.can_view_fit_internal_costs(actor) or not public.can_access_fit_quote(p_quote_id,actor) then raise exception 'not authorized'; end if;
  if p_kind not in ('payment','refund','schedule') then raise exception 'invalid transaction kind'; end if;
  if coalesce(p_amount_mad,0)<=0 then raise exception 'amount must be positive'; end if;
  select * into q from public.fit_quotes where id=p_quote_id for update;
  if not found then raise exception 'FIT quote not found'; end if;
  if q.financial_status='closed' then raise exception 'FIT finance is closed'; end if;
  key_value:=coalesce(nullif(trim(p_idempotency_key),''),'fit-client:'||p_quote_id::text||':'||p_kind||':'||encode(digest(coalesce(trim(p_reference),'')||'|'||p_amount_mad::text||'|'||coalesce(p_due_date::text,''),'sha256'),'hex'));
  insert into public.payments(
    booking_id,client_id,fit_quote_id,amount_mad,method,status,reference,paid_at,notes,
    recorded_by,payment_purpose,idempotency_key,due_date
  ) values(
    q.converted_booking_id,q.client_id,q.id,p_amount_mad,nullif(trim(p_method),''),
    case p_kind when 'refund' then 'refunded'::public.payment_status when 'schedule' then 'pending'::public.payment_status else 'received'::public.payment_status end,
    nullif(trim(p_reference),''),case when p_kind in ('payment','refund') then statement_timestamp() end,
    nullif(trim(p_notes),''),actor,case p_kind when 'refund' then 'fit_refund' when 'schedule' then 'fit_schedule' else 'fit_payment' end,key_value,p_due_date
  ) on conflict(idempotency_key) where idempotency_key is not null do update set id=public.payments.id
  returning * into payment_row;
  select coalesce(sum(case when status='received' then amount_mad when status='refunded' then -amount_mad else 0 end),0)
  into net_paid from public.payments where fit_quote_id=q.id or (q.converted_booking_id is not null and booking_id=q.converted_booking_id);
  if q.converted_booking_id is not null then
    update public.bookings set paid_amount_mad=greatest(0,net_paid),updated_at=statement_timestamp() where id=q.converted_booking_id;
  end if;
  if not exists(select 1 from public.quote_audit_logs where quote_id=q.id and action_type='fit_client_'||p_kind and payload->>'payment_id'=payment_row.id::text) then
    insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
    values(q.id,q.partner_organization_id,actor,'fit_client_'||p_kind,jsonb_build_object('payment_id',payment_row.id,'amount_mad',payment_row.amount_mad,'due_date',payment_row.due_date));
  end if;
  return jsonb_build_object('ok',true,'payment_id',payment_row.id,'status',payment_row.status,'net_paid_mad',net_paid);
end $$;

create or replace function public.confirm_fit_client_payment_v8(
  p_payment_id uuid,
  p_method text default null,
  p_reference text default null
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare payment_row public.payments%rowtype; q public.fit_quotes%rowtype; actor uuid:=auth.uid(); net_paid numeric;
begin
  select * into payment_row from public.payments where id=p_payment_id for update;
  if not found or payment_row.fit_quote_id is null then raise exception 'FIT payment not found'; end if;
  select * into q from public.fit_quotes where id=payment_row.fit_quote_id;
  if actor is null or not public.can_view_fit_internal_costs(actor) or not public.can_access_fit_quote(q.id,actor) then raise exception 'not authorized'; end if;
  if q.financial_status='closed' then raise exception 'FIT finance is closed'; end if;
  if payment_row.status='received' then return jsonb_build_object('ok',true,'payment_id',payment_row.id,'already_received',true); end if;
  if payment_row.status<>'pending' then raise exception 'payment cannot be confirmed'; end if;
  update public.payments set status='received',paid_at=statement_timestamp(),method=coalesce(nullif(trim(p_method),''),method),reference=coalesce(nullif(trim(p_reference),''),reference),recorded_by=actor where id=payment_row.id returning * into payment_row;
  select coalesce(sum(case when status='received' then amount_mad when status='refunded' then -amount_mad else 0 end),0)
  into net_paid from public.payments where fit_quote_id=q.id or (q.converted_booking_id is not null and booking_id=q.converted_booking_id);
  if q.converted_booking_id is not null then update public.bookings set paid_amount_mad=greatest(0,net_paid),updated_at=statement_timestamp() where id=q.converted_booking_id; end if;
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
  values(q.id,q.partner_organization_id,actor,'fit_client_scheduled_payment_received',jsonb_build_object('payment_id',payment_row.id,'amount_mad',payment_row.amount_mad));
  return jsonb_build_object('ok',true,'payment_id',payment_row.id,'already_received',false,'net_paid_mad',net_paid);
end $$;

create or replace function public.upsert_fit_supplier_settlement_v8(
  p_quote_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_total_amount numeric,
  p_deposit_percent numeric default 0,
  p_amount_paid numeric default 0,
  p_due_date date default null,
  p_invoice_number text default null,
  p_payment_reference text default null,
  p_exchange_rate_to_mad numeric default 1
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare q public.fit_quotes%rowtype; actor uuid:=auth.uid(); component record; file_row public.international_payment_files%rowtype; table_name text; trip_value uuid; status_value text;
begin
  if actor is null or not public.can_view_fit_internal_costs(actor) or not public.can_access_fit_quote(p_quote_id,actor) then raise exception 'not authorized'; end if;
  if p_source_type not in ('day_cost','cost_line','hotel','flight') then raise exception 'invalid FIT source'; end if;
  if coalesce(p_total_amount,0)<0 or coalesce(p_amount_paid,0)<0 or coalesce(p_deposit_percent,0) not between 0 and 100 or coalesce(p_exchange_rate_to_mad,0)<=0 then raise exception 'invalid supplier settlement amounts'; end if;
  select * into q from public.fit_quotes where id=p_quote_id for update;
  if q.financial_status='closed' then raise exception 'FIT finance is closed'; end if;
  select * into component from public._fit_financial_components_v4(p_quote_id)x where x.source_type=p_source_type and x.source_id=p_source_id;
  if not found then raise exception 'FIT component not found'; end if;
  select b.trip_id into trip_value from public.bookings b where b.id=q.converted_booking_id;
  status_value:=case when coalesce(p_total_amount,0)>0 and coalesce(p_amount_paid,0)>=p_total_amount then 'paid' when coalesce(p_amount_paid,0)>0 then 'partially_paid' else 'waiting_payment' end;
  insert into public.international_payment_files(
    trip_id,fit_quote_id,fit_source_type,fit_source_id,supplier_name,payment_reference,invoice_number,due_date,currency,
    total_invoice_amount,payment_percentage,amount_already_paid,status,exchange_rate_to_mad,idempotency_key,metadata,created_by
  ) values(
    trip_value,q.id,p_source_type,p_source_id,coalesce((select name from public.suppliers where id=component.supplier_id),component.label,'Fournisseur FIT'),
    nullif(trim(p_payment_reference),''),nullif(trim(p_invoice_number),''),p_due_date,component.currency,
    p_total_amount,p_deposit_percent,p_amount_paid,status_value,p_exchange_rate_to_mad,
    'fit-supplier:'||q.id::text||':'||p_source_type||':'||p_source_id::text,
    jsonb_build_object('fit_quote_id',q.id,'fit_source_type',p_source_type,'fit_source_id',p_source_id),actor
  ) on conflict(fit_quote_id,fit_source_type,fit_source_id) where fit_quote_id is not null and fit_source_id is not null
  do update set trip_id=coalesce(excluded.trip_id,public.international_payment_files.trip_id),supplier_name=excluded.supplier_name,
    payment_reference=excluded.payment_reference,invoice_number=excluded.invoice_number,due_date=excluded.due_date,currency=excluded.currency,
    total_invoice_amount=excluded.total_invoice_amount,payment_percentage=excluded.payment_percentage,
    amount_already_paid=excluded.amount_already_paid,status=excluded.status,exchange_rate_to_mad=excluded.exchange_rate_to_mad,
    metadata=public.international_payment_files.metadata||excluded.metadata,updated_at=statement_timestamp()
  returning * into file_row;
  table_name:=case p_source_type when 'day_cost' then 'fit_quote_day_cost_lines' when 'cost_line' then 'fit_quote_cost_lines' when 'hotel' then 'fit_quote_hotel_lines' when 'flight' then 'fit_quote_flight_lines' end;
  execute format('update public.%I set supplier_payment_status=$1,supplier_invoice_id=case when $2 then $3 else supplier_invoice_id end,supplier_payment_id=case when $4 then $3 else supplier_payment_id end,financial_updated_at=statement_timestamp() where id=$5 and quote_id=$6',table_name)
    using case when status_value='paid' then 'paid' when status_value='partially_paid' then 'partially_paid' else 'pending' end,
      nullif(trim(p_invoice_number),'') is not null,file_row.id,p_amount_paid>0,p_source_id,p_quote_id;
  insert into public.international_payment_history(payment_file_id,action,actor_id,new_value)
  values(file_row.id,'fit_supplier_settlement_saved',actor,jsonb_build_object('amount_paid',p_amount_paid,'total',p_total_amount,'status',status_value));
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
  values(q.id,q.partner_organization_id,actor,'fit_supplier_settlement_saved',jsonb_build_object('payment_file_id',file_row.id,'source_type',p_source_type,'source_id',p_source_id,'amount_paid',p_amount_paid,'total',p_total_amount));
  return jsonb_build_object('ok',true,'payment_file_id',file_row.id,'status',file_row.status,'remaining_balance',file_row.remaining_balance);
end $$;

create or replace function public.get_fit_financial_closure_v8(p_quote_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare q public.fit_quotes%rowtype; finance jsonb; client_rows jsonb; supplier_rows jsonb; client_received numeric; deposit_received numeric; refunds numeric; supplier_paid numeric; supplier_payable numeric; incomplete_suppliers integer; commission_ready boolean; client_balance numeric; ready boolean; alerts jsonb;
begin
  if auth.uid() is null or not public.can_view_fit_internal_costs(auth.uid()) or not public.can_access_fit_quote(p_quote_id,auth.uid()) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id;
  finance:=public.get_fit_financial_summary_v4(p_quote_id);
  select coalesce(sum(case when p.status='received' then p.amount_mad else 0 end),0),
    coalesce(sum(case when p.status='received' and p.payment_purpose='fit_deposit' then p.amount_mad else 0 end),0),
    coalesce(sum(case when p.status='refunded' then p.amount_mad else 0 end),0),
    coalesce(jsonb_agg(jsonb_build_object('id',p.id,'amount_mad',p.amount_mad,'status',p.status,'purpose',p.payment_purpose,'method',p.method,'reference',p.reference,'due_date',p.due_date,'paid_at',p.paid_at,'notes',p.notes) order by coalesce(p.paid_at,p.created_at) desc),'[]'::jsonb)
  into client_received,deposit_received,refunds,client_rows from public.payments p
  where p.fit_quote_id=q.id or (q.converted_booking_id is not null and p.booking_id=q.converted_booking_id);
  client_balance:=greatest(0,coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-client_received+refunds);

  with component_settlements as (
    select x.*,s.name supplier_name,f.id payment_file_id,f.payment_percentage,f.amount_to_pay_now,f.amount_already_paid,
      f.remaining_balance,f.due_date,f.invoice_number,f.payment_reference,f.status settlement_status,
      f.exchange_rate_to_mad settlement_exchange_rate,
      exists(select 1 from public.international_payment_file_documents d where d.payment_file_id=f.id and d.document_type='invoice') has_invoice_document,
      exists(select 1 from public.international_payment_file_documents d where d.payment_file_id=f.id and d.document_type='payment_proof') has_payment_proof
    from public._fit_financial_components_v4(p_quote_id)x
    left join public.suppliers s on s.id=x.supplier_id
    left join public.international_payment_files f on f.fit_quote_id=p_quote_id and f.fit_source_type=x.source_type and f.fit_source_id=x.source_id
    where coalesce(x.final_cost,x.confirmed_cost,x.supplier_quoted_cost,0)>0
  )
  select
    coalesce(sum(case when payment_file_id is not null then amount_already_paid*coalesce(settlement_exchange_rate,exchange_rate) else case when payment_status='paid' then coalesce(final_cost,confirmed_cost,supplier_quoted_cost,0)*exchange_rate else 0 end end),0),
    coalesce(sum(greatest(0,(case when payment_file_id is not null then remaining_balance*coalesce(settlement_exchange_rate,exchange_rate) else coalesce(final_cost,confirmed_cost,supplier_quoted_cost,0)*exchange_rate end))),0),
    count(*) filter(where not (
      (coalesce(settlement_status,'')='paid' or payment_status='paid')
      and (nullif(invoice_number,'') is not null or has_invoice_document or supplier_invoice_id is not null)
      and has_payment_proof
    )),
    coalesce(jsonb_agg(jsonb_build_object(
      'source_type',source_type,'source_id',source_id,'component_type',component_type,'label',label,'supplier_id',supplier_id,'supplier_name',supplier_name,
      'confirmed_amount',coalesce(final_cost,confirmed_cost,supplier_quoted_cost,0),'currency',currency,'exchange_rate',exchange_rate,
      'confirmed_mad',coalesce(final_cost,confirmed_cost,supplier_quoted_cost,0)*exchange_rate,
      'deposit_required',coalesce(amount_to_pay_now,0),'deposit_paid',least(coalesce(amount_already_paid,0),coalesce(amount_to_pay_now,0)),
      'amount_paid',coalesce(amount_already_paid,case when payment_status='paid' then coalesce(final_cost,confirmed_cost,supplier_quoted_cost,0) else 0 end),
      'balance',coalesce(remaining_balance,case when payment_status='paid' then 0 else coalesce(final_cost,confirmed_cost,supplier_quoted_cost,0) end),
      'payment_deadline',due_date,'invoice_number',invoice_number,'payment_reference',payment_reference,'settlement_status',coalesce(settlement_status,payment_status),
      'settlement_exchange_rate',coalesce(settlement_exchange_rate,exchange_rate),'deposit_percent',coalesce(payment_percentage,0),
      'invoice_received',(nullif(invoice_number,'') is not null or has_invoice_document or supplier_invoice_id is not null),
      'payment_proof_received',has_payment_proof,'payment_file_id',payment_file_id
    ) order by coalesce(due_date,'infinity'::date),component_type,label),'[]'::jsonb)
  into supplier_paid,supplier_payable,incomplete_suppliers,supplier_rows from component_settlements;

  commission_ready:=q.partner_organization_id is null or exists(
    select 1 from public.agency_commission_snapshots c where c.fit_quote_id=q.id and c.is_current=true and c.sales_agent_commission_status in ('confirmed','acquired','paid')
  );
  ready:=q.converted_booking_id is not null and client_balance<=0.01 and incomplete_suppliers=0 and commission_ready;
  alerts:=jsonb_strip_nulls(jsonb_build_object(
    'client_balance_due',case when client_balance>0.01 then client_balance end,
    'client_payment_overdue',case when exists(select 1 from public.payments p where (p.fit_quote_id=q.id or p.booking_id=q.converted_booking_id) and p.status='pending' and p.due_date<current_date) then true end,
    'supplier_payment_due',case when exists(select 1 from public.international_payment_files f where f.fit_quote_id=q.id and f.status not in ('paid','cancelled') and f.due_date<=current_date+7) then true end,
    'cancellation_deadline',case when exists(select 1 from public.fit_supplier_requests r where r.quote_id=q.id and r.status not in ('cancelled','paid','voucher_received') and r.cancellation_deadline<=statement_timestamp()+interval '7 days') then true end,
    'missing_invoice',case when exists(select 1 from jsonb_array_elements(supplier_rows) r where not coalesce((r->>'invoice_received')::boolean,false)) then true end,
    'unpaid_supplier',case when supplier_payable>0.01 then true end,
    'commission_not_finalized',case when not commission_ready then true end
  ));
  return jsonb_build_object(
    'quote_id',q.id,'booking_id',q.converted_booking_id,
    'financial_status',case when q.financial_status='closed' then 'closed' when ready then 'ready_for_closure' else 'financially_open' end,
    'can_close',ready,'closed_at',q.financially_closed_at,
    'client',jsonb_build_object('selling_price_mad',coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0),'deposit_required_mad',coalesce(q.public_deposit_mad,0),'deposit_received_mad',deposit_received,'additional_payments_mad',greatest(0,client_received-deposit_received),'received_mad',client_received,'refunds_mad',refunds,'balance_mad',client_balance,'payments',client_rows),
    'suppliers',jsonb_build_object('confirmed_mad',coalesce((finance->>'confirmed_supplier_cost_mad')::numeric,0),'paid_mad',supplier_paid,'payable_mad',supplier_payable,'incomplete_count',incomplete_suppliers,'items',supplier_rows),
    'cash_exposure_mad',client_received-refunds-supplier_paid,
    'expected_margin_mad',coalesce((finance->>'expected_profit_mad')::numeric,0),
    'confirmed_margin_mad',coalesce((finance->>'confirmed_profit_mad')::numeric,0),
    'final_margin_mad',coalesce((finance->>'final_profit_mad')::numeric,0),
    'commissions_finalized',commission_ready,'alerts',alerts
  );
end $$;

create or replace function public.close_fit_finance_v8(p_quote_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare q public.fit_quotes%rowtype; actor uuid:=auth.uid(); closure jsonb; closed_time timestamptz:=statement_timestamp();
begin
  if actor is null or not public.can_view_fit_internal_costs(actor) or not public.can_access_fit_quote(p_quote_id,actor) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id for update;
  if q.financial_status='closed' then return jsonb_build_object('ok',true,'status','closed','already_closed',true,'closed_at',q.financially_closed_at); end if;
  closure:=public.get_fit_financial_closure_v8(p_quote_id);
  if not coalesce((closure->>'can_close')::boolean,false) then raise exception 'financial closure requirements are not complete'; end if;
  update public.fit_quotes set financial_status='closed',financially_closed_at=closed_time,financially_closed_by=actor,updated_at=closed_time where id=q.id;
  update public.bookings set financial_status='closed',financially_closed_at=closed_time,financially_closed_by=actor,updated_at=closed_time where id=q.converted_booking_id;
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
  values(q.id,q.partner_organization_id,actor,'financially_closed',jsonb_build_object('booking_id',q.converted_booking_id,'closure_snapshot',closure));
  return jsonb_build_object('ok',true,'status','closed','already_closed',false,'closed_at',closed_time);
end $$;

revoke all on function public.record_fit_client_transaction_v8(uuid,numeric,text,text,text,date,text,text) from public,anon;
revoke all on function public.confirm_fit_client_payment_v8(uuid,text,text) from public,anon;
revoke all on function public.upsert_fit_supplier_settlement_v8(uuid,text,uuid,numeric,numeric,numeric,date,text,text,numeric) from public,anon;
revoke all on function public.get_fit_financial_closure_v8(uuid) from public,anon;
revoke all on function public.close_fit_finance_v8(uuid) from public,anon;
grant execute on function public.record_fit_client_transaction_v8(uuid,numeric,text,text,text,date,text,text) to authenticated;
grant execute on function public.confirm_fit_client_payment_v8(uuid,text,text) to authenticated;
grant execute on function public.upsert_fit_supplier_settlement_v8(uuid,text,uuid,numeric,numeric,numeric,date,text,text,numeric) to authenticated;
grant execute on function public.get_fit_financial_closure_v8(uuid) to authenticated;
grant execute on function public.close_fit_finance_v8(uuid) to authenticated;

notify pgrst,'reload schema';
