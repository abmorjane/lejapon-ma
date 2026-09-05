-- FIT V7: client-safe proposal context, selectable extras and anonymous
-- interaction analytics. Base FIT tables remain inaccessible to anon.

alter table public.fit_quotes
  add column if not exists public_payment_deadline date;

alter table public.fit_quote_acceptances
  add column if not exists selected_public_extras jsonb not null default '[]'::jsonb;

-- Acceptance rows stay immutable. The only V7 exception is the single,
-- transaction-local attachment of the selected public extras after V3 creates
-- the acceptance. Direct anonymous/authenticated table updates remain denied.
create or replace function public.fit_quote_acceptance_immutable_v3()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE'
     and old.commission_snapshot_id is null and new.commission_snapshot_id is not null
     and (to_jsonb(old)-'commission_snapshot_id')=(to_jsonb(new)-'commission_snapshot_id') then
    return new;
  end if;
  if tg_op='UPDATE'
     and old.selected_public_extras='[]'::jsonb and new.selected_public_extras<>'[]'::jsonb
     and (to_jsonb(old)-'selected_public_extras')=(to_jsonb(new)-'selected_public_extras') then
    return new;
  end if;
  raise exception 'FIT quote acceptances are immutable';
end;
$$;

create table if not exists public.fit_quote_public_extra_selections (
  quote_id uuid not null references public.fit_quotes(id) on delete cascade,
  line_id uuid not null references public.fit_quote_day_cost_lines(id) on delete cascade,
  selected boolean not null default false,
  selected_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(quote_id,line_id)
);
alter table public.fit_quote_public_extra_selections enable row level security;
revoke all on public.fit_quote_public_extra_selections from anon,authenticated;

alter table public.fit_quote_public_audit_events
  drop constraint if exists fit_quote_public_audit_events_event_check;
alter table public.fit_quote_public_audit_events
  add constraint fit_quote_public_audit_events_event_check check(event in (
    'opened','accepted','revision_requested','declined',
    'quote_opened','itinerary_viewed','hotel_viewed','price_viewed',
    'quote_accepted','quote_declined','extra_selection_changed'
  ));

