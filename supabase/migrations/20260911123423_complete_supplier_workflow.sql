-- Complete the existing Japan Office / supplier workflow without duplicating
-- its assignment models. Trips keep using trip_suppliers; FIT keeps using
-- fit_supplier_requests.

-- The quote engine was historically shipped as docs/sql/SUPPLIER_QUOTE_ENGINE_V1.sql
-- and then referenced by later migrations. Make the repository migration history
-- self-contained and preserve all production rows with IF NOT EXISTS operations.
alter table public.suppliers
  add column if not exists type text default 'supplier',
  add column if not exists status text not null default 'active',
  add column if not exists country text default 'Japan',
  add column if not exists languages text[] default '{}'::text[],
  add column if not exists website text,
  add column if not exists address text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.supplier_trip_quotes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','submitted','reviewed','approved','revision_requested','rejected','archived')),
  participant_count int not null default 0,
  commission_percentage numeric not null default 10,
  exchange_rate_jpy_mad numeric not null default 0,
  total_hotels_jpy numeric not null default 0,
  total_transport_jpy numeric not null default 0,
  total_activities_jpy numeric not null default 0,
  total_guides_jpy numeric not null default 0,
  total_other_jpy numeric not null default 0,
  grand_total_jpy numeric not null default 0,
  commission_amount_jpy numeric not null default 0,
  final_total_jpy numeric not null default 0,
  final_total_mad numeric not null default 0,
  cost_per_person_jpy numeric not null default 0,
  cost_per_person_mad numeric not null default 0,
  supplier_notes text,
  internal_notes text,
  admin_feedback text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supplier_trip_quotes
  add column if not exists validation_status text not null default 'draft',
  add column if not exists validation_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists validation_metadata jsonb not null default '{}'::jsonb,
  add column if not exists validation_completion_percentage numeric not null default 0,
  add column if not exists validation_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists validation_updated_at timestamptz;

create index if not exists idx_supplier_trip_quotes_trip on public.supplier_trip_quotes(trip_id);
create index if not exists idx_supplier_trip_quotes_supplier on public.supplier_trip_quotes(supplier_id);
create index if not exists idx_supplier_trip_quotes_status on public.supplier_trip_quotes(status);
create index if not exists idx_supplier_trip_quotes_trip_supplier_updated
  on public.supplier_trip_quotes(trip_id,supplier_id,updated_at desc)
  where supplier_id is not null;

create table if not exists public.supplier_quote_hotel_rows (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0, city text, hotel_name text, check_in date, check_out date,
  nights int not null default 1, room_type text, rooms_count int not null default 1,
  unit_price_jpy numeric not null default 0, subtotal_jpy numeric not null default 0,
  comment text, assigned_to text, status text not null default 'todo', updated_at timestamptz not null default now()
);
alter table public.supplier_quote_hotel_rows
  add column if not exists room_count int,
  add column if not exists price_per_room_per_night_jpy numeric;

