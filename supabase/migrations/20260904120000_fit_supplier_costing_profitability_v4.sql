-- FIT V4: financial overlay on the existing FIT line, supplier, payment and
-- commission engines. No anonymous or supplier access is granted.

do $$
declare t text;
begin
  foreach t in array array['fit_quote_day_cost_lines','fit_quote_cost_lines','fit_quote_hotel_lines','fit_quote_flight_lines'] loop
    execute format('alter table public.%I add column if not exists supplier_id uuid references public.suppliers(id) on delete set null',t);
    execute format('alter table public.%I add column if not exists supplier_quote_id uuid',t);
    execute format('alter table public.%I add column if not exists supplier_confirmation_document_id uuid references public.fit_quote_documents(id) on delete set null',t);
    execute format('alter table public.%I add column if not exists supplier_invoice_id uuid references public.international_payment_files(id) on delete set null',t);
    execute format('alter table public.%I add column if not exists supplier_payment_id uuid references public.international_payment_files(id) on delete set null',t);
    execute format('alter table public.%I add column if not exists estimated_cost numeric not null default 0',t);
    execute format('alter table public.%I add column if not exists supplier_quoted_cost numeric',t);
    execute format('alter table public.%I add column if not exists confirmed_cost numeric',t);
    execute format('alter table public.%I add column if not exists final_cost numeric',t);
    execute format('alter table public.%I add column if not exists component_selling_price numeric not null default 0',t);
    execute format('alter table public.%I add column if not exists cost_currency text not null default ''MAD''',t);
    execute format('alter table public.%I add column if not exists exchange_rate_to_mad numeric not null default 1',t);
    execute format('alter table public.%I add column if not exists supplier_payment_status text not null default ''not_due''',t);
    execute format('alter table public.%I add column if not exists financial_updated_at timestamptz not null default now()',t);
  end loop;
end $$;

alter table public.fit_quote_day_cost_lines drop constraint if exists fit_quote_day_cost_lines_category_check;
alter table public.fit_quote_day_cost_lines add constraint fit_quote_day_cost_lines_category_check check(category in ('transport','guide','visit','tickets','meal','restaurants','insurance','luggage','agency_fee','hotel','flight','activities','other'));
alter table public.fit_quote_cost_lines drop constraint if exists fit_quote_cost_lines_category_check;
alter table public.fit_quote_cost_lines add constraint fit_quote_cost_lines_category_check check(category in ('transport','guide','visit','tickets','meal','restaurants','insurance','luggage','agency_fee','hotel','flight','activities','other','adjustment','discount','optional_extra'));

do $$ declare t text; begin
  if to_regclass('public.supplier_trip_quotes') is not null then
    foreach t in array array['fit_quote_day_cost_lines','fit_quote_cost_lines','fit_quote_hotel_lines','fit_quote_flight_lines'] loop
      if not exists(select 1 from pg_constraint where conrelid=format('public.%I',t)::regclass and conname=t||'_supplier_quote_id_fkey') then
        execute format('alter table public.%I add constraint %I foreign key(supplier_quote_id) references public.supplier_trip_quotes(id) on delete set null',t,t||'_supplier_quote_id_fkey');
      end if;
    end loop;
  end if;
end $$;

-- Seed the financial overlay from existing values once; future editing uses the
-- explicit fields above. JPY rows retain their stored MAD equivalent by using
-- MAD as the migration baseline rather than inventing a live FX rate.
update public.fit_quote_day_cost_lines set estimated_cost=coalesce(nullif(subtotal_mad,0),price_mad,0), component_selling_price=coalesce(nullif(subtotal_mad,0),price_mad,0) where estimated_cost=0;
update public.fit_quote_cost_lines set estimated_cost=coalesce(nullif(total_mad,0),unit_cost_mad,0), component_selling_price=coalesce(selling_price_mad,0) where estimated_cost=0;
update public.fit_quote_hotel_lines set estimated_cost=coalesce(subtotal_mad,0), component_selling_price=coalesce(subtotal_mad,0) where estimated_cost=0;
update public.fit_quote_flight_lines set estimated_cost=coalesce(subtotal_mad,0), component_selling_price=coalesce(subtotal_mad,0) where estimated_cost=0;

