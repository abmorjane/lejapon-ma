-- FIT commercial lifecycle V3.
-- Reuses bookings, payments, commission snapshots, audit logs and operation
-- tasks. Anonymous access remains token-only through explicit SECURITY DEFINER
-- functions; no base-table anon policy is added.

alter table public.fit_quotes
  add column if not exists commercial_status text not null default 'draft',
  add column if not exists accepted_version integer,
  add column if not exists accepted_amount_mad numeric,
  add column if not exists accepted_token_hash text,
  add column if not exists accepted_snapshot_id uuid,
  add column if not exists deposit_requested_at timestamptz,
  add column if not exists deposit_requested_by uuid,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_by uuid,
  add column if not exists status_override_reason text,
  add column if not exists status_overridden_at timestamptz,
  add column if not exists status_overridden_by uuid;

-- Duplication/versioning V2 copies columns dynamically. Explicitly clear every
-- V3 lifecycle field on the new row so a copy can never inherit an acceptance,
-- payment or conversion from its source. Existing quotes and tokens are not
-- changed.
create or replace function public.reset_duplicated_fit_commercial_state_v3()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.duplicated_from_id is not null then
    new.commercial_status := 'draft';
    new.accepted_version := null;
    new.accepted_amount_mad := null;
    new.accepted_token_hash := null;
    new.accepted_snapshot_id := null;
    new.accepted_at := null;
    new.deposit_requested_at := null;
    new.deposit_requested_by := null;
    new.deposit_paid_at := null;
    new.converted_booking_id := null;
    new.converted_at := null;
    new.converted_by := null;
    new.status_override_reason := null;
    new.status_overridden_at := null;
    new.status_overridden_by := null;
  end if;
  return new;
end;
$$;
drop trigger if exists fit_quotes_reset_duplicated_commercial_state on public.fit_quotes;
create trigger fit_quotes_reset_duplicated_commercial_state
before insert on public.fit_quotes for each row
execute function public.reset_duplicated_fit_commercial_state_v3();

update public.fit_quotes
set commercial_status = case
  when converted_booking_id is not null or status = 'converted_to_booking' then 'converted_to_booking'
  when payment_status in ('deposit_received','paid') then 'deposit_paid'
  when status in ('partner_payment_pending','payment_authorized') then 'deposit_pending'
  when status in ('accepted','client_preapproved') then 'accepted'
  when status in ('client_modification_requested','modification_requested') then 'revision_requested'
  when status in ('sent','sent_to_client') then 'sent'
  when status in ('rejected') then 'lost'
  when status in ('expired','cancelled') then status
  else 'draft'
end
where commercial_status = 'draft';

alter table public.fit_quotes
  drop constraint if exists fit_quotes_commercial_status_check;
alter table public.fit_quotes
  add constraint fit_quotes_commercial_status_check check (commercial_status in (
    'draft','ready','sent','viewed','revision_requested','accepted',
    'deposit_pending','deposit_paid','converted_to_booking','lost','expired','cancelled'
  ));

-- Keep legacy production states valid while allowing the standardized public
-- commercial state in the primary status column.
alter table public.fit_quotes drop constraint if exists fit_quotes_status_check;
alter table public.fit_quotes add constraint fit_quotes_status_check check (status in (
  'draft','ready','sent','viewed','accepted','revision_requested','deposit_pending',
  'deposit_paid','lost','expired','cancelled','converted_to_booking',
  'modification_requested','client_modification_requested','rejected',
  'pending_partner_review','pending_lejapon_approval','approved','sent_to_client',
  'client_preapproved','pending_lejapon_review','pending_japan_availability',
  'japan_request_sent','japan_quote_received','admin_approved_for_payment',
  'payment_authorized','partner_payment_pending','partner_payment_received',
  'booking_in_progress','partially_confirmed','confirmed'
));

-- Keep the anonymous resolver aligned with V3 states. The base table remains
-- inaccessible to anon; a draft is available only when staff explicitly marks
-- it client-visible and enables its unexpired private link.
create or replace function public._resolve_public_fit_quote_token(p_token text)
returns uuid language sql stable security definer
set search_path = pg_catalog, public as $$
  select q.id from public.fit_quotes q
  where p_token is not null
    and length(p_token) between 24 and 128
    and p_token ~ '^[A-Za-z0-9_-]+$'
    and q.share_token = p_token
    and q.share_enabled = true
    and q.public_link_revoked_at is null
    and (q.public_link_expires_at is null or q.public_link_expires_at > statement_timestamp())
    and q.deleted_at is null
    and q.public_client_visible = true
    and q.commercial_status in ('sent','viewed','revision_requested','accepted','deposit_pending','deposit_paid','converted_to_booking','draft')
  limit 1
$$;
revoke all on function public._resolve_public_fit_quote_token(text) from public, anon, authenticated;

