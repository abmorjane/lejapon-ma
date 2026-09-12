-- FIT financial reconciliation V10.
-- Corrects calculation semantics without rewriting or deleting historical rows.
-- The existing V4 RPC name is preserved for backwards compatibility.

create or replace function public._fit_financial_components_v4(p_quote_id uuid)
returns table(source_type text,source_id uuid,component_type text,label text,supplier_id uuid,estimated_cost numeric,supplier_quoted_cost numeric,confirmed_cost numeric,final_cost numeric,selling_price numeric,currency text,exchange_rate numeric,payment_status text,supplier_quote_id uuid,supplier_confirmation_document_id uuid,supplier_invoice_id uuid,supplier_payment_id uuid)
language sql stable security definer set search_path=pg_catalog,public as $$
  select 'day_cost',l.id,
    case when l.category='visit' then 'tickets' when l.category='meal' then 'restaurants' else l.category end,
    l.label,l.supplier_id,l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,
    l.component_selling_price,l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,
    l.supplier_quote_id,l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id
  from public.fit_quote_day_cost_lines l
  where l.quote_id=p_quote_id
    and coalesce(l.included_in_calculation,true)=true
    and coalesce(l.cost_role,'supplier_cost')='supplier_cost'
    and l.category<>'agency_fee'
    and (greatest(coalesce(l.estimated_cost,0),coalesce(l.supplier_quoted_cost,0),coalesce(l.confirmed_cost,0),coalesce(l.final_cost,0),coalesce(l.component_selling_price,0))>0 or l.supplier_id is not null)
  union all
  select 'cost_line',l.id,
    case when l.category='visit' then 'tickets' when l.category='meal' then 'restaurants' else l.category end,
    l.label,l.supplier_id,l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,
    l.component_selling_price,l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,
    l.supplier_quote_id,l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id
  from public.fit_quote_cost_lines l
  where l.quote_id=p_quote_id
    and coalesce(l.included_in_calculation,true)=true
    and coalesce(l.cost_role,'supplier_cost')='supplier_cost'
    and l.category not in ('agency_fee','adjustment','discount')
    and (greatest(coalesce(l.estimated_cost,0),coalesce(l.supplier_quoted_cost,0),coalesce(l.confirmed_cost,0),coalesce(l.final_cost,0),coalesce(l.component_selling_price,0))>0 or l.supplier_id is not null)
  union all
  select 'hotel',l.id,'hotels',coalesce(l.hotel_name,l.city,'Hôtel'),l.supplier_id,
    l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,l.component_selling_price,
    l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,l.supplier_quote_id,
    l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id
  from public.fit_quote_hotel_lines l
  where l.quote_id=p_quote_id
    and coalesce(l.metadata->>'financially_excluded','false')<>'true'
    and (greatest(coalesce(l.estimated_cost,0),coalesce(l.supplier_quoted_cost,0),coalesce(l.confirmed_cost,0),coalesce(l.final_cost,0),coalesce(l.component_selling_price,0))>0 or l.supplier_id is not null)
  union all
  select 'flight',l.id,'flights',coalesce(l.route,l.airline,'Vol'),l.supplier_id,
    l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,l.component_selling_price,
    l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,l.supplier_quote_id,
    l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id
  from public.fit_quote_flight_lines l
  where l.quote_id=p_quote_id
    and coalesce(l.status,'included')='included'
    and coalesce(l.metadata->>'financially_excluded','false')<>'true'
    and (greatest(coalesce(l.estimated_cost,0),coalesce(l.supplier_quoted_cost,0),coalesce(l.confirmed_cost,0),coalesce(l.final_cost,0),coalesce(l.component_selling_price,0))>0 or l.supplier_id is not null)
$$;
revoke all on function public._fit_financial_components_v4(uuid) from public,anon,authenticated;