do $$ declare t text; begin
  foreach t in array array['fit_quote_day_cost_lines','fit_quote_cost_lines','fit_quote_hotel_lines','fit_quote_flight_lines'] loop
    execute format('alter table public.%I drop constraint if exists %I',t,t||'_cost_currency_check');
    execute format('alter table public.%I add constraint %I check (cost_currency in (''JPY'',''MAD'',''EUR'',''USD''))',t,t||'_cost_currency_check');
    execute format('alter table public.%I drop constraint if exists %I',t,t||'_supplier_payment_status_check');
    execute format('alter table public.%I add constraint %I check (supplier_payment_status in (''not_due'',''pending'',''partially_paid'',''paid'',''cancelled''))',t,t||'_supplier_payment_status_check');
    execute format('alter table public.%I add constraint %I check (estimated_cost >= 0 and (supplier_quoted_cost is null or supplier_quoted_cost >= 0) and (confirmed_cost is null or confirmed_cost >= 0) and (final_cost is null or final_cost >= 0) and component_selling_price >= 0 and exchange_rate_to_mad > 0)',t,t||'_financial_amounts_check');
  end loop;
exception when duplicate_object then null;
end $$;

create table if not exists public.fit_financial_settings (
  id boolean primary key default true check(id),
  minimum_margin_percent numeric not null default 12,
  significant_fx_erosion_percent numeric not null default 5,
  block_below_threshold boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.fit_financial_settings(id) values(true) on conflict do nothing;
alter table public.fit_financial_settings enable row level security;
drop policy if exists "FIT finance admins manage settings" on public.fit_financial_settings;
create policy "FIT finance admins manage settings" on public.fit_financial_settings for all
using (public.can_view_fit_internal_costs(auth.uid())) with check (public.can_view_fit_internal_costs(auth.uid()));

create table if not exists public.fit_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete restrict,
  acceptance_id uuid not null references public.fit_quote_acceptances(id) on delete restrict,
  version_number integer not null,
  exchange_rates jsonb not null,
  components jsonb not null,
  totals jsonb not null,
  created_at timestamptz not null default now(),
  unique(acceptance_id)
);
alter table public.fit_financial_snapshots enable row level security;
drop policy if exists "FIT finance admins read snapshots" on public.fit_financial_snapshots;
create policy "FIT finance admins read snapshots" on public.fit_financial_snapshots for select
using (public.can_view_fit_internal_costs(auth.uid()));
revoke all on public.fit_financial_settings,public.fit_financial_snapshots from anon;
grant select,insert,update on public.fit_financial_settings to authenticated;
grant select on public.fit_financial_snapshots to authenticated;

create or replace function public._fit_financial_components_v4(p_quote_id uuid)
returns table(source_type text,source_id uuid,component_type text,label text,supplier_id uuid,estimated_cost numeric,supplier_quoted_cost numeric,confirmed_cost numeric,final_cost numeric,selling_price numeric,currency text,exchange_rate numeric,payment_status text,supplier_quote_id uuid,supplier_confirmation_document_id uuid,supplier_invoice_id uuid,supplier_payment_id uuid)
language sql stable security definer set search_path=pg_catalog,public as $$
  select 'day_cost',l.id,case when l.category='visit' then 'tickets' when l.category='meal' then 'restaurants' else l.category end,l.label,l.supplier_id,l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,l.component_selling_price,l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,l.supplier_quote_id,l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id from public.fit_quote_day_cost_lines l where l.quote_id=p_quote_id
  union all select 'cost_line',l.id,case when l.category='visit' then 'tickets' when l.category='meal' then 'restaurants' else l.category end,l.label,l.supplier_id,l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,l.component_selling_price,l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,l.supplier_quote_id,l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id from public.fit_quote_cost_lines l where l.quote_id=p_quote_id
  union all select 'hotel',l.id,'hotels',coalesce(l.hotel_name,l.city,'Hôtel'),l.supplier_id,l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,l.component_selling_price,l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,l.supplier_quote_id,l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id from public.fit_quote_hotel_lines l where l.quote_id=p_quote_id
  union all select 'flight',l.id,'flights',coalesce(l.route,l.airline,'Vol'),l.supplier_id,l.estimated_cost,l.supplier_quoted_cost,l.confirmed_cost,l.final_cost,l.component_selling_price,l.cost_currency,l.exchange_rate_to_mad,l.supplier_payment_status,l.supplier_quote_id,l.supplier_confirmation_document_id,l.supplier_invoice_id,l.supplier_payment_id from public.fit_quote_flight_lines l where l.quote_id=p_quote_id