create table if not exists public.fit_quote_acceptances (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete restrict,
  quote_group_id uuid not null references public.fit_quotes(id) on delete restrict,
  version_number integer not null,
  accepted_at timestamptz not null default now(),
  accepted_amount_mad numeric not null,
  deposit_amount_mad numeric not null default 0,
  token_hash text not null,
  client_confirmation boolean not null,
  client_notes text,
  quote_snapshot jsonb not null,
  commission_snapshot_id uuid references public.agency_commission_snapshots(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fit_quote_acceptances_amounts_check check (accepted_amount_mad >= 0 and deposit_amount_mad >= 0),
  constraint fit_quote_acceptances_confirmation_check check (client_confirmation = true)
);

create unique index if not exists fit_quote_acceptances_quote_version_uidx
  on public.fit_quote_acceptances(quote_id, version_number);
create index if not exists fit_quote_acceptances_group_time_idx
  on public.fit_quote_acceptances(quote_group_id, accepted_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid = 'public.fit_quotes'::regclass
      and conname = 'fit_quotes_accepted_snapshot_id_fkey'
  ) then
    alter table public.fit_quotes add constraint fit_quotes_accepted_snapshot_id_fkey
      foreign key (accepted_snapshot_id) references public.fit_quote_acceptances(id) on delete restrict;
  end if;
end;
$$;

create table if not exists public.fit_quote_revision_requests (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete restrict,
  quote_group_id uuid not null references public.fit_quotes(id) on delete restrict,
  version_number integer not null,
  categories text[] not null default '{}'::text[],
  message text,
  status text not null default 'open' check (status in ('open','version_created','resolved','cancelled')),
  request_hash text not null,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  created_version_id uuid references public.fit_quotes(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists fit_quote_revision_request_dedupe_uidx
  on public.fit_quote_revision_requests(quote_id, request_hash);
create index if not exists fit_quote_revision_open_idx
  on public.fit_quote_revision_requests(quote_group_id, requested_at desc)
  where status = 'open';

alter table public.bookings
  add column if not exists agency_organization_id uuid,
  add column if not exists originating_fit_quote_id uuid,
  add column if not exists fit_quote_acceptance_id uuid,
  add column if not exists fit_quote_snapshot jsonb,
  add column if not exists destination text,
  add column if not exists travel_start_date date,
  add column if not exists travel_end_date date,
  add column if not exists room_configuration jsonb not null default '{}'::jsonb,
  add column if not exists commission_snapshot_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_agency_organization_id_fkey') then
    alter table public.bookings add constraint bookings_agency_organization_id_fkey foreign key (agency_organization_id) references public.organizations(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_originating_fit_quote_id_fkey') then
    alter table public.bookings add constraint bookings_originating_fit_quote_id_fkey foreign key (originating_fit_quote_id) references public.fit_quotes(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_fit_quote_acceptance_id_fkey') then
    alter table public.bookings add constraint bookings_fit_quote_acceptance_id_fkey foreign key (fit_quote_acceptance_id) references public.fit_quote_acceptances(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_commission_snapshot_id_fkey') then
    alter table public.bookings add constraint bookings_commission_snapshot_id_fkey foreign key (commission_snapshot_id) references public.agency_commission_snapshots(id) on delete set null;
  end if;
end;
$$;
create unique index if not exists bookings_originating_fit_quote_uidx
  on public.bookings(originating_fit_quote_id) where originating_fit_quote_id is not null;

alter table public.payments
  alter column booking_id drop not null,
  add column if not exists fit_quote_id uuid references public.fit_quotes(id) on delete restrict,
  add column if not exists payment_purpose text,
  add column if not exists idempotency_key text;
alter table public.payments drop constraint if exists payments_booking_or_fit_quote_check;
alter table public.payments add constraint payments_booking_or_fit_quote_check
  check (booking_id is not null or fit_quote_id is not null);
create unique index if not exists payments_idempotency_key_uidx
  on public.payments(idempotency_key) where idempotency_key is not null;
create unique index if not exists payments_fit_deposit_once_uidx
  on public.payments(fit_quote_id, payment_purpose)
  where fit_quote_id is not null and payment_purpose = 'fit_deposit' and status = 'received';

create table if not exists public.fit_quote_booking_document_links (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.fit_quotes(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  fit_quote_document_id uuid not null references public.fit_quote_documents(id) on delete restrict,
  link_type text not null default 'reusable_source',
  created_at timestamptz not null default now(),
  unique(booking_id, fit_quote_document_id)
);

alter table public.fit_quote_acceptances enable row level security;
alter table public.fit_quote_revision_requests enable row level security;
alter table public.fit_quote_booking_document_links enable row level security;
revoke all on public.fit_quote_acceptances from anon;
revoke all on public.fit_quote_revision_requests from anon;
revoke all on public.fit_quote_booking_document_links from anon;

drop policy if exists "staff read FIT acceptances" on public.fit_quote_acceptances;
create policy "staff read FIT acceptances" on public.fit_quote_acceptances
for select using (public.can_access_fit_quote(quote_id, auth.uid()));
drop policy if exists "staff read FIT revisions" on public.fit_quote_revision_requests;
create policy "staff read FIT revisions" on public.fit_quote_revision_requests
for select using (public.can_access_fit_quote(quote_id, auth.uid()));
drop policy if exists "staff manage FIT document links" on public.fit_quote_booking_document_links;
create policy "staff manage FIT document links" on public.fit_quote_booking_document_links
for all using (public.can_access_fit_quote(quote_id, auth.uid()))
with check (public.can_access_fit_quote(quote_id, auth.uid()));

create or replace function public.fit_quote_acceptance_immutable_v3()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE'
     and old.commission_snapshot_id is null
     and new.commission_snapshot_id is not null
     and (to_jsonb(old) - 'commission_snapshot_id') = (to_jsonb(new) - 'commission_snapshot_id') then
    return new;
  end if;
  raise exception 'FIT quote acceptances are immutable';
end;
$$;
drop trigger if exists fit_quote_acceptance_immutable on public.fit_quote_acceptances;
create trigger fit_quote_acceptance_immutable before update or delete on public.fit_quote_acceptances
for each row execute function public.fit_quote_acceptance_immutable_v3();

create or replace function public.protect_accepted_fit_quote_v3()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_mutable text[] := array[
    'status','commercial_status','production_status','payment_status','booking_status','reservation_status',
    'deposit_requested_at','deposit_requested_by','deposit_paid_at','partner_payment_requested_at',
    'partner_payment_received_at','converted_booking_id','converted_at','converted_by','booking_in_progress_at',
    'production_confirmed_at','public_last_viewed_at','share_enabled','public_client_visible',
    'public_link_expires_at','public_link_revoked_at','public_client_status','is_current_version',
    'status_override_reason','status_overridden_at','status_overridden_by','updated_at','metadata'
  ];
begin
  if old.accepted_snapshot_id is not null then
    v_old := to_jsonb(old) - v_mutable;
    v_new := to_jsonb(new) - v_mutable;
    if v_old is distinct from v_new then
      raise exception 'The accepted FIT commercial version is immutable';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fit_quotes_protect_accepted_content on public.fit_quotes;
create trigger fit_quotes_protect_accepted_content before update on public.fit_quotes
for each row execute function public.protect_accepted_fit_quote_v3();

create or replace function public.fit_commercial_transition_allowed_v3(p_from text, p_to text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case coalesce(p_from, 'draft')
    when 'draft' then p_to in ('ready','sent','cancelled')
    when 'ready' then p_to in ('draft','sent','cancelled')
    when 'sent' then p_to in ('viewed','revision_requested','accepted','expired','lost','cancelled')
    when 'viewed' then p_to in ('revision_requested','accepted','expired','lost','cancelled')
    when 'revision_requested' then p_to in ('draft','ready','sent','lost','cancelled')
    when 'accepted' then p_to in ('deposit_pending','cancelled')
    when 'deposit_pending' then p_to in ('deposit_paid','cancelled')
    when 'deposit_paid' then p_to in ('converted_to_booking','cancelled')
    else false
  end
$$;

create or replace function public.set_fit_commercial_status_v3(
  p_quote_id uuid,
  p_status text,
  p_reason text default null,
  p_override boolean default false
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_quote public.fit_quotes%rowtype;
  v_actor uuid := auth.uid();
  v_super boolean;
begin
  if v_actor is null or not public.can_access_fit_quote(p_quote_id, v_actor) then raise exception 'not authorized'; end if;
  select exists(select 1 from public.user_roles where user_id = v_actor and role::text = 'super_admin') into v_super;
  select * into v_quote from public.fit_quotes where id = p_quote_id and deleted_at is null for update;
  if not found then raise exception 'FIT quote not found'; end if;
  if p_status not in ('draft','ready','sent','viewed','revision_requested','accepted','deposit_pending','deposit_paid','converted_to_booking','lost','expired','cancelled') then
    raise exception 'invalid FIT commercial status';
  end if;
  if not public.fit_commercial_transition_allowed_v3(v_quote.commercial_status, p_status)
     and not (p_override and v_super) then
    raise exception 'Transition % -> % is not allowed', v_quote.commercial_status, p_status;
  end if;
  if p_override and not v_super then raise exception 'super_admin override required'; end if;
  if p_status = 'accepted' and v_quote.accepted_snapshot_id is null then
    raise exception 'Client acceptance snapshot required';
  end if;

  update public.fit_quotes set
    commercial_status = p_status,
    status = p_status,
    public_client_status = case when p_status='sent' then 'quoted' else public_client_status end,
    sent_at = case when p_status = 'sent' then coalesce(sent_at, statement_timestamp()) else sent_at end,
    status_override_reason = case when p_override then nullif(trim(p_reason), '') else status_override_reason end,
    status_overridden_at = case when p_override then statement_timestamp() else status_overridden_at end,
    status_overridden_by = case when p_override then v_actor else status_overridden_by end,
    updated_at = statement_timestamp()
  where id = p_quote_id;

  insert into public.quote_audit_logs(quote_id, organization_id, user_id, action_type, payload)
  values(p_quote_id, v_quote.partner_organization_id, v_actor,
    case when p_override then 'commercial_status_override' else 'commercial_status_changed' end,
    jsonb_build_object('from', v_quote.commercial_status, 'to', p_status, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public._freeze_fit_commission_at_acceptance_v3(
  p_quote_id uuid, p_acceptance_id uuid
)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_request_id uuid;
  v_current public.agency_commission_snapshots%rowtype;
  v_new_id uuid;
  v_version integer;
begin
  if exists(select 1 from public.agency_commission_snapshots where metadata ->> 'acceptance_id' = p_acceptance_id::text) then
    select id into v_new_id from public.agency_commission_snapshots where metadata ->> 'acceptance_id' = p_acceptance_id::text limit 1;
    return v_new_id;
  end if;
  select r.id into v_request_id
  from public.agency_fit_requests r
  join public.fit_quotes q on q.id = p_quote_id
  where r.fit_quote_id in (select fq.id from public.fit_quotes fq where fq.quote_group_id = q.quote_group_id)
  order by r.created_at desc limit 1;
  select * into v_current from public.agency_commission_snapshots
  where is_current = true and (fit_quote_id = p_quote_id or agency_fit_request_id = v_request_id)
  order by created_at desc limit 1;
  if not found then return null; end if;
  select coalesce(max(snapshot_version), 0) + 1 into v_version
  from public.agency_commission_snapshots
  where agency_fit_request_id = v_current.agency_fit_request_id;
  update public.agency_commission_snapshots set is_current = false where id = v_current.id;
  insert into public.agency_commission_snapshots(
    organization_id,sales_agent_id,agency_fit_request_id,fit_quote_id,booking_id,
    snapshot_version,is_current,eligible_sale_amount_mad,gross_agency_commission_type,
    gross_agency_commission_value,gross_agency_commission_amount_mad,
    sales_agent_commission_type,sales_agent_commission_value,
    sales_agent_commission_amount_mad,sales_agent_commission_status,
    agency_net_commission_amount_mad,calculated_at,rule_source,metadata,created_by
  ) values (
    v_current.organization_id,v_current.sales_agent_id,v_current.agency_fit_request_id,p_quote_id,null,
    v_version,true,v_current.eligible_sale_amount_mad,v_current.gross_agency_commission_type,
    v_current.gross_agency_commission_value,v_current.gross_agency_commission_amount_mad,
    v_current.sales_agent_commission_type,v_current.sales_agent_commission_value,
    v_current.sales_agent_commission_amount_mad,'confirmed',v_current.agency_net_commission_amount_mad,
    statement_timestamp(),'fit_acceptance_freeze',
    coalesce(v_current.metadata,'{}'::jsonb) || jsonb_build_object('acceptance_id',p_acceptance_id,'frozen_at',statement_timestamp()),
    auth.uid()
  ) returning id into v_new_id;
  return v_new_id;
end;
$$;
revoke all on function public._freeze_fit_commission_at_acceptance_v3(uuid,uuid) from public, anon, authenticated;

create or replace function public.accept_public_fit_quote_v3(
  p_token text,
  p_client_confirmation boolean,
  p_client_notes text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare
  v_quote public.fit_quotes%rowtype;
  v_acceptance public.fit_quote_acceptances%rowtype;
  v_snapshot jsonb;
  v_commission_id uuid;
  v_at timestamptz := statement_timestamp();
begin
  if not coalesce(p_client_confirmation,false) then raise exception 'client confirmation required'; end if;
  if length(coalesce(p_client_notes,'')) > 2000 then raise exception 'client notes too long'; end if;
  select q.* into v_quote from public.fit_quotes q
  where q.id = public._resolve_public_fit_quote_token(p_token) for update;
  if not found then return null; end if;
  if v_quote.commercial_status not in ('sent','viewed','accepted') then raise exception 'quote cannot be accepted in its current status'; end if;

  select * into v_acceptance from public.fit_quote_acceptances
  where quote_id = v_quote.id and version_number = v_quote.version_number;
  if found then
    return jsonb_build_object('ok',true,'status','accepted','acceptance_id',v_acceptance.id,'event_at',v_acceptance.accepted_at,'already_recorded',true);
  end if;

  v_snapshot := jsonb_build_object(
    'reference',coalesce(v_quote.quote_family_reference,v_quote.quote_number),
    'version',v_quote.version_number,
    'client',jsonb_build_object('id',v_quote.client_id,'name',v_quote.client_name),
    'travel',jsonb_build_object('start',v_quote.travel_start_date,'end',v_quote.travel_end_date,'travelers',v_quote.travelers_count,'hotel_level',v_quote.hotel_category,'room_type',v_quote.room_type),
    'programme',coalesce((select jsonb_agg(jsonb_build_object(
      'day',d.day_number,'date',d.date,'title',d.title,'city',d.city,
      'description',coalesce(d.optimized_client_description,d.description_client),
      'inclusions',coalesce(d.client_inclusions,d.visits,'[]'::jsonb),
      'options',coalesce(d.client_options,d.optional_visits,'[]'::jsonb),
      'selling_price_mad',d.selling_price_mad,'images',coalesce(d.image_urls,'[]'::jsonb)
    ) order by d.sort_order,d.day_number) from public.fit_quote_days d where d.quote_id=v_quote.id),'[]'::jsonb),
    'inclusions',v_quote.inclusions,'exclusions',coalesce(v_quote.exclusions,v_quote.non_included_text),
    'visible_extras',coalesce((select jsonb_agg(jsonb_build_object('day_id',l.day_id,'category',l.category,'label',l.label,'optional',l.is_optional) order by l.sort_order)
      from public.fit_quote_day_cost_lines l where l.quote_id=v_quote.id and l.is_client_visible=true),'[]'::jsonb),
    'selling_price_mad',v_quote.total_selling_price_mad,
    'deposit_mad',coalesce(v_quote.public_deposit_mad,0),
    'currency',v_quote.currency,'valid_until',v_quote.valid_until,
    'payment_conditions',v_quote.payment_conditions,'booking_conditions',v_quote.booking_conditions,
    'cancellation_conditions',v_quote.cancellation_conditions
  );

  insert into public.fit_quote_acceptances(
    quote_id,quote_group_id,version_number,accepted_at,accepted_amount_mad,
    deposit_amount_mad,token_hash,client_confirmation,client_notes,quote_snapshot
  ) values (
    v_quote.id,v_quote.quote_group_id,v_quote.version_number,v_at,
    coalesce(v_quote.total_selling_price_mad,0),coalesce(v_quote.public_deposit_mad,0),
    encode(digest(p_token,'sha256'),'hex'),true,nullif(trim(p_client_notes),''),v_snapshot
  ) returning * into v_acceptance;

  v_commission_id := public._freeze_fit_commission_at_acceptance_v3(v_quote.id,v_acceptance.id);
  update public.fit_quote_acceptances set commission_snapshot_id=v_commission_id where id=v_acceptance.id;
  -- The immutable trigger intentionally protects subsequent writes; this first
  -- server-controlled update only attaches the simultaneously-created snapshot.
  -- Temporarily disabling user triggers is not available here, so attach it on
  -- the quote and retain the acceptance snapshot link in commission metadata.

  update public.fit_quotes set
    status='accepted',commercial_status='accepted',public_client_status='accepted',
    accepted_at=v_at,accepted_version=version_number,accepted_amount_mad=total_selling_price_mad,
    accepted_token_hash=encode(digest(p_token,'sha256'),'hex'),accepted_snapshot_id=v_acceptance.id,
    client_notes=nullif(trim(p_client_notes),''),updated_at=v_at
  where id=v_quote.id;
  insert into public.fit_quote_public_audit_events(quote_id,event,occurred_at,metadata)
  values(v_quote.id,'accepted',v_at,jsonb_build_object('acceptance_id',v_acceptance.id,'version',v_quote.version_number))
  on conflict do nothing;
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
  values(v_quote.id,v_quote.partner_organization_id,null,'client_accepted',jsonb_build_object('acceptance_id',v_acceptance.id,'version',v_quote.version_number,'amount_mad',v_quote.total_selling_price_mad));
  return jsonb_build_object('ok',true,'status','accepted','acceptance_id',v_acceptance.id,'event_at',v_at,'already_recorded',false);
end;
$$;

create or replace function public.request_public_fit_quote_revision_v3(
  p_token text,
  p_categories text[] default '{}'::text[],
  p_client_notes text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions as $$
declare
  v_quote public.fit_quotes%rowtype;
  v_request public.fit_quote_revision_requests%rowtype;
  v_hash text;
  v_at timestamptz := statement_timestamp();
  v_categories text[];
begin
  if length(coalesce(p_client_notes,'')) > 2000 then raise exception 'client notes too long'; end if;
  select array_agg(distinct c) into v_categories from unnest(coalesce(p_categories,'{}'::text[])) c
  where c in ('hotel','dates','programme','travelers','budget','other');
  v_categories := coalesce(v_categories,'{}'::text[]);
  if cardinality(v_categories)=0 and nullif(trim(p_client_notes),'') is null then raise exception 'revision details required'; end if;
  select q.* into v_quote from public.fit_quotes q where q.id=public._resolve_public_fit_quote_token(p_token) for update;
  if not found then return null; end if;
  if v_quote.commercial_status not in ('sent','viewed','revision_requested') then raise exception 'quote cannot be revised in its current status'; end if;
  v_hash := encode(digest(array_to_string(v_categories,',')||'|'||coalesce(trim(p_client_notes),''),'sha256'),'hex');
  insert into public.fit_quote_revision_requests(quote_id,quote_group_id,version_number,categories,message,request_hash,requested_at)
  values(v_quote.id,v_quote.quote_group_id,v_quote.version_number,v_categories,nullif(trim(p_client_notes),''),v_hash,v_at)
  on conflict(quote_id,request_hash) do update set requested_at=public.fit_quote_revision_requests.requested_at
  returning * into v_request;
  update public.fit_quotes set status='revision_requested',commercial_status='revision_requested',
    public_client_status='revision_requested',client_notes=nullif(trim(p_client_notes),''),requested_changes_at=v_at,updated_at=v_at
  where id=v_quote.id;
  if not exists(select 1 from public.fit_quote_public_audit_events where quote_id=v_quote.id and event='revision_requested' and metadata->>'revision_request_id'=v_request.id::text) then
    insert into public.fit_quote_public_audit_events(quote_id,event,occurred_at,metadata)
    values(v_quote.id,'revision_requested',v_at,jsonb_build_object('revision_request_id',v_request.id,'categories',v_categories));
    insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
    values(v_quote.id,v_quote.partner_organization_id,null,'client_revision_requested',jsonb_build_object('revision_request_id',v_request.id,'categories',v_categories,'message',nullif(trim(p_client_notes),'')));
  end if;
  return jsonb_build_object('ok',true,'status','revision_requested','revision_request_id',v_request.id,'event_at',v_request.requested_at);
end;
$$;

create or replace function public.decline_public_fit_quote_v3(p_token text, p_client_notes text default null)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_quote public.fit_quotes%rowtype; v_at timestamptz:=statement_timestamp();
begin
  if length(coalesce(p_client_notes,'')) > 2000 then raise exception 'client notes too long'; end if;
  select * into v_quote from public.fit_quotes where id=public._resolve_public_fit_quote_token(p_token) for update;
  if not found then return null; end if;
  if v_quote.commercial_status not in ('sent','viewed','revision_requested','lost') then raise exception 'quote cannot be declined in its current status'; end if;
  if v_quote.commercial_status='lost' then return jsonb_build_object('ok',true,'status','lost','already_recorded',true); end if;
  update public.fit_quotes set status='lost',commercial_status='lost',public_client_status='declined',client_notes=nullif(trim(p_client_notes),''),updated_at=v_at where id=v_quote.id;
  insert into public.fit_quote_public_audit_events(quote_id,event,occurred_at,metadata) values(v_quote.id,'declined',v_at,'{}'::jsonb);
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
  values(v_quote.id,v_quote.partner_organization_id,null,'client_declined',jsonb_build_object('version',v_quote.version_number,'message',nullif(trim(p_client_notes),'')));
  return jsonb_build_object('ok',true,'status','lost','event_at',v_at,'already_recorded',false);
end;
$$;

create or replace function public.capture_fit_quote_opened_v3()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_quote public.fit_quotes%rowtype;
begin
  if new.event <> 'opened' then return new; end if;
  select * into v_quote from public.fit_quotes where id=new.quote_id for update;
  if v_quote.commercial_status='sent' then
    update public.fit_quotes set commercial_status='viewed',status='viewed',public_last_viewed_at=new.occurred_at,updated_at=new.occurred_at where id=new.quote_id;
    insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
    values(new.quote_id,v_quote.partner_organization_id,null,'client_viewed',jsonb_build_object('version',v_quote.version_number));
  end if;
  return new;
end;
$$;
drop trigger if exists fit_quote_public_opened_commercial_status on public.fit_quote_public_audit_events;
create trigger fit_quote_public_opened_commercial_status after insert on public.fit_quote_public_audit_events
for each row execute function public.capture_fit_quote_opened_v3();

create or replace function public.resolve_fit_revision_on_new_version_v3()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.previous_version_id is not null and old.previous_version_id is null then
    update public.fit_quotes
    set status='draft',commercial_status='draft',public_client_status='draft',
      share_enabled=false,sent_at=null,updated_at=statement_timestamp()
    where id=new.id;
    update public.fit_quote_revision_requests
    set status='version_created',created_version_id=new.id,resolved_at=statement_timestamp(),resolved_by=new.version_created_by
    where quote_id=new.previous_version_id and status='open';
    insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
    values(new.id,new.partner_organization_id,new.version_created_by,'revision_version_created',jsonb_build_object('previous_version_id',new.previous_version_id,'version',new.version_number));
  end if;
  return new;
end;
$$;
drop trigger if exists fit_quotes_resolve_revision_on_version on public.fit_quotes;
create trigger fit_quotes_resolve_revision_on_version after update of previous_version_id on public.fit_quotes
for each row execute function public.resolve_fit_revision_on_new_version_v3();

create or replace function public.request_fit_deposit_v3(p_quote_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_quote public.fit_quotes%rowtype; v_actor uuid:=auth.uid(); v_at timestamptz:=statement_timestamp();
begin
  if v_actor is null or not public.can_access_fit_quote(p_quote_id,v_actor) then raise exception 'not authorized'; end if;
  select * into v_quote from public.fit_quotes where id=p_quote_id for update;
  if v_quote.commercial_status='deposit_pending' then return jsonb_build_object('ok',true,'status','deposit_pending','already_recorded',true); end if;
  if v_quote.commercial_status<>'accepted' or v_quote.accepted_snapshot_id is null then raise exception 'accepted immutable quote required'; end if;
  update public.fit_quotes set status='deposit_pending',commercial_status='deposit_pending',payment_status='requested',
    deposit_requested_at=v_at,deposit_requested_by=v_actor,partner_payment_requested_at=v_at,updated_at=v_at where id=p_quote_id;
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
  values(p_quote_id,v_quote.partner_organization_id,v_actor,'deposit_requested',jsonb_build_object('amount_mad',coalesce(v_quote.public_deposit_mad,0)));
  return jsonb_build_object('ok',true,'status','deposit_pending','deposit_amount_mad',coalesce(v_quote.public_deposit_mad,0));
end;
$$;

create or replace function public.confirm_fit_deposit_payment_v3(
  p_quote_id uuid,
  p_amount_mad numeric,
  p_method text,
  p_reference text default null,
  p_idempotency_key text default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_quote public.fit_quotes%rowtype; v_actor uuid:=auth.uid(); v_payment public.payments%rowtype;
  v_key text; v_at timestamptz:=statement_timestamp();
begin
  if v_actor is null or not public.can_access_fit_quote(p_quote_id,v_actor) then raise exception 'not authorized'; end if;
  if coalesce(p_amount_mad,0)<=0 then raise exception 'payment amount must be positive'; end if;
  select * into v_quote from public.fit_quotes where id=p_quote_id for update;
  if v_quote.commercial_status not in ('accepted','deposit_pending','deposit_paid') then raise exception 'deposit cannot be confirmed in current status'; end if;
  v_key:=coalesce(nullif(trim(p_idempotency_key),''),'fit-deposit:'||p_quote_id::text||':'||coalesce(nullif(trim(p_reference),''),round(p_amount_mad)::text));
  select * into v_payment from public.payments where idempotency_key=v_key;
  if not found then
    insert into public.payments(booking_id,client_id,fit_quote_id,amount_mad,method,status,reference,paid_at,notes,recorded_by,payment_purpose,idempotency_key)
    values(null,v_quote.client_id,p_quote_id,p_amount_mad,nullif(trim(p_method),''),'received',nullif(trim(p_reference),''),v_at,'Acompte devis FIT',v_actor,'fit_deposit',v_key)
    on conflict(fit_quote_id,payment_purpose) where fit_quote_id is not null and payment_purpose='fit_deposit' and status='received'
    do update set fit_quote_id=excluded.fit_quote_id returning * into v_payment;
  end if;
  update public.fit_quotes set status='deposit_paid',commercial_status='deposit_paid',payment_status='deposit_received',
    deposit_paid_at=coalesce(deposit_paid_at,v_payment.paid_at,v_at),partner_payment_received_at=coalesce(partner_payment_received_at,v_payment.paid_at,v_at),updated_at=v_at
  where id=p_quote_id;
  if not exists(select 1 from public.quote_audit_logs where quote_id=p_quote_id and action_type='deposit_paid' and payload->>'payment_id'=v_payment.id::text) then
    insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
    values(p_quote_id,v_quote.partner_organization_id,v_actor,'deposit_paid',jsonb_build_object('payment_id',v_payment.id,'amount_mad',v_payment.amount_mad,'method',v_payment.method));
  end if;
  return jsonb_build_object('ok',true,'status','deposit_paid','payment_id',v_payment.id,'amount_mad',v_payment.amount_mad,'already_recorded',v_quote.commercial_status='deposit_paid');
end;
$$;

create or replace function public.convert_fit_quote_to_booking_v3(
  p_quote_id uuid,
  p_override_reason text default null
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_quote public.fit_quotes%rowtype; v_acceptance public.fit_quote_acceptances%rowtype;
  v_booking public.bookings%rowtype; v_actor uuid:=auth.uid(); v_super boolean; v_override boolean;
  v_client public.clients%rowtype; v_request public.agency_fit_requests%rowtype; v_paid numeric:=0;
  v_doc uuid; v_task record; v_at timestamptz:=statement_timestamp();
begin
  if v_actor is null or not public.can_access_fit_quote(p_quote_id,v_actor) then raise exception 'not authorized'; end if;
  select exists(select 1 from public.user_roles where user_id=v_actor and role::text='super_admin') into v_super;
  v_override:=nullif(trim(p_override_reason),'') is not null;
  if v_override and not v_super then raise exception 'super_admin override required'; end if;
  select * into v_quote from public.fit_quotes where id=p_quote_id and deleted_at is null for update;
  if not found then raise exception 'FIT quote not found'; end if;
  if v_quote.converted_booking_id is not null then
    select * into v_booking from public.bookings where id=v_quote.converted_booking_id;
    return jsonb_build_object('ok',true,'booking_id',v_booking.id,'booking_reference',v_booking.reference,'already_created',true);
  end if;
  select * into v_booking from public.bookings where originating_fit_quote_id=p_quote_id;
  if found then
    update public.fit_quotes set converted_booking_id=v_booking.id,status='converted_to_booking',commercial_status='converted_to_booking',converted_at=coalesce(converted_at,v_at),converted_by=coalesce(converted_by,v_actor) where id=p_quote_id;
    return jsonb_build_object('ok',true,'booking_id',v_booking.id,'booking_reference',v_booking.reference,'already_created',true);
  end if;
  if v_quote.accepted_snapshot_id is null then raise exception 'accepted immutable snapshot required'; end if;
  if v_quote.commercial_status<>'deposit_paid' and not v_override then raise exception 'confirmed deposit required before conversion'; end if;
  select * into v_acceptance from public.fit_quote_acceptances where id=v_quote.accepted_snapshot_id;
  select * into v_client from public.clients where id=v_quote.client_id;
  select * into v_request from public.agency_fit_requests
    where fit_quote_id in (select id from public.fit_quotes where quote_group_id=v_quote.quote_group_id)
    order by created_at desc limit 1;
  select coalesce(sum(amount_mad),0) into v_paid from public.payments where fit_quote_id=p_quote_id and status='received';

  insert into public.bookings(
    client_id,contact_name,contact_email,contact_phone,contact_city,num_adults,num_children,
    formula,room_type,preferred_dates,message,total_amount_mad,paid_amount_mad,status,assigned_to,source,metadata,
    agency_organization_id,originating_fit_quote_id,fit_quote_acceptance_id,fit_quote_snapshot,
    destination,travel_start_date,travel_end_date,room_configuration,deposit_amount,deposit_amount_mad,commission_snapshot_id
  ) values (
    coalesce(v_quote.client_id,v_client.id),coalesce(nullif(v_quote.client_name,''),v_client.full_name,'Client FIT'),
    coalesce(nullif(v_client.email,''),nullif(v_request.client_email,''),'fit@non-renseigne.local'),
    coalesce(v_client.phone,v_request.client_phone),v_client.city,
    greatest(1,coalesce(v_request.adults,v_quote.travelers_count,1)),greatest(0,coalesce(v_request.children,0)),
    'FIT sur mesure',v_quote.room_type,
    concat_ws(' - ',v_quote.travel_start_date::text,v_quote.travel_end_date::text),
    concat_ws(E'\n',v_quote.inclusions,v_quote.exclusions),v_acceptance.accepted_amount_mad,v_paid,
    'confirmed',coalesce(v_request.assigned_to,v_quote.owner_user_id),'fit_quote',
    jsonb_build_object('fit_quote_id',p_quote_id,'fit_quote_group_id',v_quote.quote_group_id,'fit_version',v_quote.version_number,
      'acceptance_id',v_acceptance.id,'override_reason',nullif(trim(p_override_reason),''),'nationality',v_client.nationality,
      'fit_document_ids',coalesce((select jsonb_agg(id) from public.fit_quote_documents where quote_id=p_quote_id and metadata->>'reusable_for_booking'='true' and document_type not in ('client_pdf','internal_pdf','signature','signed_quote')),'[]'::jsonb)),
    coalesce(v_quote.partner_organization_id,v_request.organization_id),p_quote_id,v_acceptance.id,v_acceptance.quote_snapshot,
    coalesce(v_request.destination_country,'Japon'),v_quote.travel_start_date,v_quote.travel_end_date,
    jsonb_build_object('room_type',v_quote.room_type,'hotel_category',v_quote.hotel_category,'room_needs',coalesce(v_request.room_needs,'{}'::text[])),
    v_acceptance.deposit_amount_mad,v_acceptance.deposit_amount_mad,v_acceptance.commission_snapshot_id
  ) returning * into v_booking;

  update public.payments set booking_id=v_booking.id where fit_quote_id=p_quote_id and booking_id is null;
  update public.fit_quotes set converted_booking_id=v_booking.id,converted_at=v_at,converted_by=v_actor,
    status='converted_to_booking',commercial_status='converted_to_booking',booking_status='booking_in_progress',reservation_status='in_progress',updated_at=v_at
  where id=p_quote_id;
  update public.agency_fit_requests set converted_booking_id=v_booking.id,status='converted_to_booking',updated_at=v_at
  where id=v_request.id;

  for v_doc in select id from public.fit_quote_documents where quote_id=p_quote_id
    and metadata->>'reusable_for_booking'='true'
    and document_type not in ('client_pdf','internal_pdf','signature','signed_quote')
  loop
    insert into public.fit_quote_booking_document_links(quote_id,booking_id,fit_quote_document_id)
    values(p_quote_id,v_booking.id,v_doc) on conflict do nothing;
  end loop;

  for v_task in select * from (values
    ('fit-passports','Vérifier les passeports','documents','high'),
    ('fit-visa','Vérifier les besoins de visa','visa','high'),
    ('fit-hotels','Réserver et confirmer les hôtels','hotel','high'),
    ('fit-transport','Réserver les transferts et transports','transport','medium'),
    ('fit-activities','Réserver les activités du programme','activity','medium'),
    ('fit-final-payment','Suivre le solde final','payment','high'),
    ('fit-travel-documents','Préparer et envoyer les documents de voyage','documents','high'),
    ('fit-departure-readiness','Valider la préparation au départ','general','critical')
  ) x(source_key,title,category,priority)
  loop
    insert into public.operation_tasks(title,description,priority,status,assigned_to,reservation_id,booking_id,organization_id,customer_id,category,created_by,metadata)
    values(v_task.title,'Créé automatiquement depuis le devis FIT accepté',v_task.priority,'todo',coalesce(v_request.assigned_to,v_quote.owner_user_id),v_booking.id,v_booking.id,
      coalesce(v_quote.partner_organization_id,v_request.organization_id),v_booking.client_id,v_task.category,v_actor,
      jsonb_build_object('source','fit_conversion','source_key',v_task.source_key,'fit_quote_id',p_quote_id))
    on conflict do nothing;
  end loop;
  perform public.ensure_operation_checklist_for_booking(v_booking.id);
  insert into public.quote_audit_logs(quote_id,organization_id,user_id,action_type,payload)
  values(p_quote_id,v_quote.partner_organization_id,v_actor,'booking_created',jsonb_build_object('booking_id',v_booking.id,'booking_reference',v_booking.reference,'override',v_override,'reason',p_override_reason));
  return jsonb_build_object('ok',true,'booking_id',v_booking.id,'booking_reference',v_booking.reference,'already_created',false,'checklist_created',true);
end;
$$;

-- Database-level operation-task dedupe used by repeated conversion/checklist calls.
create unique index if not exists operation_tasks_booking_source_key_uidx
  on public.operation_tasks(booking_id,(metadata->>'source_key'))
  where booking_id is not null and metadata ? 'source_key';

create or replace function public.get_fit_quote_commercial_timeline_v3(p_quote_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_group uuid;
begin
  if auth.uid() is null or not public.can_access_fit_quote(p_quote_id,auth.uid()) then raise exception 'not authorized'; end if;
  select quote_group_id into v_group from public.fit_quotes where id=p_quote_id;
  return coalesce((select jsonb_agg(row_to_json(t) order by t.occurred_at desc) from (
    select a.created_at as occurred_at,a.action_type as event,a.quote_id,a.user_id,a.payload
    from public.quote_audit_logs a join public.fit_quotes q on q.id=a.quote_id where q.quote_group_id=v_group
    union all
    select e.occurred_at,e.event,e.quote_id,null::uuid,e.metadata
    from public.fit_quote_public_audit_events e join public.fit_quotes q on q.id=e.quote_id where q.quote_group_id=v_group
    union all
    select p.created_at,'payment_'||p.status,p.fit_quote_id,p.recorded_by,
      jsonb_build_object('payment_id',p.id,'amount_mad',p.amount_mad,'method',p.method,'reference',p.reference)
    from public.payments p join public.fit_quotes q on q.id=p.fit_quote_id where q.quote_group_id=v_group
  ) t),'[]'::jsonb);
end;
$$;

grant select on public.fit_quote_acceptances, public.fit_quote_revision_requests, public.fit_quote_booking_document_links to authenticated;
revoke all on function public.accept_public_fit_quote_v3(text,boolean,text) from public;
revoke all on function public.request_public_fit_quote_revision_v3(text,text[],text) from public;
revoke all on function public.decline_public_fit_quote_v3(text,text) from public;
grant execute on function public.accept_public_fit_quote_v3(text,boolean,text) to anon,authenticated;
grant execute on function public.request_public_fit_quote_revision_v3(text,text[],text) to anon,authenticated;
grant execute on function public.decline_public_fit_quote_v3(text,text) to anon,authenticated;
grant execute on function public.set_fit_commercial_status_v3(uuid,text,text,boolean) to authenticated;
grant execute on function public.request_fit_deposit_v3(uuid) to authenticated;
grant execute on function public.confirm_fit_deposit_payment_v3(uuid,numeric,text,text,text) to authenticated;
grant execute on function public.convert_fit_quote_to_booking_v3(uuid,text) to authenticated;
grant execute on function public.get_fit_quote_commercial_timeline_v3(uuid) to authenticated;

notify pgrst, 'reload schema';