create or replace function public.get_fit_financial_summary_v4(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  q public.fit_quotes%rowtype;
  cfg public.fit_financial_settings%rowtype;
  components_json jsonb;
  result jsonb;
  alerts jsonb;
  reconciliation jsonb;
  excluded_lines jsonb:='[]'::jsonb;
  selling numeric:=0; estimated numeric:=0; quoted numeric:=0; confirmed numeric:=0; final_value numeric:=0; paid numeric:=0;
  agency_commission numeric:=0; agent_commission numeric:=0; agency_net numeric:=0;
  eligible_count integer:=0; quoted_count integer:=0; confirmed_count integer:=0; final_count integer:=0;
  previous_v4_estimated numeric:=0; excluded_day numeric:=0; excluded_global numeric:=0; excluded_hotels numeric:=0; excluded_flights numeric:=0;
  fx_risk boolean:=false;
begin
  if auth.uid() is null or not public.can_view_fit_internal_costs(auth.uid()) or not public.can_access_fit_quote(p_quote_id,auth.uid()) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id and deleted_at is null;
  if not found then raise exception 'FIT quote not found'; end if;
  select * into cfg from public.fit_financial_settings where id=true;
  selling:=coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0);

  with enriched as (
    select x.*,
      s.name supplier_name,
      case
        when x.source_type='day_cost' then d.day_number
        when x.source_type='cost_line' then gd.day_number
      end day_number,
      case
        when x.source_type='day_cost' then d.date
        when x.source_type='cost_line' then gd.date
      end day_date,
      case
        when x.source_type='day_cost' then d.city
        when x.source_type='cost_line' then gd.city
        when x.source_type='hotel' then h.city
      end city,
      pay.amount_already_paid,
      pay.payment_exchange_rate,
      coalesce(pay.amount_already_paid,0)*coalesce(pay.payment_exchange_rate,x.exchange_rate) paid_mad
    from public._fit_financial_components_v4(p_quote_id) x
    left join public.suppliers s on s.id=x.supplier_id
    left join public.fit_quote_day_cost_lines dl on x.source_type='day_cost' and dl.id=x.source_id
    left join public.fit_quote_cost_lines gl on x.source_type='cost_line' and gl.id=x.source_id
    left join public.fit_quote_days d on d.id=dl.day_id
    left join public.fit_quote_days gd on gd.id=gl.day_id
    left join public.fit_quote_hotel_lines h on x.source_type='hotel' and h.id=x.source_id
    left join lateral (
      select f.amount_already_paid,coalesce(f.exchange_rate_to_mad,x.exchange_rate) payment_exchange_rate
      from public.international_payment_files f
      where (f.fit_quote_id=p_quote_id and f.fit_source_type=x.source_type and f.fit_source_id=x.source_id)
         or f.id=x.supplier_payment_id
      order by case when f.fit_quote_id=p_quote_id and f.fit_source_id=x.source_id then 0 else 1 end,f.updated_at desc
      limit 1
    ) pay on true
  ), totals as (
    select
      coalesce(sum(estimated_cost*exchange_rate),0) estimated,
      coalesce(sum(supplier_quoted_cost*exchange_rate) filter(where supplier_quoted_cost is not null),0) quoted,
      coalesce(sum(confirmed_cost*exchange_rate) filter(where confirmed_cost is not null),0) confirmed,
      coalesce(sum(final_cost*exchange_rate) filter(where final_cost is not null),0) final_value,
      coalesce(sum(paid_mad),0) paid,
      count(*) filter(where greatest(coalesce(estimated_cost,0),coalesce(supplier_quoted_cost,0),coalesce(confirmed_cost,0),coalesce(final_cost,0))>0) eligible_count,
      count(*) filter(where supplier_quoted_cost is not null) quoted_count,
      count(*) filter(where confirmed_cost is not null) confirmed_count,
      count(*) filter(where final_cost is not null) final_count
    from enriched
  )
  select t.estimated,t.quoted,t.confirmed,t.final_value,t.paid,t.eligible_count,t.quoted_count,t.confirmed_count,t.final_count,
    coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object(
      'estimated_mad',e.estimated_cost*e.exchange_rate,
      'quoted_mad',case when e.supplier_quoted_cost is not null then e.supplier_quoted_cost*e.exchange_rate end,
      'confirmed_mad',case when e.confirmed_cost is not null then e.confirmed_cost*e.exchange_rate end,
      'final_mad',case when e.final_cost is not null then e.final_cost*e.exchange_rate end,
      'paid_mad',e.paid_mad,
      'latest_cost_mad',coalesce(e.final_cost,e.confirmed_cost,e.supplier_quoted_cost,e.estimated_cost)*e.exchange_rate,
      'variance_mad',(coalesce(e.final_cost,e.confirmed_cost,e.supplier_quoted_cost,e.estimated_cost)-e.estimated_cost)*e.exchange_rate
    ) order by e.component_type,e.day_number nulls last,e.label) filter(where e.source_id is not null),'[]'::jsonb)
  into estimated,quoted,confirmed,final_value,paid,eligible_count,quoted_count,confirmed_count,final_count,components_json
  from totals t left join enriched e on true
  group by t.estimated,t.quoted,t.confirmed,t.final_value,t.paid,t.eligible_count,t.quoted_count,t.confirmed_count,t.final_count;

  select coalesce(c.gross_agency_commission_amount_mad,0),coalesce(c.sales_agent_commission_amount_mad,0),coalesce(c.agency_net_commission_amount_mad,0)
  into agency_commission,agent_commission,agency_net
  from public.agency_commission_snapshots c where c.fit_quote_id=p_quote_id and c.is_current=true order by c.created_at desc limit 1;
  agency_commission:=coalesce(agency_commission,0); agent_commission:=coalesce(agent_commission,0); agency_net:=coalesce(agency_net,0);

  select
    coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_day_cost_lines l where l.quote_id=p_quote_id),0)
    +coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_cost_lines l where l.quote_id=p_quote_id),0)
    +coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_hotel_lines l where l.quote_id=p_quote_id),0)
    +coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_flight_lines l where l.quote_id=p_quote_id),0),
    coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_day_cost_lines l where l.quote_id=p_quote_id and (coalesce(l.included_in_calculation,true)=false or coalesce(l.cost_role,'supplier_cost')<>'supplier_cost' or l.category='agency_fee')),0),
    coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_cost_lines l where l.quote_id=p_quote_id and (coalesce(l.included_in_calculation,true)=false or coalesce(l.cost_role,'supplier_cost')<>'supplier_cost' or l.category in ('agency_fee','adjustment','discount'))),0),
    coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_hotel_lines l where l.quote_id=p_quote_id and coalesce(l.metadata->>'financially_excluded','false')='true'),0),
    coalesce((select sum(l.estimated_cost*l.exchange_rate_to_mad) from public.fit_quote_flight_lines l where l.quote_id=p_quote_id and (coalesce(l.status,'included')<>'included' or coalesce(l.metadata->>'financially_excluded','false')='true')),0)
  into previous_v4_estimated,excluded_day,excluded_global,excluded_hotels,excluded_flights;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_type',excluded.source_type,
    'source_id',excluded.source_id,
    'label',excluded.label,
    'category',excluded.category,
    'reason',excluded.reason,
    'estimated_mad',excluded.estimated_mad
  ) order by excluded.source_type,excluded.label),'[]'::jsonb)
  into excluded_lines
  from (
    select 'day_cost'::text source_type,l.id source_id,l.label,l.category,
      case when coalesce(l.included_in_calculation,true)=false then 'not_included'
        when coalesce(l.cost_role,'supplier_cost')<>'supplier_cost' then 'not_supplier_cost'
        else 'agency_fee' end reason,
      l.estimated_cost*l.exchange_rate_to_mad estimated_mad
    from public.fit_quote_day_cost_lines l
    where l.quote_id=p_quote_id and (coalesce(l.included_in_calculation,true)=false or coalesce(l.cost_role,'supplier_cost')<>'supplier_cost' or l.category='agency_fee')
    union all
    select 'cost_line',l.id,l.label,l.category,
      case when coalesce(l.included_in_calculation,true)=false then 'not_included'
        when coalesce(l.cost_role,'supplier_cost')<>'supplier_cost' then 'not_supplier_cost'
        else 'commercial_adjustment' end,
      l.estimated_cost*l.exchange_rate_to_mad
    from public.fit_quote_cost_lines l
    where l.quote_id=p_quote_id and (coalesce(l.included_in_calculation,true)=false or coalesce(l.cost_role,'supplier_cost')<>'supplier_cost' or l.category in ('agency_fee','adjustment','discount'))
    union all
    select 'hotel',l.id,coalesce(l.hotel_name,l.city,'Hôtel'),'hotels','financially_excluded',l.estimated_cost*l.exchange_rate_to_mad
    from public.fit_quote_hotel_lines l
    where l.quote_id=p_quote_id and coalesce(l.metadata->>'financially_excluded','false')='true'
    union all
    select 'flight',l.id,coalesce(l.route,l.airline,'Vol'),'flights',
      case when coalesce(l.status,'included')<>'included' then 'not_included' else 'financially_excluded' end,
      l.estimated_cost*l.exchange_rate_to_mad
    from public.fit_quote_flight_lines l
    where l.quote_id=p_quote_id and (coalesce(l.status,'included')<>'included' or coalesce(l.metadata->>'financially_excluded','false')='true')
  ) excluded;

  if q.accepted_snapshot_id is not null then
    select exists(select 1 from public._fit_financial_components_v4(p_quote_id)x
      join public.fit_financial_snapshots fs on fs.acceptance_id=q.accepted_snapshot_id
      cross join lateral jsonb_array_elements(fs.components) old
      where old->>'source_id'=x.source_id::text and coalesce((old->>'exchange_rate')::numeric,1)>0
        and abs((x.exchange_rate/coalesce((old->>'exchange_rate')::numeric,1))-1)*100>=coalesce(cfg.significant_fx_erosion_percent,5)) into fx_risk;
  end if;

  reconciliation:=jsonb_build_object(
    'stored_ground_cost_mad',coalesce(q.ground_cost_total_mad,q.total_cost_mad,0),
    'previous_v4_estimated_mad',previous_v4_estimated,
    'corrected_estimated_mad',estimated,
    'previous_v4_difference_mad',previous_v4_estimated-estimated,
    'stored_ground_difference_mad',previous_v4_estimated-coalesce(q.ground_cost_total_mad,q.total_cost_mad,0),
    'corrected_ground_difference_mad',estimated-coalesce(q.ground_cost_total_mad,q.total_cost_mad,0),
    'excluded_from_financial_total_mad',excluded_day+excluded_global+excluded_hotels+excluded_flights,
    'excluded_breakdown',jsonb_build_object('day_lines',excluded_day,'global_lines',excluded_global,'hotel_lines',excluded_hotels,'flight_lines',excluded_flights),
    'excluded_lines',excluded_lines
  );

  alerts:=jsonb_strip_nulls(jsonb_build_object(
    'negative_estimated_margin',case when selling-estimated-agency_commission<0 then true end,
    'negative_confirmed_margin',case when confirmed_count>0 and selling-confirmed-agency_commission<0 then true end,
    'negative_final_margin',case when final_count>0 and selling-final_value-agency_commission<0 then true end,
    'below_estimated_threshold',case when selling>0 and 100*(selling-estimated-agency_commission)/selling<coalesce(cfg.minimum_margin_percent,12) then true end,
    'cost_increase_after_acceptance',case when q.accepted_snapshot_id is not null and exists(select 1 from public._fit_financial_components_v4(p_quote_id)x where x.confirmed_cost is not null and x.confirmed_cost>x.estimated_cost) then true end,
    'exchange_rate_erosion',case when fx_risk then true end
  ));

  result:=jsonb_build_object(
    'quote_id',q.id,'selling_price_mad',selling,
    'estimated_supplier_cost_mad',estimated,'quoted_supplier_cost_mad',quoted,
    'confirmed_supplier_cost_mad',confirmed,'final_supplier_cost_mad',final_value,'supplier_paid_cost_mad',paid,
    'estimated_margin_mad',selling-estimated-agency_commission,
    'confirmed_margin_mad',selling-confirmed-agency_commission,
    'final_margin_mad',selling-final_value-agency_commission,
    'gross_margin_mad',selling-estimated,'gross_margin_percent',case when selling>0 then round(100*(selling-estimated)/selling,2) else 0 end,
    'agency_gross_commission_mad',agency_commission,'sales_agent_commission_mad',agent_commission,'agency_net_commission_mad',agency_net,
    'lejapon_gross_margin_mad',selling-estimated-agency_commission,
    'expected_profit_mad',selling-estimated-agency_commission,
    'confirmed_profit_mad',selling-confirmed-agency_commission,
    'final_profit_mad',selling-final_value-agency_commission,
    'eligible_line_count',eligible_count,'quoted_line_count',quoted_count,'confirmed_line_count',confirmed_count,'final_line_count',final_count,
    'confirmed_complete',eligible_count>0 and confirmed_count>=eligible_count,
    'final_complete',eligible_count>0 and final_count>=eligible_count,
    'minimum_margin_percent',coalesce(cfg.minimum_margin_percent,12),
    'components',components_json,'reconciliation',reconciliation,'alerts',alerts
  );
  return result;
