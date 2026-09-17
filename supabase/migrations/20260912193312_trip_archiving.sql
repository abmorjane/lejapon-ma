-- Travel OS: manual trip archiving.
-- Archiving is deliberately independent from the trip business status and
-- does not mutate or remove any related operational, supplier or FIT data.

alter table public.trips
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists archive_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trips_archived_by_fkey'
      and conrelid = 'public.trips'::regclass
  ) then
    alter table public.trips
      add constraint trips_archived_by_fkey
      foreign key (archived_by) references auth.users(id) on delete set null;
  end if;
end $$;

create index if not exists idx_trips_active_sort_order
  on public.trips(sort_order, created_at desc)
  where archived_at is null;

create index if not exists idx_trips_active_start_date
  on public.trips(start_date)
  where archived_at is null;

create index if not exists idx_trips_archived_at
  on public.trips(archived_at desc)
  where archived_at is not null;

create index if not exists idx_trips_archived_by
  on public.trips(archived_by)
  where archived_by is not null;

-- Public catalogue access excludes archived trips. Staff and assigned
-- suppliers keep their existing policies and can still open archived records.
drop policy if exists "public read open trips" on public.trips;
create policy "public read open trips"
on public.trips for select
using (
  (archived_at is null and status in ('open', 'completed'))
  or public.is_staff((select auth.uid()))
);

-- Child catalogue rows must follow the same public visibility rule. Assigned
-- suppliers keep explicit access so archived workspaces remain consultable.
drop policy if exists "public read itinerary" on public.itinerary_days;
create policy "public read itinerary"
on public.itinerary_days for select
using (
  exists (
    select 1 from public.trips t
    where t.id = trip_id
      and (
        (t.archived_at is null and t.status in ('open', 'completed'))
        or public.is_staff((select auth.uid()))
        or public.supplier_can_access_trip((select auth.uid()), t.id)
      )
  )
);

drop policy if exists "public read pricing" on public.pricing_tiers;
create policy "public read pricing"
on public.pricing_tiers for select
using (
  exists (
    select 1 from public.trips t
    where t.id = trip_id
      and (
        (t.archived_at is null and t.status in ('open', 'completed'))
        or public.is_staff((select auth.uid()))
        or public.supplier_can_access_trip((select auth.uid()), t.id)
      )
  )
);

-- Some installations assign super_admin without a duplicate admin role.
drop policy if exists "super admins manage trips" on public.trips;
create policy "super admins manage trips"
on public.trips for all
to authenticated
using (public.has_role((select auth.uid()), 'super_admin'))
with check (public.has_role((select auth.uid()), 'super_admin'));

-- Direct writes to the archive columns are guarded as defense in depth. This
-- keeps managers' existing trip-editing policy without granting archive power.
create or replace function public.guard_trip_archive_changes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := (select auth.uid());
begin
  if row(new.archived_at, new.archived_by, new.archive_reason)
       is distinct from row(old.archived_at, old.archived_by, old.archive_reason)
     and current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not (
       actor is not null
       and (
         public.has_role(actor, 'super_admin')
         or public.has_role(actor, 'admin')
       )
     ) then
    raise exception 'trip archive permission denied' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_trip_archive_changes on public.trips;
create trigger guard_trip_archive_changes
before update of archived_at, archived_by, archive_reason on public.trips
for each row execute function public.guard_trip_archive_changes();

revoke all on function public.guard_trip_archive_changes() from public, anon, authenticated;

create or replace function public.archive_trip(
  p_trip_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := (select auth.uid());
  archived_trip public.trips%rowtype;
begin
  if actor is null or not (
    public.has_role(actor, 'super_admin')
    or public.has_role(actor, 'admin')
  ) then
    raise exception 'trip archive permission denied' using errcode = '42501';
  end if;

  update public.trips
  set archived_at = statement_timestamp(),
      archived_by = actor,
      archive_reason = nullif(trim(p_reason), '')
  where id = p_trip_id
    and archived_at is null
  returning * into archived_trip;

  if not found then
    select * into archived_trip from public.trips where id = p_trip_id;
  end if;
  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', archived_trip.id,
    'archived_at', archived_trip.archived_at,
    'archived_by', archived_trip.archived_by,
    'archive_reason', archived_trip.archive_reason
  );
end $$;

create or replace function public.restore_trip(p_trip_id uuid)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := (select auth.uid());
  restored_trip public.trips%rowtype;
