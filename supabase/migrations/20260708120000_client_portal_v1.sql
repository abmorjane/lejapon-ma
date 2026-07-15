-- Client Portal V1: authenticated travelers can read only their own booking
-- trip context and documents explicitly published by staff.
-- Financial fields are returned only to the booking owner/contact.

alter table public.booking_documents
  add column if not exists visible_to_client boolean not null default false,
  add column if not exists client_visible_at timestamptz,
  add column if not exists visibility_scope text not null default 'booking_participants';

alter table public.booking_documents
  drop constraint if exists booking_documents_visibility_scope_check;

alter table public.booking_documents
  add constraint booking_documents_visibility_scope_check
  check (visibility_scope in ('booking_participants', 'booking_owner_only'));

alter table public.booking_documents
  drop constraint if exists booking_documents_kind_check;

alter table public.booking_documents
  add constraint booking_documents_kind_check
  check (kind in (
    'quote',
    'receipt',
    'invoice',
    'payment',
    'financial',
    'billet_avion',
    'flight_ticket',
    'voucher_hotel',
    'reservation_hotel_extra',
    'reservation_activite_extra',
    'qr_code_japon',
    'visa',
    'assurance',
    'travel_agreement',
    'programme',
    'passeport',
    'autre'
  ));

create or replace function public.booking_document_is_financial(
  _kind text,
  _document_type text default null,
  _title text default null
)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(_kind, '')) in ('quote','receipt','invoice','payment','financial')
    or lower(coalesce(_document_type, '')) in ('quote','receipt','invoice','payment','financial','proforma','deposit','final')
    or lower(coalesce(_title, '')) ~ '(devis|reçu|recu|facture|paiement|payment|receipt|invoice)';
$$;

create or replace function public.set_booking_document_visibility_scope()
returns trigger
language plpgsql
as $$
begin
  if public.booking_document_is_financial(new.kind, new.document_type, new.title) then
    new.visibility_scope := 'booking_owner_only';
  elsif new.visibility_scope is null then
    new.visibility_scope := 'booking_participants';
  end if;

  if new.visible_to_client = true and new.client_visible_at is null then
    new.client_visible_at := now();
  end if;

  if new.visible_to_client = false then
    new.client_visible_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists booking_documents_visibility_scope on public.booking_documents;
create trigger booking_documents_visibility_scope
before insert or update of kind, document_type, title, visible_to_client, visibility_scope
on public.booking_documents
for each row execute function public.set_booking_document_visibility_scope();

update public.booking_documents
set visibility_scope = case
  when public.booking_document_is_financial(kind, document_type, title) then 'booking_owner_only'
  else coalesce(visibility_scope, 'booking_participants')
end;

create index if not exists idx_booking_documents_client_visible
  on public.booking_documents(booking_id, visible_to_client, visibility_scope, created_at desc);