end $$;
revoke all on function public.get_fit_financial_summary_v4(uuid) from public,anon;
grant execute on function public.get_fit_financial_summary_v4(uuid) to authenticated;

-- New acceptances snapshot strict stages. Existing snapshots stay untouched.
create or replace function public.capture_fit_financial_snapshot_v4()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare comps jsonb; rates jsonb; totals jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb),coalesce(jsonb_object_agg(x.currency,x.exchange_rate),'{}'::jsonb)
  into comps,rates from public._fit_financial_components_v4(new.quote_id)x;
  select jsonb_build_object(
    'selling_price_mad',new.accepted_amount_mad,
    'estimated_cost_mad',coalesce(sum(x.estimated_cost*x.exchange_rate),0),
    'quoted_cost_mad',coalesce(sum(x.supplier_quoted_cost*x.exchange_rate) filter(where x.supplier_quoted_cost is not null),0),
    'confirmed_cost_mad',coalesce(sum(x.confirmed_cost*x.exchange_rate) filter(where x.confirmed_cost is not null),0),
    'final_cost_mad',coalesce(sum(x.final_cost*x.exchange_rate) filter(where x.final_cost is not null),0)
  ) into totals from public._fit_financial_components_v4(new.quote_id)x;
  insert into public.fit_financial_snapshots(quote_id,acceptance_id,version_number,exchange_rates,components,totals)
  values(new.quote_id,new.id,new.version_number,rates,comps,totals) on conflict(acceptance_id) do nothing;
  return new;