create table if not exists public.supplier_quote_transport_rows (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0, service_date date, day_number int, city_route text, transport_type text,
  description text, quantity numeric not null default 1, unit_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0, comment text, assigned_to text,
  status text not null default 'todo', updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_activity_rows (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0, service_date date, day_number int, activity_name text,
  participant_count numeric, quantity numeric not null default 1, unit_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0, optional boolean not null default false, comment text, assigned_to text,
  status text not null default 'todo', updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_guide_rows (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0, service_date date, day_number int, city text, guide_type text,
  guides_count int not null default 1, guide_count int, daily_price_jpy numeric not null default 0,
  subtotal_jpy numeric not null default 0, comment text, assigned_to text,
  status text not null default 'todo', updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_other_rows (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  sort_order int not null default 0, label text, quantity numeric not null default 1,
  unit_price_jpy numeric not null default 0, subtotal_jpy numeric not null default 0,
  comment text, assigned_to text, status text not null default 'todo', updated_at timestamptz not null default now()
);

create table if not exists public.supplier_quote_comments (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null references public.supplier_trip_quotes(id) on delete cascade,
  row_table text, row_id uuid, visibility text not null default 'internal', body text not null,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

create index if not exists idx_supplier_quote_hotel_rows_quote on public.supplier_quote_hotel_rows(quote_id,sort_order);
create index if not exists idx_supplier_quote_transport_rows_quote on public.supplier_quote_transport_rows(quote_id,sort_order);
create index if not exists idx_supplier_quote_activity_rows_quote on public.supplier_quote_activity_rows(quote_id,sort_order);
create index if not exists idx_supplier_quote_guide_rows_quote on public.supplier_quote_guide_rows(quote_id,sort_order);
create index if not exists idx_supplier_quote_other_rows_quote on public.supplier_quote_other_rows(quote_id,sort_order);
create index if not exists idx_supplier_quote_comments_quote on public.supplier_quote_comments(quote_id,created_at);

alter table public.supplier_trip_quotes enable row level security;
alter table public.supplier_quote_hotel_rows enable row level security;
alter table public.supplier_quote_transport_rows enable row level security;
alter table public.supplier_quote_activity_rows enable row level security;
alter table public.supplier_quote_guide_rows enable row level security;
alter table public.supplier_quote_other_rows enable row level security;
alter table public.supplier_quote_comments enable row level security;

revoke all on public.supplier_trip_quotes, public.supplier_quote_hotel_rows,
  public.supplier_quote_transport_rows, public.supplier_quote_activity_rows,
  public.supplier_quote_guide_rows, public.supplier_quote_other_rows,
  public.supplier_quote_comments from anon;
grant select,insert,update,delete on public.supplier_trip_quotes,
  public.supplier_quote_hotel_rows, public.supplier_quote_transport_rows,
  public.supplier_quote_activity_rows, public.supplier_quote_guide_rows,
  public.supplier_quote_other_rows, public.supplier_quote_comments to authenticated;

-- trip_suppliers already is the explicit trip assignment table. Extend it with
-- lifecycle/audit fields instead of creating a duplicate supplier_assignments table.
alter table public.trip_suppliers
  add column if not exists assignment_type text not null default 'quote_request',
  add column if not exists status text not null default 'assigned',
  add column if not exists assigned_at timestamptz not null default now(),
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conname='trip_suppliers_status_check'
      and conrelid='public.trip_suppliers'::regclass
  ) then
    alter table public.trip_suppliers add constraint trip_suppliers_status_check
      check(status in ('assigned','in_progress','submitted','revision_requested','approved','cancelled'));
  end if;
end $$;

create index if not exists idx_trip_suppliers_supplier_status
  on public.trip_suppliers(supplier_id,status,assigned_at desc);
create index if not exists idx_supplier_members_user_supplier
  on public.supplier_members(user_id,supplier_id);

-- Keep the existing helper API, but prevent callers from asking for another
-- user's supplier memberships.
create or replace function public.user_supplier_ids(_user_id uuid)
returns setof uuid language sql stable security definer
set search_path=pg_catalog,public as $$
  select sm.supplier_id
  from public.supplier_members sm
  where sm.user_id=_user_id
    and (_user_id=(select auth.uid()) or public.is_staff((select auth.uid())))
$$;
revoke all on function public.user_supplier_ids(uuid) from public,anon;
grant execute on function public.user_supplier_ids(uuid) to authenticated;

create or replace function public.supplier_can_access_trip(_user_id uuid,_trip_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
  select (_user_id=(select auth.uid()) or public.is_staff((select auth.uid())))
    and exists(
      select 1 from public.trip_suppliers ts
      join public.supplier_members sm on sm.supplier_id=ts.supplier_id
      where ts.trip_id=_trip_id and sm.user_id=_user_id
        and ts.status not in ('cancelled')
    )
$$;
revoke all on function public.supplier_can_access_trip(uuid,uuid) from public,anon;
grant execute on function public.supplier_can_access_trip(uuid,uuid) to authenticated;

create or replace function public.supplier_can_access_quote(_user_id uuid,_quote_id uuid,_require_editable boolean default false)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select _user_id=(select auth.uid()) and exists(
    select 1 from public.supplier_trip_quotes q
    join public.supplier_members sm on sm.supplier_id=q.supplier_id
    join public.trip_suppliers ts on ts.trip_id=q.trip_id and ts.supplier_id=q.supplier_id
    where q.id=_quote_id and sm.user_id=_user_id and ts.status<>'cancelled'
      and (not _require_editable or q.status in ('draft','revision_requested'))
  )
$$;
revoke all on function public.supplier_can_access_quote(uuid,uuid,boolean) from public,anon;
grant execute on function public.supplier_can_access_quote(uuid,uuid,boolean) to authenticated;

-- Only documents explicitly shared with the supplier (or uploaded by that
-- supplier) are visible. Existing operational documents remain shared; broad
-- categories such as contracts/other require an explicit admin decision.
alter table public.trip_documents
  add column if not exists supplier_visible boolean not null default false;
create index if not exists idx_trip_documents_authorized_file
  on public.trip_documents(file_path)
  where deleted_at is null and file_path is not null;
update public.trip_documents
set supplier_visible=true
where category in ('hotel_vouchers','transport_vouchers','guide_confirmations','flight_tickets','rooming_lists','emergency_contacts');

drop policy if exists "supplier read accessible trip documents" on public.trip_documents;
drop policy if exists "supplier read authorized trip documents" on public.trip_documents;
create policy "supplier read authorized trip documents" on public.trip_documents
for select to authenticated using(
  deleted_at is null
  and public.supplier_can_access_trip((select auth.uid()),trip_id)
  and (supplier_visible or uploaded_by=(select auth.uid()))
);
drop policy if exists "supplier insert accessible trip documents" on public.trip_documents;
drop policy if exists "supplier insert accessible trip documents v2" on public.trip_documents;
create policy "supplier insert accessible trip documents v2" on public.trip_documents
for insert to authenticated with check(
  uploaded_by=(select auth.uid()) and supplier_visible
  and public.supplier_can_access_trip((select auth.uid()),trip_id)
);
drop policy if exists "supplier update accessible trip documents" on public.trip_documents;
drop policy if exists "supplier update own trip documents" on public.trip_documents;
create policy "supplier update own trip documents" on public.trip_documents
for update to authenticated
using(uploaded_by=(select auth.uid()) and public.supplier_can_access_trip((select auth.uid()),trip_id))
with check(uploaded_by=(select auth.uid()) and supplier_visible and public.supplier_can_access_trip((select auth.uid()),trip_id));

create or replace function public.supplier_can_access_trip_document_file(_user_id uuid,_file_path text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select _user_id=(select auth.uid()) and exists(
    select 1 from public.trip_documents d
    where d.file_path=_file_path and d.deleted_at is null
      and (d.supplier_visible or d.uploaded_by=_user_id)
      and public.supplier_can_access_trip(_user_id,d.trip_id)
  )
$$;
revoke all on function public.supplier_can_access_trip_document_file(uuid,text) from public,anon;
grant execute on function public.supplier_can_access_trip_document_file(uuid,text) to authenticated;

drop policy if exists "supplier read trip document files" on storage.objects;
drop policy if exists "supplier read authorized trip document files" on storage.objects;
create policy "supplier read authorized trip document files" on storage.objects
for select to authenticated using(
  bucket_id='trip-documents'
  and public.supplier_can_access_trip_document_file((select auth.uid()),name)
);

-- Header rows contain admin-only notes, exchange rates and MAD calculations.
-- Suppliers therefore receive a sanitized header through RPC; direct header
-- access remains staff-only. Line tables contain only the supplier's own quote.
drop policy if exists "staff manage supplier_trip_quotes" on public.supplier_trip_quotes;
create policy "staff manage supplier_trip_quotes"
on public.supplier_trip_quotes for all to authenticated
using (public.is_staff((select auth.uid())))
with check (public.is_staff((select auth.uid())));
drop policy if exists "supplier read own supplier_trip_quotes" on public.supplier_trip_quotes;
drop policy if exists "supplier write own supplier_trip_quotes" on public.supplier_trip_quotes;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'supplier_quote_hotel_rows','supplier_quote_transport_rows',
    'supplier_quote_activity_rows','supplier_quote_guide_rows','supplier_quote_other_rows'
  ] loop
    execute format('drop policy if exists %I on public.%I','staff manage '||replace(table_name,'_',' '),table_name);
    execute format('drop policy if exists %I on public.%I','supplier manage own '||replace(table_name,'_',' '),table_name);
    execute format('drop policy if exists %I on public.%I','staff manage '||table_name||' v2',table_name);
    execute format('drop policy if exists %I on public.%I','supplier read own '||table_name||' v2',table_name);
    execute format('drop policy if exists %I on public.%I','supplier insert own '||table_name||' v2',table_name);
    execute format('drop policy if exists %I on public.%I','supplier update own '||table_name||' v2',table_name);
    execute format('drop policy if exists %I on public.%I','supplier delete own '||table_name||' v2',table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff((select auth.uid()))) with check (public.is_staff((select auth.uid())))',
      'staff manage '||table_name||' v2',table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.supplier_can_access_quote((select auth.uid()),quote_id,false))',
      'supplier read own '||table_name||' v2',table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.supplier_can_access_quote((select auth.uid()),quote_id,true))',
      'supplier insert own '||table_name||' v2',table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.supplier_can_access_quote((select auth.uid()),quote_id,true)) with check (public.supplier_can_access_quote((select auth.uid()),quote_id,true))',
      'supplier update own '||table_name||' v2',table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.supplier_can_access_quote((select auth.uid()),quote_id,true))',
      'supplier delete own '||table_name||' v2',table_name
    );
  end loop;