begin
  if actor is null or not (
    public.has_role(actor, 'super_admin')
    or public.has_role(actor, 'admin')
  ) then
    raise exception 'trip restore permission denied' using errcode = '42501';
  end if;

  update public.trips
  set archived_at = null,
      archived_by = null,
      archive_reason = null
  where id = p_trip_id
    and archived_at is not null
  returning * into restored_trip;

  if not found then
    select * into restored_trip from public.trips where id = p_trip_id;
  end if;
  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', restored_trip.id,
    'archived_at', restored_trip.archived_at,
    'archived_by', restored_trip.archived_by,
    'archive_reason', restored_trip.archive_reason
  );
end $$;

revoke all on function public.archive_trip(uuid, text) from public, anon;
revoke all on function public.restore_trip(uuid) from public, anon;
grant execute on function public.archive_trip(uuid, text) to authenticated;
grant execute on function public.restore_trip(uuid) to authenticated;

-- Assigned suppliers retain read access to archived workspaces, but no write
-- path (quote RPC, comments, documents, messages or storage) remains open.
create or replace function public.supplier_can_edit_trip(_user_id uuid, _trip_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select _user_id = (select auth.uid())
    and public.supplier_can_access_trip(_user_id, _trip_id)
    and exists (
      select 1 from public.trips t
      where t.id = _trip_id and t.archived_at is null
    )
$$;

revoke all on function public.supplier_can_edit_trip(uuid, uuid) from public, anon;
grant execute on function public.supplier_can_edit_trip(uuid, uuid) to authenticated;

create or replace function public.supplier_can_access_quote(
  _user_id uuid,
  _quote_id uuid,
  _require_editable boolean default false
)
returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
  select _user_id=(select auth.uid()) and exists(
    select 1
    from public.supplier_trip_quotes q
    join public.supplier_members sm on sm.supplier_id=q.supplier_id
    join public.trip_suppliers ts on ts.trip_id=q.trip_id and ts.supplier_id=q.supplier_id
    where q.id=_quote_id and sm.user_id=_user_id and ts.status<>'cancelled'
      and (
        not _require_editable
        or (
          q.status in ('draft','revision_requested')
          and public.supplier_can_edit_trip(_user_id, q.trip_id)
        )
      )
  )
$$;

revoke all on function public.supplier_can_access_quote(uuid,uuid,boolean) from public,anon;
grant execute on function public.supplier_can_access_quote(uuid,uuid,boolean) to authenticated;

create or replace function public.guard_archived_trip_supplier_writes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  actor uuid := (select auth.uid());
  payload jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_trip_id uuid;
  target_quote_id uuid;
  target_message_id uuid;
begin
  if actor is null
     or public.is_staff(actor)
     or public.has_role(actor, 'super_admin')
     or public.has_role(actor, 'admin')
     or not public.has_role(actor, 'supplier') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  target_trip_id := nullif(payload->>'trip_id', '')::uuid;
  target_quote_id := nullif(payload->>'quote_id', '')::uuid;
  target_message_id := nullif(payload->>'message_id', '')::uuid;

  if target_trip_id is null and target_quote_id is not null then
    select q.trip_id into target_trip_id
    from public.supplier_trip_quotes q where q.id = target_quote_id;
  end if;

  if target_trip_id is null and target_message_id is not null then
    select m.trip_id into target_trip_id
    from public.trip_messages m where m.id = target_message_id;
  end if;

  if target_trip_id is not null and exists (
    select 1 from public.trips t
    where t.id = target_trip_id and t.archived_at is not null
  ) then
    raise exception 'archived supplier trip is read only' using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

revoke all on function public.guard_archived_trip_supplier_writes() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'supplier_trip_quotes',
    'supplier_quote_hotel_rows',
    'supplier_quote_transport_rows',
    'supplier_quote_activity_rows',
    'supplier_quote_guide_rows',
    'supplier_quote_other_rows',
    'supplier_quote_comments',
    'trip_messages',
    'trip_message_attachments',
    'trip_message_reads',
    'trip_documents'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists guard_archived_trip_supplier_writes on public.%I', table_name);
      execute format(
        'create trigger guard_archived_trip_supplier_writes before insert or update or delete on public.%I for each row execute function public.guard_archived_trip_supplier_writes()',
        table_name
      );
    end if;
  end loop;
end $$;

drop policy if exists "supplier upload trip document files" on storage.objects;
create policy "supplier upload trip document files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'trip-documents'
  and owner = (select auth.uid())
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_edit_trip((select auth.uid()), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier update own trip document files" on storage.objects;
create policy "supplier update own trip document files"
on storage.objects for update to authenticated
using (
  bucket_id = 'trip-documents' and owner = (select auth.uid())
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_edit_trip((select auth.uid()), ((storage.foldername(name))[1])::uuid)
    else false
  end
)
with check (
  bucket_id = 'trip-documents' and owner = (select auth.uid())
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_edit_trip((select auth.uid()), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier delete own trip document files" on storage.objects;
create policy "supplier delete own trip document files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'trip-documents' and owner = (select auth.uid())
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_edit_trip((select auth.uid()), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier upload trip message attachment files" on storage.objects;
create policy "supplier upload trip message attachment files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'trip-message-attachments' and owner = (select auth.uid())
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_edit_trip((select auth.uid()), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

drop policy if exists "supplier delete own trip message attachment files" on storage.objects;
create policy "supplier delete own trip message attachment files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'trip-message-attachments' and owner = (select auth.uid())
  and case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.supplier_can_edit_trip((select auth.uid()), ((storage.foldername(name))[1])::uuid)
    else false
  end
);

-- Return both active and archived assignments to the supplier UI. The UI owns
-- the active/archive categorisation; the existing assignment isolation remains.
create or replace function public.get_supplier_trip_dashboard()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); result jsonb;
begin
  if actor is null or not public.has_role(actor,'supplier') then
    raise exception 'supplier portal access denied' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'title',x.title,'status',x.trip_status,'start_date',x.start_date,
    'end_date',x.end_date,'duration_days',x.duration_days,'season',x.season,
    'archived_at',x.archived_at,'archive_reason',x.archive_reason,
    'supplier_id',x.supplier_id,'assignment_status',x.assignment_status,
    'participant_count',x.participant_count,'room_count',x.hotel_count,
    'extras_count',x.extras_count,'quote_id',x.quote_id,
    'quote_status',coalesce(x.quote_status,'draft')
  ) order by x.start_date nulls last,x.title),'[]'::jsonb) into result
  from (
    select t.id,t.title,t.status::text trip_status,t.start_date,t.end_date,t.duration_days,t.season,
      t.archived_at,t.archive_reason,ts.supplier_id,ts.status assignment_status,
      (select count(distinct bp.id) from public.booking_participants bp
        left join public.bookings b on b.id=bp.booking_id
        where coalesce(bp.trip_id,b.trip_id)=t.id and (b.id is null or b.status::text<>'cancelled'))::int participant_count,
      (select count(*) from public.trip_hotels th where th.trip_id=t.id)::int hotel_count,
      (select coalesce(sum(be.qty),0) from public.booking_extras be
        join public.bookings b on b.id=be.booking_id where b.trip_id=t.id and b.status::text<>'cancelled')::int extras_count,
      q.id quote_id,q.status quote_status
    from public.trip_suppliers ts
    join public.supplier_members sm on sm.supplier_id=ts.supplier_id and sm.user_id=actor
    join public.trips t on t.id=ts.trip_id
    left join lateral(
      select sq.id,sq.status from public.supplier_trip_quotes sq
      where sq.trip_id=t.id and sq.supplier_id=ts.supplier_id
      order by sq.updated_at desc limit 1
    ) q on true
    where ts.status<>'cancelled'
  ) x;
  return result;
end $$;

revoke all on function public.get_supplier_trip_dashboard() from public,anon;
grant execute on function public.get_supplier_trip_dashboard() to authenticated;

-- Keep FIT V9's own quote archive rules unchanged, but omit a current FIT from
-- the operational Control Tower when its converted booking belongs to an
-- archived group trip.
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
      coalesce((select sum(x.confirmed_cost*x.exchange_rate) filter(where x.confirmed_cost is not null) from public._fit_financial_components_v4(q.id)x),0) confirmed_cost,
      coalesce((select sum(x.final_cost*x.exchange_rate) filter(where x.final_cost is not null) from public._fit_financial_components_v4(q.id)x),0) final_cost,
      coalesce((select sum(case when p.status='received' then p.amount_mad when p.status='refunded' then -p.amount_mad else 0 end) from public.payments p where p.fit_quote_id=q.id or (q.converted_booking_id is not null and p.booking_id=q.converted_booking_id)),0) client_paid,
      (select string_agg(distinct f.pnr,' · ') from public.booking_flight_reservations f where f.booking_id=q.converted_booking_id and nullif(trim(f.pnr),'') is not null) pnr
    from public.fit_quotes q
    left join public.partner_organizations po on po.id=q.partner_organization_id
    left join public.profiles owner_profile on owner_profile.id=coalesce(q.owner_user_id,q.created_by)
    left join public.bookings b on b.id=q.converted_booking_id
    left join public.trips booking_trip on booking_trip.id=b.trip_id
    left join lateral (
      select c.* from public.agency_commission_snapshots c where c.fit_quote_id=q.id and c.is_current=true order by c.created_at desc limit 1
    ) comm on true
    where q.deleted_at is null and q.archived_at is null and coalesce(q.is_current_version,true)=true
      and (b.trip_id is null or booking_trip.archived_at is null)
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

notify pgrst, 'reload schema';