end $$;
revoke all on function public.capture_fit_financial_snapshot_v4() from public,anon,authenticated;

-- Supplier liabilities only exist for an explicitly confirmed/final cost.
-- A quote or an estimate alone never creates a payable.
create or replace function public.get_fit_financial_closure_v8(p_quote_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare
  q public.fit_quotes%rowtype; finance jsonb; client_rows jsonb; supplier_rows jsonb;
  client_received numeric; deposit_received numeric; refunds numeric; supplier_paid numeric; supplier_payable numeric;
  incomplete_suppliers integer; commission_ready boolean; client_balance numeric; ready boolean; alerts jsonb;
begin
  if auth.uid() is null or not public.can_view_fit_internal_costs(auth.uid()) or not public.can_access_fit_quote(p_quote_id,auth.uid()) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id;
  if not found then raise exception 'FIT quote not found'; end if;
  finance:=public.get_fit_financial_summary_v4(p_quote_id);

  select coalesce(sum(case when p.status='received' then p.amount_mad else 0 end),0),
    coalesce(sum(case when p.status='received' and p.payment_purpose='fit_deposit' then p.amount_mad else 0 end),0),
    coalesce(sum(case when p.status='refunded' then p.amount_mad else 0 end),0),
    coalesce(jsonb_agg(jsonb_build_object('id',p.id,'amount_mad',p.amount_mad,'status',p.status,'purpose',p.payment_purpose,'method',p.method,'reference',p.reference,'due_date',p.due_date,'paid_at',p.paid_at,'notes',p.notes) order by coalesce(p.paid_at,p.created_at) desc),'[]'::jsonb)
  into client_received,deposit_received,refunds,client_rows from public.payments p
  where p.fit_quote_id=q.id or (q.converted_booking_id is not null and p.booking_id=q.converted_booking_id);
  client_balance:=greatest(0,coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-client_received+refunds);

  with component_settlements as (
    select x.*,s.name supplier_name,
      f.id payment_file_id,f.payment_percentage,f.amount_to_pay_now,f.amount_already_paid,f.remaining_balance,
      f.due_date,f.invoice_number,f.payment_reference,f.status settlement_status,
      f.exchange_rate_to_mad settlement_exchange_rate,
      exists(select 1 from public.international_payment_file_documents d where d.payment_file_id=f.id and d.document_type='invoice') has_invoice_document,
      exists(select 1 from public.international_payment_file_documents d where d.payment_file_id=f.id and d.document_type='payment_proof') has_payment_proof
    from public._fit_financial_components_v4(p_quote_id)x
    left join public.suppliers s on s.id=x.supplier_id
    left join lateral (
      select pf.* from public.international_payment_files pf
      where (pf.fit_quote_id=p_quote_id and pf.fit_source_type=x.source_type and pf.fit_source_id=x.source_id)
         or pf.id=x.supplier_payment_id or pf.id=x.supplier_invoice_id
      order by case when pf.fit_quote_id=p_quote_id and pf.fit_source_id=x.source_id then 0 else 1 end,pf.updated_at desc
      limit 1
    ) f on true
    where coalesce(x.final_cost,x.confirmed_cost,0)>0
  )
  select
    coalesce(sum(coalesce(amount_already_paid,0)*coalesce(settlement_exchange_rate,exchange_rate)),0),
    coalesce(sum(greatest(0,case when payment_file_id is not null then remaining_balance*coalesce(settlement_exchange_rate,exchange_rate) else coalesce(final_cost,confirmed_cost,0)*exchange_rate end)),0),
    count(*) filter(where not (
      coalesce(settlement_status,'')='paid'
      and (nullif(invoice_number,'') is not null or has_invoice_document or supplier_invoice_id is not null)
      and has_payment_proof
    )),
    coalesce(jsonb_agg(jsonb_build_object(
      'source_type',source_type,'source_id',source_id,'component_type',component_type,'label',label,
      'supplier_id',supplier_id,'supplier_name',supplier_name,
      'confirmed_amount',coalesce(final_cost,confirmed_cost,0),'currency',currency,'exchange_rate',exchange_rate,
      'confirmed_mad',coalesce(final_cost,confirmed_cost,0)*exchange_rate,
      'deposit_required',coalesce(amount_to_pay_now,0),'deposit_paid',least(coalesce(amount_already_paid,0),coalesce(amount_to_pay_now,0)),
      'amount_paid',coalesce(amount_already_paid,0),
      'balance',case when payment_file_id is not null then coalesce(remaining_balance,0) else coalesce(final_cost,confirmed_cost,0) end,
      'payment_deadline',due_date,'invoice_number',invoice_number,'payment_reference',payment_reference,
      'settlement_status',coalesce(settlement_status,'not_recorded'),
      'settlement_exchange_rate',coalesce(settlement_exchange_rate,exchange_rate),'deposit_percent',coalesce(payment_percentage,0),
      'invoice_received',(nullif(invoice_number,'') is not null or has_invoice_document or supplier_invoice_id is not null),
      'payment_proof_received',has_payment_proof,'payment_file_id',payment_file_id
    ) order by coalesce(due_date,'infinity'::date),component_type,label),'[]'::jsonb)
  into supplier_paid,supplier_payable,incomplete_suppliers,supplier_rows from component_settlements;

  commission_ready:=q.partner_organization_id is null or exists(
    select 1 from public.agency_commission_snapshots c where c.fit_quote_id=q.id and c.is_current=true
      and c.sales_agent_commission_status in ('confirmed','acquired','paid')
  );
  ready:=q.converted_booking_id is not null and client_balance<=0.01 and incomplete_suppliers=0 and commission_ready;
  alerts:=jsonb_strip_nulls(jsonb_build_object(
    'client_balance_due',case when client_balance>0.01 then client_balance end,
    'client_payment_overdue',case when exists(select 1 from public.payments p where (p.fit_quote_id=q.id or p.booking_id=q.converted_booking_id) and p.status='pending' and p.due_date<current_date) then true end,
    'supplier_payment_due',case when exists(select 1 from public.international_payment_files f where f.fit_quote_id=q.id and f.status not in ('paid','cancelled') and f.due_date<=current_date+7) then true end,
    'cancellation_deadline',case when exists(select 1 from public.fit_supplier_requests r where r.quote_id=q.id and r.status in ('confirmed','option_hold') and r.cancellation_deadline<=statement_timestamp()+interval '7 days') then true end,
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
    'confirmed_complete',coalesce((finance->>'confirmed_complete')::boolean,false),
    'final_complete',coalesce((finance->>'final_complete')::boolean,false),
    'commissions_finalized',commission_ready,'alerts',alerts
  );
end $$;
revoke all on function public.get_fit_financial_closure_v8(uuid) from public,anon;
grant execute on function public.get_fit_financial_closure_v8(uuid) to authenticated;

-- V9 was deployed with the same estimate -> quote -> confirmation fallback.
-- Patch its read-only aggregate in place while retaining the full V9 API and alert model.
-- The guarded replacements make this safe both after the original migration and on a
-- fresh install where 20260909120000 already contains the corrected expressions.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(p.oid)
  into function_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='get_fit_control_tower_v9'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='p_search text, p_limit integer';

  if function_definition is null then
    raise exception 'get_fit_control_tower_v9(text,integer) is required before FIT V10';
  else
    function_definition:=replace(
      function_definition,
      'sum(coalesce(x.confirmed_cost, x.supplier_quoted_cost, x.estimated_cost) * x.exchange_rate)',
      'sum(x.confirmed_cost * x.exchange_rate) filter (where x.confirmed_cost is not null)'
    );
    function_definition:=replace(
      function_definition,
      'sum(coalesce(x.final_cost, x.confirmed_cost, x.supplier_quoted_cost, x.estimated_cost) * x.exchange_rate)',
      'sum(x.final_cost * x.exchange_rate) filter (where x.final_cost is not null)'
    );
    -- pg_get_functiondef preserves the compact source spelling on some PostgreSQL versions.
    function_definition:=replace(
      function_definition,
      'sum(coalesce(x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate)',
      'sum(x.confirmed_cost*x.exchange_rate) filter(where x.confirmed_cost is not null)'
    );
    function_definition:=replace(
      function_definition,
      'sum(coalesce(x.final_cost,x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate)',
      'sum(x.final_cost*x.exchange_rate) filter(where x.final_cost is not null)'
    );
    if position('coalesce(x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)' in replace(function_definition,' ',''))>0
      or position('coalesce(x.final_cost,x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)' in replace(function_definition,' ',''))>0 then
      raise exception 'FIT V9 financial fallback could not be replaced safely';
    end if;
    execute function_definition;
  end if;
end
$migration$;

notify pgrst,'reload schema';