end $$;

drop policy if exists "staff manage supplier_quote_comments" on public.supplier_quote_comments;
drop policy if exists "staff manage supplier_quote_comments v2" on public.supplier_quote_comments;
create policy "staff manage supplier_quote_comments v2" on public.supplier_quote_comments
for all to authenticated using(public.is_staff((select auth.uid()))) with check(public.is_staff((select auth.uid())));
drop policy if exists "supplier read supplier_quote_comments" on public.supplier_quote_comments;
drop policy if exists "supplier read supplier_quote_comments v2" on public.supplier_quote_comments;
create policy "supplier read supplier_quote_comments v2" on public.supplier_quote_comments
for select to authenticated using(
  visibility='supplier' and public.supplier_can_access_quote((select auth.uid()),quote_id,false)
);
drop policy if exists "supplier insert supplier_quote_comments" on public.supplier_quote_comments;
drop policy if exists "supplier insert supplier_quote_comments v2" on public.supplier_quote_comments;
create policy "supplier insert supplier_quote_comments v2" on public.supplier_quote_comments
for insert to authenticated with check(
  visibility='supplier' and created_by=(select auth.uid())
  and public.supplier_can_access_quote((select auth.uid()),quote_id,true)
);

create or replace function public.get_supplier_trip_quote(p_trip_id uuid,p_supplier_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype;
begin
  if actor is null
    or p_supplier_id not in(select public.user_supplier_ids(actor))
    or not public.supplier_can_access_trip(actor,p_trip_id) then
    raise exception 'supplier trip access denied' using errcode='42501';
  end if;
  select * into q from public.supplier_trip_quotes
  where trip_id=p_trip_id and supplier_id=p_supplier_id
  order by updated_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'id',q.id,'trip_id',q.trip_id,'supplier_id',q.supplier_id,'status',q.status,
    'participant_count',q.participant_count,
    'total_hotels_jpy',q.total_hotels_jpy,'total_transport_jpy',q.total_transport_jpy,
    'total_activities_jpy',q.total_activities_jpy,'total_guides_jpy',q.total_guides_jpy,
    'total_other_jpy',q.total_other_jpy,'grand_total_jpy',q.grand_total_jpy,
    'supplier_notes',q.supplier_notes,'admin_feedback',q.admin_feedback,
    'submitted_at',q.submitted_at,'reviewed_at',q.reviewed_at,'approved_at',q.approved_at,
    'validation_status',q.validation_status,'validation_snapshot',q.validation_snapshot,
    'validation_metadata',q.validation_metadata,
    'validation_completion_percentage',q.validation_completion_percentage,
    'validation_updated_at',q.validation_updated_at,'created_at',q.created_at,'updated_at',q.updated_at
  );