$$;
revoke all on function public._fit_financial_components_v4(uuid) from public,anon,authenticated;

create or replace function public.get_fit_financial_summary_v4(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare q public.fit_quotes%rowtype; s record; cfg public.fit_financial_settings%rowtype; c jsonb; result jsonb; fx_risk boolean:=false;
begin
  if auth.uid() is null or not public.can_view_fit_internal_costs(auth.uid()) or not public.can_access_fit_quote(p_quote_id,auth.uid()) then raise exception 'not authorized'; end if;
  select * into q from public.fit_quotes where id=p_quote_id;
  select * into cfg from public.fit_financial_settings where id=true;
  select coalesce(sum(estimated_cost*exchange_rate),0) estimated,
    coalesce(sum(coalesce(confirmed_cost,supplier_quoted_cost,estimated_cost)*exchange_rate),0) confirmed,
    coalesce(sum(coalesce(final_cost,confirmed_cost,supplier_quoted_cost,estimated_cost)*exchange_rate),0) final,
    coalesce(sum(case when payment_status='paid' then coalesce(final_cost,confirmed_cost,supplier_quoted_cost,estimated_cost)*exchange_rate else 0 end),0) paid
  into s from public._fit_financial_components_v4(p_quote_id);
  select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('estimated_mad',x.estimated_cost*x.exchange_rate,'confirmed_mad',coalesce(x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate,'final_mad',coalesce(x.final_cost,x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate,'variance',coalesce(x.final_cost,x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)-x.estimated_cost,'margin_mad',x.selling_price-(coalesce(x.final_cost,x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate)) order by x.component_type,x.label),'[]'::jsonb) into c from public._fit_financial_components_v4(p_quote_id)x;
  if q.accepted_snapshot_id is not null then
    select exists(select 1 from public._fit_financial_components_v4(p_quote_id)x
      join public.fit_financial_snapshots fs on fs.acceptance_id=q.accepted_snapshot_id
      cross join lateral jsonb_array_elements(fs.components) old
      where old->>'source_id'=x.source_id::text and coalesce((old->>'exchange_rate')::numeric,1)>0
        and abs((x.exchange_rate/coalesce((old->>'exchange_rate')::numeric,1))-1)*100>=coalesce(cfg.significant_fx_erosion_percent,5)) into fx_risk;
  end if;
  with comm as (select * from public.agency_commission_snapshots where fit_quote_id=p_quote_id and is_current=true order by created_at desc limit 1)
  select jsonb_build_object('quote_id',q.id,'selling_price_mad',coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0),'estimated_supplier_cost_mad',s.estimated,'confirmed_supplier_cost_mad',s.confirmed,'final_supplier_cost_mad',s.final,'supplier_paid_cost_mad',s.paid,'gross_margin_mad',coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-s.final,'gross_margin_percent',case when coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)>0 then round(100*(coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-s.final)/coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0),2) else 0 end,'agency_gross_commission_mad',coalesce((select gross_agency_commission_amount_mad from comm),0),'sales_agent_commission_mad',coalesce((select sales_agent_commission_amount_mad from comm),0),'agency_net_commission_mad',coalesce((select agency_net_commission_amount_mad from comm),0),'lejapon_gross_margin_mad',coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-s.final-coalesce((select gross_agency_commission_amount_mad from comm),0),'expected_profit_mad',coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-s.estimated-coalesce((select gross_agency_commission_amount_mad from comm),0),'confirmed_profit_mad',coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-s.confirmed-coalesce((select gross_agency_commission_amount_mad from comm),0),'final_profit_mad',coalesce(q.accepted_amount_mad,q.total_selling_price_mad,0)-s.final-coalesce((select gross_agency_commission_amount_mad from comm),0),'minimum_margin_percent',coalesce(cfg.minimum_margin_percent,12),'components',c) into result;
  return result || jsonb_build_object('alerts',jsonb_strip_nulls(jsonb_build_object('negative_margin',case when (result->>'final_profit_mad')::numeric<0 then true end,'below_threshold',case when (result->>'gross_margin_percent')::numeric<coalesce(cfg.minimum_margin_percent,12) then true end,'cost_increase_after_acceptance',case when q.accepted_snapshot_id is not null and s.final>s.estimated then true end,'exchange_rate_erosion',case when fx_risk then true end)));