create or replace function public.get_public_fit_quote_context_v7(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public
as $$
declare v_quote public.fit_quotes%rowtype; v_result jsonb;
begin
  select * into v_quote from public.fit_quotes where id=public._resolve_public_fit_quote_token(p_token);
  if not found then return null; end if;

  select jsonb_build_object(
    'family_reference',coalesce(v_quote.quote_family_reference,v_quote.quote_number),
    'version_number',coalesce(v_quote.version_number,1),
    'is_current_version',coalesce(v_quote.is_current_version,true),
    'payment_deadline',v_quote.public_payment_deadline,
    'advisor',jsonb_build_object(
      'name',coalesce(nullif(v_quote.partner_contact_name,''),nullif(p.contact_person_name,''),nullif(p.commercial_name,''),'LeJapon.ma'),
      'whatsapp',coalesce(nullif(regexp_replace(p.whatsapp,'[^0-9]','','g'),''),nullif(regexp_replace(p.contact_phone,'[^0-9]','','g'),''),'212711449838')
    ),
    'extras',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'day_key',d.day_number,'category',l.category,'label',l.label,
      'client_price_mad',l.component_selling_price,'selected',coalesce(s.selected,false)
    ) order by d.day_number,l.sort_order)
      from public.fit_quote_day_cost_lines l
      join public.fit_quote_days d on d.id=l.day_id
      left join public.fit_quote_public_extra_selections s on s.quote_id=l.quote_id and s.line_id=l.id
      where l.quote_id=v_quote.id and l.is_client_visible=true and l.is_optional=true
        and l.included_in_calculation=false and l.component_selling_price>0),'[]'::jsonb),
    'base_total_mad',coalesce(v_quote.total_selling_price_mad,0),
    'selected_extras_total_mad',coalesce((select sum(l.component_selling_price)
      from public.fit_quote_public_extra_selections s join public.fit_quote_day_cost_lines l on l.id=s.line_id
      where s.quote_id=v_quote.id and s.selected=true and l.quote_id=v_quote.id
        and l.is_client_visible=true and l.is_optional=true and l.included_in_calculation=false),0),
    'proposal_total_mad',coalesce(v_quote.total_selling_price_mad,0)+case when v_quote.accepted_snapshot_id is null then coalesce((select sum(l.component_selling_price)
      from public.fit_quote_public_extra_selections s join public.fit_quote_day_cost_lines l on l.id=s.line_id
      where s.quote_id=v_quote.id and s.selected=true and l.quote_id=v_quote.id
        and l.is_client_visible=true and l.is_optional=true and l.included_in_calculation=false),0) else 0 end
  ) into v_result
  from public.partner_organizations p
  where p.id=v_quote.partner_organization_id;

  if v_result is null then
    v_result:=jsonb_build_object(
      'family_reference',coalesce(v_quote.quote_family_reference,v_quote.quote_number),'version_number',coalesce(v_quote.version_number,1),
      'is_current_version',coalesce(v_quote.is_current_version,true),'payment_deadline',v_quote.public_payment_deadline,
      'advisor',jsonb_build_object('name',coalesce(nullif(v_quote.partner_contact_name,''),'LeJapon.ma'),'whatsapp','212711449838'),
      'extras','[]'::jsonb,'base_total_mad',coalesce(v_quote.total_selling_price_mad,0),
      'selected_extras_total_mad',0,'proposal_total_mad',coalesce(v_quote.total_selling_price_mad,0)
    );
    -- Internal FITs can still expose selectable extras without an agency row.
    v_result:=jsonb_set(v_result,'{extras}',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'day_key',d.day_number,'category',l.category,'label',l.label,
      'client_price_mad',l.component_selling_price,'selected',coalesce(s.selected,false)
    ) order by d.day_number,l.sort_order)
      from public.fit_quote_day_cost_lines l join public.fit_quote_days d on d.id=l.day_id
      left join public.fit_quote_public_extra_selections s on s.quote_id=l.quote_id and s.line_id=l.id
      where l.quote_id=v_quote.id and l.is_client_visible=true and l.is_optional=true
        and l.included_in_calculation=false and l.component_selling_price>0),'[]'::jsonb));
    v_result:=v_result||jsonb_build_object(
      'selected_extras_total_mad',coalesce((select sum(l.component_selling_price)
        from public.fit_quote_public_extra_selections s join public.fit_quote_day_cost_lines l on l.id=s.line_id
        where s.quote_id=v_quote.id and s.selected=true and l.quote_id=v_quote.id
          and l.is_client_visible=true and l.is_optional=true and l.included_in_calculation=false),0),
      'proposal_total_mad',coalesce(v_quote.total_selling_price_mad,0)+case when v_quote.accepted_snapshot_id is null then coalesce((select sum(l.component_selling_price)
        from public.fit_quote_public_extra_selections s join public.fit_quote_day_cost_lines l on l.id=s.line_id
        where s.quote_id=v_quote.id and s.selected=true and l.quote_id=v_quote.id
          and l.is_client_visible=true and l.is_optional=true and l.included_in_calculation=false),0) else 0 end
    );
  end if;
  return v_result;
end;
$$;

create or replace function public.set_public_fit_quote_extra_selection_v7(p_token text,p_line_id uuid,p_selected boolean)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_quote public.fit_quotes%rowtype; v_price numeric; v_extra numeric; v_selected jsonb;
begin
  select * into v_quote from public.fit_quotes where id=public._resolve_public_fit_quote_token(p_token) for update;
  if not found then return null; end if;
  if v_quote.commercial_status not in ('sent','viewed','revision_requested') or v_quote.accepted_snapshot_id is not null then
    raise exception 'proposal extras are locked';
  end if;
  select component_selling_price into v_price from public.fit_quote_day_cost_lines
  where id=p_line_id and quote_id=v_quote.id and is_client_visible=true and is_optional=true
    and included_in_calculation=false and component_selling_price>0;
  if not found then raise exception 'extra is not selectable'; end if;
  insert into public.fit_quote_public_extra_selections(quote_id,line_id,selected,selected_at,updated_at)
  values(v_quote.id,p_line_id,coalesce(p_selected,false),case when p_selected then statement_timestamp() end,statement_timestamp())
  on conflict(quote_id,line_id) do update set selected=excluded.selected,
    selected_at=case when excluded.selected then coalesce(public.fit_quote_public_extra_selections.selected_at,statement_timestamp()) end,
    updated_at=statement_timestamp();
  select coalesce(sum(l.component_selling_price),0),coalesce(jsonb_agg(s.line_id) filter(where s.selected),'[]'::jsonb)
  into v_extra,v_selected from public.fit_quote_public_extra_selections s join public.fit_quote_day_cost_lines l on l.id=s.line_id
  where s.quote_id=v_quote.id and s.selected=true and l.quote_id=v_quote.id
    and l.is_client_visible=true and l.is_optional=true and l.included_in_calculation=false;
  insert into public.fit_quote_public_audit_events(quote_id,event,metadata)
  values(v_quote.id,'extra_selection_changed',jsonb_build_object('selected',p_selected,'selected_count',jsonb_array_length(v_selected)));
  return jsonb_build_object('selected_ids',v_selected,'selected_extras_total_mad',v_extra,'proposal_total_mad',coalesce(v_quote.total_selling_price_mad,0)+v_extra);