end $$;
revoke all on function public.get_supplier_trip_quote(uuid,uuid) from public,anon;
grant execute on function public.get_supplier_trip_quote(uuid,uuid) to authenticated;

create or replace function public.supplier_save_trip_quote_header(
  p_quote_id uuid,p_trip_id uuid,p_supplier_id uuid,p_status text,p_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); q public.supplier_trip_quotes%rowtype; existing_status text;
  requested_validation_status text:=coalesce(nullif(p_payload->>'validation_status',''),'draft');
begin
  if actor is null
    or p_supplier_id not in(select public.user_supplier_ids(actor))
    or not public.supplier_can_access_trip(actor,p_trip_id) then
    raise exception 'supplier trip access denied' using errcode='42501';
  end if;
  if p_status not in ('draft','submitted') then
    raise exception 'supplier status not allowed' using errcode='22023';
  end if;
  if requested_validation_status not in ('draft','in_progress','ready_for_japan_office') then
    raise exception 'supplier validation status not allowed' using errcode='22023';
  end if;

  if p_quote_id is not null then
    select status into existing_status from public.supplier_trip_quotes
    where id=p_quote_id and trip_id=p_trip_id and supplier_id=p_supplier_id for update;
    if not found then raise exception 'supplier quote not found' using errcode='P0002'; end if;
    if existing_status not in ('draft','revision_requested') then
      raise exception 'submitted supplier quote is locked' using errcode='55000';
    end if;
    update public.supplier_trip_quotes set
      status=p_status,
      participant_count=greatest(0,coalesce((p_payload->>'participant_count')::int,participant_count)),
      total_hotels_jpy=greatest(0,coalesce((p_payload->>'total_hotels_jpy')::numeric,total_hotels_jpy)),
      total_transport_jpy=greatest(0,coalesce((p_payload->>'total_transport_jpy')::numeric,total_transport_jpy)),
      total_activities_jpy=greatest(0,coalesce((p_payload->>'total_activities_jpy')::numeric,total_activities_jpy)),
      total_guides_jpy=greatest(0,coalesce((p_payload->>'total_guides_jpy')::numeric,total_guides_jpy)),
      total_other_jpy=greatest(0,coalesce((p_payload->>'total_other_jpy')::numeric,total_other_jpy)),
      grand_total_jpy=greatest(0,coalesce((p_payload->>'grand_total_jpy')::numeric,grand_total_jpy)),
      supplier_notes=nullif(p_payload->>'supplier_notes',''),
      validation_status=case when p_payload ? 'validation_status' then requested_validation_status else validation_status end,
      validation_snapshot=coalesce(p_payload->'validation_snapshot',validation_snapshot),
      validation_metadata=coalesce(p_payload->'validation_metadata',validation_metadata),
      validation_completion_percentage=coalesce((p_payload->>'validation_completion_percentage')::numeric,validation_completion_percentage),
      validation_updated_by=actor,validation_updated_at=statement_timestamp(),updated_by=actor,
      submitted_at=case when p_status='submitted' then statement_timestamp() else submitted_at end,
      updated_at=statement_timestamp()
    where id=p_quote_id returning * into q;
  else
    if exists(
      select 1 from public.supplier_trip_quotes
      where trip_id=p_trip_id and supplier_id=p_supplier_id
    ) then
      raise exception 'supplier quote already exists; quote_id is required' using errcode='23505';
    end if;
    insert into public.supplier_trip_quotes(
      trip_id,supplier_id,status,participant_count,total_hotels_jpy,total_transport_jpy,
      total_activities_jpy,total_guides_jpy,total_other_jpy,grand_total_jpy,supplier_notes,
      validation_status,validation_snapshot,validation_metadata,validation_completion_percentage,
      validation_updated_by,validation_updated_at,created_by,updated_by,submitted_at
    ) values(
      p_trip_id,p_supplier_id,p_status,greatest(0,coalesce((p_payload->>'participant_count')::int,0)),
      greatest(0,coalesce((p_payload->>'total_hotels_jpy')::numeric,0)),
      greatest(0,coalesce((p_payload->>'total_transport_jpy')::numeric,0)),
      greatest(0,coalesce((p_payload->>'total_activities_jpy')::numeric,0)),
      greatest(0,coalesce((p_payload->>'total_guides_jpy')::numeric,0)),
      greatest(0,coalesce((p_payload->>'total_other_jpy')::numeric,0)),
      greatest(0,coalesce((p_payload->>'grand_total_jpy')::numeric,0)),nullif(p_payload->>'supplier_notes',''),
      requested_validation_status,coalesce(p_payload->'validation_snapshot','{}'::jsonb),
      coalesce(p_payload->'validation_metadata','{}'::jsonb),coalesce((p_payload->>'validation_completion_percentage')::numeric,0),
      actor,statement_timestamp(),actor,actor,case when p_status='submitted' then statement_timestamp() end
    ) returning * into q;
  end if;
  return public.get_supplier_trip_quote(p_trip_id,p_supplier_id);
