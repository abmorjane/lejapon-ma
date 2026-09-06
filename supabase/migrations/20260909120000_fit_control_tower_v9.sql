-- FIT V9: executive control tower over the existing FIT engines.
-- No business state is owned here; this is a secured read-only aggregation.

create or replace function public.get_fit_control_tower_v9(p_search text default null,p_limit integer default 40)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare result jsonb; search_value text:=nullif(trim(coalesce(p_search,'')),''); row_limit integer:=greatest(1,least(coalesce(p_limit,40),100));
begin
  if auth.uid() is null or not public.can_view_fit_internal_costs(auth.uid()) then raise exception 'not authorized'; end if;

  with current_quotes as (
    select q.*,
      po.name agency_name,
      owner_profile.full_name owner_name,
      b.reference booking_reference,
      b.status booking_status_value,
      coalesce((select string_agg(distinct d.city,' → ' order by d.city) from public.fit_quote_days d where d.quote_id=q.id and nullif(trim(d.city),'') is not null),'Japon') destination,
      coalesce(comm.gross_agency_commission_amount_mad,0) agency_commission,
      coalesce(comm.sales_agent_commission_amount_mad,0) agent_commission,
      coalesce((select sum(x.estimated_cost*x.exchange_rate) from public._fit_financial_components_v4(q.id)x),0) estimated_cost,
      coalesce((select sum(coalesce(x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate) from public._fit_financial_components_v4(q.id)x),0) confirmed_cost,
      coalesce((select sum(coalesce(x.final_cost,x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate) from public._fit_financial_components_v4(q.id)x),0) final_cost,
      coalesce((select sum(case when p.status='received' then p.amount_mad when p.status='refunded' then -p.amount_mad else 0 end) from public.payments p where p.fit_quote_id=q.id or (q.converted_booking_id is not null and p.booking_id=q.converted_booking_id)),0) client_paid,
      (select string_agg(distinct f.pnr,' · ') from public.booking_flight_reservations f where f.booking_id=q.converted_booking_id and nullif(trim(f.pnr),'') is not null) pnr
    from public.fit_quotes q
    left join public.partner_organizations po on po.id=q.partner_organization_id
    left join public.profiles owner_profile on owner_profile.id=coalesce(q.owner_user_id,q.created_by)
    left join public.bookings b on b.id=q.converted_booking_id
    left join lateral (
      select c.* from public.agency_commission_snapshots c where c.fit_quote_id=q.id and c.is_current=true order by c.created_at desc limit 1
    ) comm on true
    where q.deleted_at is null and q.archived_at is null and coalesce(q.is_current_version,true)=true
  ),
  scoped as (
    select * from current_quotes q where search_value is null
      or q.quote_number ilike '%'||search_value||'%'
      or q.quote_family_reference ilike '%'||search_value||'%'
      or q.client_name ilike '%'||search_value||'%'
      or q.agency_name ilike '%'||search_value||'%'
      or q.owner_name ilike '%'||search_value||'%'
      or q.destination ilike '%'||search_value||'%'
      or q.booking_reference ilike '%'||search_value||'%'
      or q.pnr ilike '%'||search_value||'%'
  ),
  kpi as (
    select
      (select count(*) from public.agency_fit_requests r where coalesce(r.status,'new') in ('new','submitted','pending','draft') and r.fit_quote_id is null) new_requests,
      count(*) filter(where coalesce(commercial_status,status) in ('draft','ready')) preparing,
      count(*) filter(where coalesce(commercial_status,status) in ('sent','viewed')) waiting_client,
      count(*) filter(where coalesce(commercial_status,status)='revision_requested') revisions,
      count(*) filter(where coalesce(commercial_status,status)='accepted') accepted,
      count(*) filter(where coalesce(commercial_status,status)='deposit_pending') awaiting_deposit,
      count(*) filter(where converted_booking_id is not null and coalesce(travel_start_date,current_date+1)>current_date and coalesce(booking_status_value::text,'')<>'completed') booked,
      count(*) filter(where converted_booking_id is not null and current_date between travel_start_date and travel_end_date) traveling,
      count(*) filter(where converted_booking_id is not null and (booking_status_value::text='completed' or travel_end_date<current_date)) completed,
      count(*) filter(where coalesce(commercial_status,status) in ('lost','expired','cancelled')) lost
    from current_quotes
  ),
  commercial as (
    select
      coalesce(sum(coalesce(accepted_amount_mad,total_selling_price_mad,0)) filter(where coalesce(commercial_status,status) not in ('converted_to_booking','lost','expired','cancelled')),0) pipeline_value,
      case when count(*) filter(where coalesce(commercial_status,status) not in ('draft','ready'))>0 then round(100.0*count(*) filter(where converted_booking_id is not null)/count(*) filter(where coalesce(commercial_status,status) not in ('draft','ready')),1) else 0 end conversion_rate,
      case when count(*) filter(where coalesce(commercial_status,status) not in ('lost','expired','cancelled'))>0 then round(avg(coalesce(accepted_amount_mad,total_selling_price_mad,0)) filter(where coalesce(commercial_status,status) not in ('lost','expired','cancelled')),0) else 0 end average_value,
      coalesce(sum(agency_commission),0) agency_commissions,
      coalesce(sum(agent_commission),0) agent_commissions
    from current_quotes
  ),
  profitability as (
    select
      coalesce(sum(coalesce(accepted_amount_mad,total_selling_price_mad,0)-estimated_cost-agency_commission),0) expected_margin,
      coalesce(sum(coalesce(accepted_amount_mad,total_selling_price_mad,0)-confirmed_cost-agency_commission),0) confirmed_margin,
      coalesce(sum(greatest(0,confirmed_cost-estimated_cost)),0) margin_at_risk
    from current_quotes where coalesce(commercial_status,status) not in ('lost','expired','cancelled')
  ),
  operations as (
    select jsonb_build_object(
      'supplier_replies_pending',(select count(*) from public.fit_supplier_requests r join current_quotes q on q.id=r.quote_id where r.status in ('sent','waiting_supplier')),
      'hotels_pending',(select count(*) from public.fit_supplier_requests r join current_quotes q on q.id=r.quote_id where r.service_type='hotels' and r.status not in ('confirmed','paid','voucher_received','cancelled')),
      'transport_pending',(select count(*) from public.fit_supplier_requests r join current_quotes q on q.id=r.quote_id where r.service_type='transport' and r.status not in ('confirmed','paid','voucher_received','cancelled')),
      'activities_pending',(select count(*) from public.fit_supplier_requests r join current_quotes q on q.id=r.quote_id where r.service_type in ('activities','tickets') and r.status not in ('confirmed','paid','voucher_received','cancelled')),
      'flights_pending',(select count(*) from current_quotes q where q.converted_booking_id is not null and coalesce(q.travel_end_date,current_date)>=current_date and not exists(select 1 from public.booking_flight_reservations f where f.booking_id=q.converted_booking_id and f.status in ('ticket_sent','delivered') and (f.ticket_document_id is not null or f.ticket_storage_path is not null))),
      'documents_missing',(select count(*) from public.operation_tasks t where t.status not in ('completed','cancelled') and t.category in ('documents','document','passport','passport_verification','visa','travel_documents')
        and exists(select 1 from current_quotes q where t.metadata->>'fit_quote_id'=q.id::text or (q.converted_booking_id is not null and t.booking_id=q.converted_booking_id))),
      'payments_due',(select count(*) from public.international_payment_files f where f.status not in ('paid','cancelled') and f.due_date<=current_date+7
        and exists(select 1 from current_quotes q where f.fit_quote_id=q.id))
        +(select count(*) from public.payments p where p.status='pending' and p.due_date<=current_date+7
          and exists(select 1 from current_quotes q where p.fit_quote_id=q.id or (q.converted_booking_id is not null and p.booking_id=q.converted_booking_id)))
    ) value
  ),
  alert_rows as (
    select r.quote_id,'supplier_hold'::text alert_type,
      coalesce(q.quote_family_reference,q.quote_number)||' — option '||r.service_label||' à confirmer' title,
      coalesce(p.full_name,'Équipe opérations') owner,'critical'::text priority,r.hold_release_deadline deadline,
      '/admin/fit-supplier-control?quote='||r.quote_id::text href,'Traiter l’option'::text action_label
    from public.fit_supplier_requests r join current_quotes q on q.id=r.quote_id left join public.profiles p on p.id=r.assigned_staff_id
    where r.status='option_hold' and r.hold_release_deadline<=statement_timestamp()+interval '72 hours'
    union all
    select r.quote_id,'supplier_reply',coalesce(q.quote_family_reference,q.quote_number)||' — réponse fournisseur en retard',coalesce(p.full_name,'Équipe opérations'),'high',r.follow_up_at,
      '/admin/fit-supplier-control?quote='||r.quote_id::text,'Relancer'
    from public.fit_supplier_requests r join current_quotes q on q.id=r.quote_id left join public.profiles p on p.id=r.assigned_staff_id
    where r.status in ('sent','waiting_supplier') and r.follow_up_at<statement_timestamp()
    union all
    select q.id,'deposit',coalesce(q.quote_family_reference,q.quote_number)||' — devis accepté, acompte non reçu',coalesce(q.owner_name,'Équipe commerciale'),'high',coalesce(q.public_payment_deadline::timestamptz,q.accepted_at+interval '3 days'),
      '/admin/fit-quotes?quote='||q.id::text,'Confirmer l’acompte'
    from current_quotes q where coalesce(q.commercial_status,q.status) in ('accepted','deposit_pending') and q.client_paid<coalesce(q.public_deposit_mad,0)
    union all
    select q.id,'margin',coalesce(q.quote_family_reference,q.quote_number)||' — hausse fournisseur, marge à risque',coalesce(q.owner_name,'Finance'),'high',null::timestamptz,
      '/admin/fit-quotes?quote='||q.id::text,'Vérifier la marge'
    from current_quotes q where q.confirmed_cost>q.estimated_cost and coalesce(q.commercial_status,q.status) not in ('lost','expired','cancelled')
    union all
    select q.id,'departure_ticket',coalesce(q.quote_family_reference,q.quote_number)||' — départ proche, billet incomplet',coalesce(q.owner_name,'Équipe opérations'),'critical',q.travel_start_date::timestamptz,
      '/admin/bookings/'||q.converted_booking_id::text,'Compléter le billet'
    from current_quotes q where q.converted_booking_id is not null and q.travel_start_date between current_date and current_date+7
      and not exists(select 1 from public.booking_flight_reservations f where f.booking_id=q.converted_booking_id and f.status in ('ticket_sent','delivered') and (f.ticket_document_id is not null or f.ticket_storage_path is not null))
    union all
    select q.id,'client_balance',coalesce(q.quote_family_reference,q.quote_number)||' — solde client à encaisser',coalesce(q.owner_name,'Finance'),'medium',
      coalesce((select min(p.due_date)::timestamptz from public.payments p where (p.fit_quote_id=q.id or p.booking_id=q.converted_booking_id) and p.status='pending'),q.travel_start_date::timestamptz),
      '/admin/fit-quotes?quote='||q.id::text,'Voir les paiements'
    from current_quotes q where q.converted_booking_id is not null and q.client_paid<coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)
  ),
  alerts as (
    select coalesce(jsonb_agg(jsonb_build_object('quote_id',quote_id,'type',alert_type,'title',title,'owner',owner,'priority',priority,'deadline',deadline,'href',href,'action_label',action_label)
      order by case priority when 'critical' then 1 when 'high' then 2 else 3 end,deadline nulls last),'[]'::jsonb) value
    from (select * from alert_rows order by case priority when 'critical' then 1 when 'high' then 2 else 3 end,deadline nulls last limit 50) a
  ),
  search_results as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'reference',coalesce(quote_family_reference,quote_number),'version',coalesce(version_number,1),'client',coalesce(client_name,'Client FIT'),
      'agency',agency_name,'agent',owner_name,'destination',destination,'booking',booking_reference,'pnr',pnr,
      'travel_start',travel_start_date,'travel_end',travel_end_date,'amount_mad',coalesce(accepted_amount_mad,total_selling_price_mad,0),
      'status',coalesce(commercial_status,status),'financial_status',financial_status,'href','/admin/fit-quotes?quote='||id::text
    ) order by updated_at desc),'[]'::jsonb) value from (select * from scoped order by updated_at desc limit row_limit) s
  )
  select jsonb_build_object('generated_at',statement_timestamp(),'kpis',to_jsonb(k),'commercial',to_jsonb(c),'profitability',to_jsonb(p),'operations',o.value,'alerts',a.value,'results',r.value)
  into result from kpi k cross join commercial c cross join profitability p cross join operations o cross join alerts a cross join search_results r;
  return result;
end $$;

revoke all on function public.get_fit_control_tower_v9(text,integer) from public,anon;
grant execute on function public.get_fit_control_tower_v9(text,integer) to authenticated;

notify pgrst,'reload schema';