end;
$$;

create or replace function public.track_public_fit_quote_event_v7(p_token text,p_event text)
returns boolean
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_quote_id uuid;
begin
  if p_event not in ('quote_opened','itinerary_viewed','hotel_viewed','price_viewed','quote_accepted','quote_declined') then return false; end if;
  v_quote_id:=public._resolve_public_fit_quote_token(p_token);
  if v_quote_id is null then return false; end if;
  insert into public.fit_quote_public_audit_events(quote_id,event,metadata)
  values(v_quote_id,p_event,'{}'::jsonb);
  return true;
end;
$$;

create or replace function public.accept_public_fit_quote_v7(p_token text,p_client_confirmation boolean,p_client_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_quote public.fit_quotes%rowtype; v_extra numeric; v_result jsonb; v_selected_extras jsonb;
begin
  select * into v_quote from public.fit_quotes where id=public._resolve_public_fit_quote_token(p_token) for update;
  if not found then return null; end if;
  if v_quote.accepted_snapshot_id is null then
    select coalesce(sum(l.component_selling_price),0) into v_extra
    from public.fit_quote_public_extra_selections s join public.fit_quote_day_cost_lines l on l.id=s.line_id
    where s.quote_id=v_quote.id and s.selected=true and l.quote_id=v_quote.id
      and l.is_client_visible=true and l.is_optional=true and l.included_in_calculation=false;
    if v_extra>0 then
      update public.fit_quotes set total_selling_price_mad=coalesce(total_selling_price_mad,0)+v_extra,
        price_per_person_mad=(coalesce(total_selling_price_mad,0)+v_extra)/greatest(coalesce(travelers_count,1),1),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('accepted_optional_extras_mad',v_extra)
      where id=v_quote.id;
    end if;
  end if;
  v_result:=public.accept_public_fit_quote_v3(p_token,p_client_confirmation,p_client_notes);
  select coalesce(jsonb_agg(jsonb_build_object(
    'line_id',l.id,'day_number',d.day_number,'category',l.category,
    'label',l.label,'client_price_mad',l.component_selling_price
  ) order by d.day_number,l.sort_order),'[]'::jsonb)
  into v_selected_extras
  from public.fit_quote_public_extra_selections s
  join public.fit_quote_day_cost_lines l on l.id=s.line_id
  join public.fit_quote_days d on d.id=l.day_id
  where s.quote_id=v_quote.id and s.selected=true and l.quote_id=v_quote.id
    and l.is_client_visible=true and l.is_optional=true and l.included_in_calculation=false;
  if jsonb_array_length(v_selected_extras)>0 and nullif(v_result->>'acceptance_id','') is not null then
    update public.fit_quote_acceptances
    set selected_public_extras=v_selected_extras
    where id=(v_result->>'acceptance_id')::uuid and selected_public_extras='[]'::jsonb;
  end if;
  return v_result;
end;
$$;

revoke all on function public.get_public_fit_quote_context_v7(text) from public,anon,authenticated;
revoke all on function public.set_public_fit_quote_extra_selection_v7(text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.track_public_fit_quote_event_v7(text,text) from public,anon,authenticated;
revoke all on function public.accept_public_fit_quote_v7(text,boolean,text) from public,anon,authenticated;
grant execute on function public.get_public_fit_quote_context_v7(text) to anon,authenticated;
grant execute on function public.set_public_fit_quote_extra_selection_v7(text,uuid,boolean) to anon,authenticated;
grant execute on function public.track_public_fit_quote_event_v7(text,text) to anon,authenticated;
grant execute on function public.accept_public_fit_quote_v7(text,boolean,text) to anon,authenticated;

notify pgrst,'reload schema';