end $$;
revoke all on function public.supplier_save_trip_quote_header(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.supplier_save_trip_quote_header(uuid,uuid,uuid,text,jsonb) to authenticated;

-- A single server-side read supplies the supplier dashboard counters. This
-- avoids granting suppliers direct SELECT access to complete booking rows.
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
    'supplier_id',x.supplier_id,'assignment_status',x.assignment_status,
    'participant_count',x.participant_count,'room_count',x.hotel_count,
    'extras_count',x.extras_count,'quote_id',x.quote_id,
    'quote_status',coalesce(x.quote_status,'draft')
  ) order by x.start_date nulls last,x.title),'[]'::jsonb) into result
  from (
    select t.id,t.title,t.status::text trip_status,t.start_date,t.end_date,t.duration_days,t.season,
      ts.supplier_id,ts.status assignment_status,
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

-- Safe operational projection for one assigned trip. Payment amounts, agency
-- margins, commissions, internal notes, other suppliers and CRM metadata are
-- intentionally absent.
create or replace function public.get_supplier_trip_workspace(p_trip_id uuid,p_supplier_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare actor uuid:=(select auth.uid()); t public.trips%rowtype; result jsonb;
begin
  if actor is null
    or p_supplier_id not in(select public.user_supplier_ids(actor))
    or not exists(select 1 from public.trip_suppliers ts where ts.trip_id=p_trip_id and ts.supplier_id=p_supplier_id and ts.status<>'cancelled') then
    raise exception 'supplier trip access denied' using errcode='42501';
  end if;
  select * into t from public.trips where id=p_trip_id;
  if not found then raise exception 'trip not found' using errcode='P0002'; end if;

  select jsonb_build_object(
    'trip',jsonb_build_object(
      'id',t.id,'title',t.title,'status',t.status,'start_date',t.start_date,'end_date',t.end_date,
      'duration_days',t.duration_days,'season',t.season,'programme_id',t.programme_id,
      'outbound_flight_text',t.outbound_flight_text,'return_flight_text',t.return_flight_text
    ),
    'programme_days',coalesce((select jsonb_agg(to_jsonb(pd) order by pd.day_number,pd.sort_order)
      from public.programme_days pd where pd.programme_id=t.programme_id),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'reference',b.reference,'contact_name',b.contact_name,
      'num_adults',b.num_adults,'num_children',b.num_children,'room_type',b.room_type,
      'formula',b.formula,'status',b.status,'special_requests',b.message,'created_at',b.created_at
    ) order by b.created_at) from public.bookings b where b.trip_id=t.id and b.status::text<>'cancelled'),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(jsonb_build_object(
      'id',bp.id,'booking_id',bp.booking_id,'trip_id',bp.trip_id,'first_name',bp.first_name,
      'last_name',bp.last_name,'sex',bp.sex,'date_of_birth',bp.date_of_birth,
      'passport_no',bp.passport_no,'passport_issue_date',bp.passport_issue_date,
      'passport_expiry',bp.passport_expiry,'client_type',bp.client_type,'is_lead',bp.is_lead
    ) order by bp.last_name,bp.first_name) from public.booking_participants bp
      left join public.bookings b on b.id=bp.booking_id
      where coalesce(bp.trip_id,b.trip_id)=t.id and (b.id is null or b.status::text<>'cancelled')),'[]'::jsonb),
    'hotels',coalesce((select jsonb_agg(jsonb_build_object(
      'id',th.id,'trip_id',th.trip_id,'name',th.name,'city',th.city,'sort_order',th.sort_order,
      'check_in',th.check_in,'check_out',th.check_out,'address',th.address,'phone',th.phone
    ) order by th.sort_order) from public.trip_hotels th where th.trip_id=t.id),'[]'::jsonb),
    'rooms',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'trip_hotel_id',r.trip_hotel_id,'room_number',r.room_number,
      'room_type',r.room_type,'client_type',r.client_type,'capacity',r.capacity,'notes',r.notes
    )) from public.trip_rooms r join public.trip_hotels th on th.id=r.trip_hotel_id where th.trip_id=t.id),'[]'::jsonb),
    'room_assignments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',ra.id,'room_id',ra.room_id,'participant_id',ra.participant_id,'created_at',ra.created_at
    )) from public.room_assignments ra join public.trip_rooms r on r.id=ra.room_id
      join public.trip_hotels th on th.id=r.trip_hotel_id where th.trip_id=t.id),'[]'::jsonb),
    'booking_extras',coalesce((select jsonb_agg(jsonb_build_object(
      'id',be.id,'booking_id',be.booking_id,'extra_id',be.extra_id,'name_snapshot',be.name_snapshot,
      'qty',be.qty,'extras',jsonb_build_object('id',e.id,'name',e.name)
    )) from public.booking_extras be join public.bookings b on b.id=be.booking_id
      left join public.extras e on e.id=be.extra_id where b.trip_id=t.id and b.status::text<>'cancelled'),'[]'::jsonb),
    'extras',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'name',e.name,'slug',e.slug,'category',e.category,'city',e.city
    ) order by e.sort_order) from public.extras e where e.is_active),'[]'::jsonb),
    'participant_activities',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pa.id,'participant_id',pa.participant_id,'extra_id',pa.extra_id,'is_selected',pa.is_selected
    )) from public.booking_participant_activities pa join public.booking_participants bp on bp.id=pa.participant_id
      left join public.bookings b on b.id=bp.booking_id
      where coalesce(bp.trip_id,b.trip_id)=t.id and (b.id is null or b.status::text<>'cancelled')),'[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.get_supplier_trip_workspace(uuid,uuid) from public,anon;