end $$;
revoke all on function public.get_fit_financial_summary_v4(uuid) from public,anon;
grant execute on function public.get_fit_financial_summary_v4(uuid) to authenticated;

create or replace function public.capture_fit_financial_snapshot_v4()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare comps jsonb; rates jsonb; totals jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb),coalesce(jsonb_object_agg(x.currency,x.exchange_rate),'{}'::jsonb) into comps,rates from public._fit_financial_components_v4(new.quote_id)x;
  select jsonb_build_object('selling_price_mad',new.accepted_amount_mad,'estimated_cost_mad',coalesce(sum(x.estimated_cost*x.exchange_rate),0),'confirmed_cost_mad',coalesce(sum(coalesce(x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate),0)) into totals from public._fit_financial_components_v4(new.quote_id)x;
  insert into public.fit_financial_snapshots(quote_id,acceptance_id,version_number,exchange_rates,components,totals) values(new.quote_id,new.id,new.version_number,rates,comps,totals) on conflict(acceptance_id) do nothing;
  return new;
end $$;
revoke all on function public.capture_fit_financial_snapshot_v4() from public,anon,authenticated;
drop trigger if exists fit_acceptance_capture_financial_snapshot on public.fit_quote_acceptances;
create trigger fit_acceptance_capture_financial_snapshot after insert on public.fit_quote_acceptances for each row execute function public.capture_fit_financial_snapshot_v4();

-- Preserve already-accepted versions at migration time as well. This is a
-- one-time baseline, not a live recalculation of historical acceptances.
insert into public.fit_financial_snapshots(quote_id,acceptance_id,version_number,exchange_rates,components,totals)
select a.quote_id,a.id,a.version_number,
  coalesce((select jsonb_object_agg(x.currency,x.exchange_rate) from public._fit_financial_components_v4(a.quote_id)x),'{}'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(x)) from public._fit_financial_components_v4(a.quote_id)x),'[]'::jsonb),
  jsonb_build_object('selling_price_mad',a.accepted_amount_mad,
    'estimated_cost_mad',coalesce((select sum(x.estimated_cost*x.exchange_rate) from public._fit_financial_components_v4(a.quote_id)x),0),
    'confirmed_cost_mad',coalesce((select sum(coalesce(x.confirmed_cost,x.supplier_quoted_cost,x.estimated_cost)*x.exchange_rate) from public._fit_financial_components_v4(a.quote_id)x),0))
from public.fit_quote_acceptances a
where not exists(select 1 from public.fit_financial_snapshots s where s.acceptance_id=a.id)
on conflict(acceptance_id) do nothing;

notify pgrst,'reload schema';