create or replace function public.client_portal_is_booking_owner(_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_user_email as (
    select nullif(lower(trim(auth.email())), '') as email
  )
  select exists (
    select 1
    from public.bookings b
    cross join current_user_email cue
    where b.id = _booking_id
      and cue.email is not null
      and (
        lower(coalesce(b.contact_email, '')) = cue.email
        or exists (
          select 1
          from public.clients c
          where c.id = b.client_id
            and lower(coalesce(c.email, '')) = cue.email
        )
      )
  );
$$;

create or replace function public.client_portal_can_access_booking(_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_user_email as (
    select nullif(lower(trim(auth.email())), '') as email
  )
  select coalesce(public.v2_is_staff(auth.uid()), false)
    or exists (
      select 1
      from public.bookings b
      cross join current_user_email cue
      where b.id = _booking_id
        and cue.email is not null
        and (
          lower(coalesce(b.contact_email, '')) = cue.email
          or exists (
            select 1
            from public.clients c
            where c.id = b.client_id
              and lower(coalesce(c.email, '')) = cue.email
          )
          or exists (
            select 1
            from public.booking_participants p
            where p.booking_id = b.id
              and lower(coalesce(p.email, '')) = cue.email
          )
        )
    );
$$;

grant execute on function public.client_portal_can_access_booking(uuid) to authenticated;
grant execute on function public.client_portal_is_booking_owner(uuid) to authenticated;

drop policy if exists "client portal read own bookings" on public.bookings;

create or replace function public.client_portal_booking_rows()
returns table (
  id uuid,
  reference text,
  trip_id uuid,
  contact_name text,
  contact_email text,
  contact_phone text,
  num_adults integer,
  num_children integer,
  formula text,
  room_type text,
  preferred_dates text,
  total_amount_mad numeric,
  paid_amount_mad numeric,
  status text,
  created_at timestamptz,
  is_booking_owner boolean,
  trip_title text,
  trip_season text,
  trip_destination text,
  trip_start_date date,
  trip_end_date date,
  trip_duration_days integer,
  trip_total_trip_days integer,
  trip_japan_stay_days integer,
  outbound_flight_text text,
  return_flight_text text,
  visa_arrival_flight_number text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.reference,
    b.trip_id,
    case when public.client_portal_is_booking_owner(b.id) then b.contact_name else null end as contact_name,
    case when public.client_portal_is_booking_owner(b.id) then b.contact_email else null end as contact_email,
    case when public.client_portal_is_booking_owner(b.id) then b.contact_phone else null end as contact_phone,
    b.num_adults,
    b.num_children,
    b.formula,
    b.room_type,
    b.preferred_dates,
    case when public.client_portal_is_booking_owner(b.id) then b.total_amount_mad else null end as total_amount_mad,
    case when public.client_portal_is_booking_owner(b.id) then b.paid_amount_mad else null end as paid_amount_mad,
    b.status::text,
    b.created_at,
    public.client_portal_is_booking_owner(b.id) as is_booking_owner,
    t.title,
    t.season,
    t.destination,
    t.start_date,
    t.end_date,
    t.duration_days,
    t.total_trip_days,
    t.japan_stay_days,
    t.outbound_flight_text,
    t.return_flight_text,
    t.visa_arrival_flight_number
  from public.bookings b
  left join public.trips t on t.id = b.trip_id
  where public.client_portal_can_access_booking(b.id);
$$;

grant execute on function public.client_portal_booking_rows() to authenticated;

drop policy if exists "client portal read own booking participants" on public.booking_participants;
create policy "client portal read own booking participants"
on public.booking_participants
for select
using (public.client_portal_can_access_booking(booking_id));

drop policy if exists "client portal read own booking extras" on public.booking_extras;
create policy "client portal read own booking extras"
on public.booking_extras
for select
using (public.client_portal_can_access_booking(booking_id));

drop policy if exists "client portal read own trip hotels" on public.trip_hotels;
create policy "client portal read own trip hotels"
on public.trip_hotels
for select
using (
  exists (
    select 1
    from public.bookings b
    where b.trip_id = trip_hotels.trip_id
      and public.client_portal_can_access_booking(b.id)
  )
);

drop policy if exists "client portal read published booking documents" on public.booking_documents;
create policy "client portal read published booking documents"
on public.booking_documents
for select
using (
  visible_to_client = true
  and public.client_portal_can_access_booking(booking_id)
  and (
    visibility_scope = 'booking_participants'
    or public.client_portal_is_booking_owner(booking_id)
  )
);

drop policy if exists "client portal read own travel agreements" on public.travel_agreements;
create policy "client portal read own travel agreements"
on public.travel_agreements
for select
using (
  (booking_id is not null and public.client_portal_can_access_booking(booking_id))
  or lower(coalesce(client_email, '')) = lower(coalesce(auth.email(), ''))
);

drop policy if exists "client portal read visible booking-docs" on storage.objects;
create policy "client portal read visible booking-docs"
on storage.objects
for select
using (
  bucket_id = 'booking-docs'
  and (
    exists (
      select 1
      from public.booking_documents d
      where d.storage_path = storage.objects.name
        and d.visible_to_client = true
        and public.client_portal_can_access_booking(d.booking_id)
        and (
          d.visibility_scope = 'booking_participants'
          or public.client_portal_is_booking_owner(d.booking_id)
        )
    )
    or exists (
      select 1
      from public.travel_agreements a
      where a.content->'final_pdf'->>'storage_path' = storage.objects.name
        and (
          (a.booking_id is not null and public.client_portal_can_access_booking(a.booking_id))
          or lower(coalesce(a.client_email, '')) = lower(coalesce(auth.email(), ''))
        )
    )
  )
);

create or replace function public.client_portal_add_booking_extra(
  p_booking_id uuid,
  p_extra_id uuid,
  p_qty integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extra public.extras%rowtype;
  v_existing public.booking_extras%rowtype;
  v_qty integer := greatest(coalesce(p_qty, 1), 1);
  v_delta numeric := 0;
  v_booking_status text;
begin
  if not public.client_portal_can_access_booking(p_booking_id) then
    raise exception 'not_allowed';
  end if;

  select status::text into v_booking_status
  from public.bookings
  where id = p_booking_id;

  if v_booking_status is null then
    raise exception 'booking_not_found';
  end if;

  if v_booking_status = 'cancelled' then
    raise exception 'booking_cancelled';
  end if;

  select * into v_extra
  from public.extras
  where id = p_extra_id
    and is_active = true;

  if not found then
    raise exception 'extra_not_found';
  end if;

  select * into v_existing
  from public.booking_extras
  where booking_id = p_booking_id
    and extra_id = p_extra_id
  limit 1;

  v_delta := v_qty * coalesce(v_extra.price_mad, 0);

  if v_existing.id is null then
    insert into public.booking_extras (
      booking_id,
      extra_id,
      name_snapshot,
      qty,
      unit_price_mad
    ) values (
      p_booking_id,
      p_extra_id,
      coalesce(v_extra.name, 'Expérience optionnelle'),
      v_qty,
      coalesce(v_extra.price_mad, 0)
    );
  else
    update public.booking_extras
    set qty = coalesce(qty, 0) + v_qty,
        unit_price_mad = coalesce(v_extra.price_mad, unit_price_mad)
    where id = v_existing.id;
  end if;

  update public.bookings
  set total_amount_mad = coalesce(total_amount_mad, 0) + v_delta,
      updated_at = now()
  where id = p_booking_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'extra_id', p_extra_id,
    'quantity_added', v_qty,
    'amount_added_mad', v_delta
  );
end;
$$;

grant execute on function public.client_portal_add_booking_extra(uuid, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