grant execute on function public.get_supplier_trip_workspace(uuid,uuid) to authenticated;

-- Supplier portal notifications. email_delivery_status deliberately starts at
-- pending so an email worker can be added later without changing this contract.
create table if not exists public.supplier_portal_notifications(
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  type text not null,
  title text not null,
  message text,
  entity_type text not null check(entity_type in ('trip','fit_request','supplier_quote')),
  entity_id uuid not null,
  link text,
  dedupe_key text not null unique,
  read_at timestamptz,
  email_delivery_status text not null default 'pending' check(email_delivery_status in ('pending','queued','sent','failed','disabled')),
  email_scheduled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_supplier_portal_notifications_feed
  on public.supplier_portal_notifications(supplier_id,read_at,created_at desc);
alter table public.supplier_portal_notifications enable row level security;
revoke all on public.supplier_portal_notifications from anon;
grant select on public.supplier_portal_notifications to authenticated;
drop policy if exists "supplier reads own portal notifications" on public.supplier_portal_notifications;
create policy "supplier reads own portal notifications" on public.supplier_portal_notifications
for select to authenticated using(supplier_id in(select public.user_supplier_ids((select auth.uid()))));
drop policy if exists "staff manage supplier portal notifications" on public.supplier_portal_notifications;
create policy "staff manage supplier portal notifications" on public.supplier_portal_notifications
for all to authenticated using(public.is_staff((select auth.uid()))) with check(public.is_staff((select auth.uid())));

create or replace function public.mark_supplier_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.supplier_portal_notifications set read_at=coalesce(read_at,statement_timestamp())
  where id=p_notification_id and supplier_id in(select public.user_supplier_ids((select auth.uid())));
  if not found then raise exception 'notification access denied' using errcode='42501'; end if;
end $$;
revoke all on function public.mark_supplier_notification_read(uuid) from public,anon;
grant execute on function public.mark_supplier_notification_read(uuid) to authenticated;

create or replace function public.notify_supplier_trip_assignment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare trip_title text;
begin
  if tg_op='INSERT' or (old.status='cancelled' and new.status<>'cancelled') then
    select title into trip_title from public.trips where id=new.trip_id;
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key
    ) values(
      new.supplier_id,'trip_assigned','Nouveau voyage assigné',
      coalesce(trip_title,'Un voyage')||' est maintenant disponible dans votre portail.',
      'trip',new.trip_id,'/supplier/trips/'||new.trip_id::text||'/quote',
      'trip-assigned:'||new.supplier_id::text||':'||new.trip_id::text
    ) on conflict(dedupe_key) do update set
      title=excluded.title,message=excluded.message,link=excluded.link,read_at=null,
      email_delivery_status='pending',created_at=statement_timestamp();
  end if;
  return new;
