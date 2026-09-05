-- FIT V6: agency sales follow-ups reuse operation_tasks. No second task or
-- commission engine is introduced, and the agency view exposes no internal data.

create unique index if not exists operation_tasks_agency_fit_followup_source_uidx
  on public.operation_tasks ((metadata->>'source_key'))
  where metadata->>'source' = 'agency_fit_sales_followup';

create or replace function public.schedule_agency_fit_followups_v6(
  p_organization_id uuid,
  p_assigned_to uuid,
  p_fit_quote_id uuid,
  p_fit_request_id uuid,
  p_reference text,
  p_sent_at timestamptz default statement_timestamp()
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_day integer;
  v_entity text := coalesce(p_fit_quote_id::text, p_fit_request_id::text);
begin
  if p_organization_id is null or v_entity is null then return; end if;

  foreach v_day in array array[1,3,7] loop
    insert into public.operation_tasks(
      title, description, priority, status, assigned_to, organization_id,
      category, deadline, created_by, metadata
    ) values (
      'Relance client FIT D+'||v_day||' — '||coalesce(nullif(p_reference,''),'FIT'),
      'Relancer le client uniquement si aucune réponse commerciale n’a été reçue.',
      case when v_day=7 then 'high' else 'medium' end,
      'todo', p_assigned_to, p_organization_id, 'sales_follow_up',
      coalesce(p_sent_at,statement_timestamp())+make_interval(days=>v_day),
      p_assigned_to,
      jsonb_build_object(
        'source','agency_fit_sales_followup',
        'source_key','agency-fit-followup:'||v_entity||':'||v_day,
        'fit_quote_id',p_fit_quote_id,
        'agency_fit_request_id',p_fit_request_id,
        'sequence_day',v_day
      )
    ) on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.stop_agency_fit_followups_v6(
  p_fit_quote_id uuid,
  p_fit_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_entity text := coalesce(p_fit_quote_id::text,p_fit_request_id::text);
begin
  if v_entity is null then return; end if;
  update public.operation_tasks
  set status='completed', completed_at=coalesce(completed_at,statement_timestamp()),
      metadata=metadata||jsonb_build_object('stopped_reason',p_reason,'stopped_at',statement_timestamp())
  where metadata->>'source'='agency_fit_sales_followup'
    and metadata->>'source_key' like 'agency-fit-followup:'||v_entity||':%'
    and status not in ('completed','cancelled');
end;
$$;

create or replace function public.sync_fit_quote_sales_followups_v6()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_request_id uuid; v_status text:=coalesce(new.commercial_status,new.status);
begin
  if new.partner_organization_id is null then return new; end if;
  select r.id into v_request_id from public.agency_fit_requests r
  where r.fit_quote_id=new.id order by r.created_at desc limit 1;

  if v_status='sent' and v_status is distinct from coalesce(old.commercial_status,old.status) then
    perform public.schedule_agency_fit_followups_v6(
      new.partner_organization_id,coalesce(new.owner_user_id,new.created_by),new.id,v_request_id,
      coalesce(new.quote_family_reference,new.quote_number),coalesce(new.sent_at,statement_timestamp())
    );
  elsif v_status in ('revision_requested','accepted','lost','expired','cancelled','converted_to_booking')
    and v_status is distinct from coalesce(old.commercial_status,old.status) then
    perform public.stop_agency_fit_followups_v6(new.id,v_request_id,v_status);
  end if;
  return new;
end;
$$;

drop trigger if exists fit_quote_agency_sales_followups_v6 on public.fit_quotes;
create trigger fit_quote_agency_sales_followups_v6
after update of commercial_status,status on public.fit_quotes
for each row execute function public.sync_fit_quote_sales_followups_v6();

create or replace function public.sync_agency_fit_request_followups_v6()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_status text:=coalesce(new.status,'');
begin
  if v_status in ('sent','sent_to_client') and v_status is distinct from coalesce(old.status,'') then
    perform public.schedule_agency_fit_followups_v6(
      new.organization_id,coalesce(new.assigned_sales_agent_id,new.assigned_to,new.sales_agent_id,new.requested_by),
      new.fit_quote_id,new.id,coalesce(new.client_name,new.client_full_name,'FIT'),coalesce(new.quoted_at,statement_timestamp())
    );
  elsif v_status in ('revision_requested','client_modification_requested','accepted','declined','cancelled','archived','converted_to_booking')
    and v_status is distinct from coalesce(old.status,'') then
    perform public.stop_agency_fit_followups_v6(new.fit_quote_id,new.id,v_status);
  end if;
  return new;
end;
$$;

drop trigger if exists agency_fit_request_sales_followups_v6 on public.agency_fit_requests;
create trigger agency_fit_request_sales_followups_v6
after update of status on public.agency_fit_requests
for each row execute function public.sync_agency_fit_request_followups_v6();

-- Idempotent backfill for proposals already waiting for the client.
select public.schedule_agency_fit_followups_v6(
  q.partner_organization_id,coalesce(q.owner_user_id,q.created_by),q.id,r.id,
  coalesce(q.quote_family_reference,q.quote_number),coalesce(q.sent_at,q.updated_at,q.created_at)
)
from public.fit_quotes q
left join lateral (
  select ar.id from public.agency_fit_requests ar where ar.fit_quote_id=q.id order by ar.created_at desc limit 1
) r on true
where q.partner_organization_id is not null
  and coalesce(q.commercial_status,q.status) in ('sent','viewed')
  and q.deleted_at is null and q.is_current_version is distinct from false;

select public.schedule_agency_fit_followups_v6(
  r.organization_id,coalesce(r.assigned_sales_agent_id,r.assigned_to,r.sales_agent_id,r.requested_by),
  null,r.id,coalesce(r.client_name,r.client_full_name,'FIT'),coalesce(r.quoted_at,r.updated_at,r.created_at)
)
from public.agency_fit_requests r
where r.fit_quote_id is null and r.status in ('sent','sent_to_client');

drop view if exists public.agency_fit_sales_followups_v6;
create view public.agency_fit_sales_followups_v6
with (security_barrier=true)
as
select
  t.id,t.organization_id,t.assigned_to,t.title,t.priority,t.status,t.deadline,
  t.metadata->>'fit_quote_id' as fit_quote_id,
  t.metadata->>'agency_fit_request_id' as agency_fit_request_id,
  nullif(t.metadata->>'sequence_day','')::integer as sequence_day
from public.operation_tasks t
where t.metadata->>'source'='agency_fit_sales_followup'
  and (
    public.agency_fit_is_owner_manager_v1(auth.uid(),t.organization_id)
    or (public.agency_fit_is_sales_agent_v1(auth.uid(),t.organization_id) and t.assigned_to=auth.uid())
  );

revoke all on function public.schedule_agency_fit_followups_v6(uuid,uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.stop_agency_fit_followups_v6(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.sync_fit_quote_sales_followups_v6() from public,anon,authenticated;
revoke all on function public.sync_agency_fit_request_followups_v6() from public,anon,authenticated;
revoke all on public.agency_fit_sales_followups_v6 from public,anon;
grant select on public.agency_fit_sales_followups_v6 to authenticated;

notify pgrst,'reload schema';