end $$;
drop trigger if exists trip_supplier_assignment_notification on public.trip_suppliers;
create trigger trip_supplier_assignment_notification after insert or update of status on public.trip_suppliers
for each row execute function public.notify_supplier_trip_assignment();
revoke all on function public.notify_supplier_trip_assignment() from public,anon,authenticated;

create or replace function public.sync_supplier_quote_assignment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare assignment_status text; notification_type text; notification_title text;
begin
  if new.supplier_id is null then return new; end if;
  assignment_status:=case new.status
    when 'draft' then 'in_progress'
    when 'submitted' then 'submitted'
    when 'reviewed' then 'submitted'
    when 'revision_requested' then 'revision_requested'
    when 'approved' then 'approved'
    when 'rejected' then 'cancelled'
    when 'archived' then 'cancelled'
    else 'assigned' end;
  insert into public.trip_suppliers(trip_id,supplier_id,role,assignment_type,status,assigned_at,assigned_by,updated_at)
  values(new.trip_id,new.supplier_id,'japan_office','quote_request',assignment_status,statement_timestamp(),coalesce(new.created_by,(select auth.uid())),statement_timestamp())
  on conflict(trip_id,supplier_id) do update set
    assignment_type='quote_request',status=excluded.status,updated_at=statement_timestamp();

  if tg_op='UPDATE' and new.status is distinct from old.status and new.status in ('reviewed','revision_requested','approved','rejected') then
    notification_type:='quote_'||new.status;
    notification_title:=case new.status
      when 'reviewed' then 'Devis en cours de revue'
      when 'revision_requested' then 'Correction demandée sur votre devis'
      when 'approved' then 'Devis fournisseur approuvé'
      else 'Devis fournisseur refusé' end;
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key
    ) values(
      new.supplier_id,notification_type,notification_title,nullif(new.admin_feedback,''),
      'supplier_quote',new.id,'/supplier/trips/'||new.trip_id::text||'/quote',
      notification_type||':'||new.id::text||':'||extract(epoch from new.updated_at)::bigint::text
    ) on conflict(dedupe_key) do nothing;
  end if;
  if tg_op='UPDATE' and new.validation_status is distinct from old.validation_status
    and new.validation_status in ('japan_office_confirmed','ready_to_travel') then
    notification_type:='validation_'||new.validation_status;
    notification_title:=case new.validation_status
      when 'japan_office_confirmed' then 'Dossier confirmé par Japan Office'
      else 'Dossier prêt au voyage' end;
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key
    ) values(
      new.supplier_id,notification_type,notification_title,null,
      'supplier_quote',new.id,'/supplier/trips/'||new.trip_id::text||'/quote',
      notification_type||':'||new.id::text||':'||extract(epoch from new.updated_at)::bigint::text
    ) on conflict(dedupe_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists supplier_quote_assignment_sync on public.supplier_trip_quotes;
create trigger supplier_quote_assignment_sync after insert or update of supplier_id,status,validation_status on public.supplier_trip_quotes
for each row execute function public.sync_supplier_quote_assignment();
revoke all on function public.sync_supplier_quote_assignment() from public,anon,authenticated;

create or replace function public.notify_supplier_fit_assignment()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.supplier_id is not null and new.status in ('sent','waiting_supplier')
    and (tg_op='INSERT' or old.supplier_id is distinct from new.supplier_id or old.status is distinct from new.status) then
    insert into public.supplier_portal_notifications(
      supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key
    ) values(
      new.supplier_id,'fit_request_assigned','Nouvelle demande FIT',new.service_label,
      'fit_request',new.id,'/supplier/fit-requests','fit-assigned:'||new.supplier_id::text||':'||new.id::text
    ) on conflict(dedupe_key) do update set
      message=excluded.message,read_at=null,email_delivery_status='pending',created_at=statement_timestamp();
  end if;
  return new;
end $$;
drop trigger if exists fit_supplier_assignment_notification on public.fit_supplier_requests;
create trigger fit_supplier_assignment_notification after insert or update of supplier_id,status on public.fit_supplier_requests
for each row execute function public.notify_supplier_fit_assignment();
revoke all on function public.notify_supplier_fit_assignment() from public,anon,authenticated;

-- Repair only unambiguous historical records: a supplier-less quote is claimed
-- when its trip has exactly one supplier assignment. No existing data is deleted.
with unique_trip_supplier as (
  select trip_id,min(supplier_id::text)::uuid supplier_id
  from public.trip_suppliers where status<>'cancelled'
  group by trip_id having count(*)=1
)
update public.supplier_trip_quotes q set supplier_id=u.supplier_id,updated_at=statement_timestamp()
from unique_trip_supplier u where q.trip_id=u.trip_id and q.supplier_id is null;

insert into public.trip_suppliers(trip_id,supplier_id,role,assignment_type,status,assigned_at,assigned_by,updated_at)
select distinct q.trip_id,q.supplier_id,'japan_office','quote_request',
  case q.status when 'submitted' then 'submitted' when 'revision_requested' then 'revision_requested'
    when 'approved' then 'approved' when 'rejected' then 'cancelled' when 'archived' then 'cancelled' else 'in_progress' end,
  coalesce(q.created_at,statement_timestamp()),q.created_by,statement_timestamp()
from public.supplier_trip_quotes q where q.supplier_id is not null
on conflict(trip_id,supplier_id) do nothing;

insert into public.supplier_portal_notifications(
  supplier_id,type,title,message,entity_type,entity_id,link,dedupe_key,email_delivery_status
)
select ts.supplier_id,'trip_assigned','Voyage assigné',t.title,'trip',ts.trip_id,
  '/supplier/trips/'||ts.trip_id::text||'/quote','trip-assigned:'||ts.supplier_id::text||':'||ts.trip_id::text,'disabled'
from public.trip_suppliers ts join public.trips t on t.id=ts.trip_id
where ts.status<>'cancelled'
on conflict(dedupe_key) do nothing;

-- Explicit grants for the Data API (separate from RLS).
revoke all on public.supplier_portal_notifications from anon;
grant select on public.supplier_members,public.suppliers,public.trip_suppliers,
  public.trip_messages,public.trip_message_attachments,public.trip_message_reads,
  public.trip_documents,public.fit_supplier_requests,public.fit_supplier_request_attachments
to authenticated;

notify pgrst,'reload schema';
