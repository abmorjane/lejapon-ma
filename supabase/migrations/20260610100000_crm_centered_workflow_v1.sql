alter table public.clients
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists nationality text,
  add column if not exists sex text,
  add column if not exists passport_issue_date date,
  add column if not exists passport_file_path text,
  add column if not exists profession text,
  add column if not exists marital_status text,
  add column if not exists address text;

alter table public.bookings
  add column if not exists client_id uuid references public.clients(id) on delete set null;

alter table public.payments
  add column if not exists client_id uuid references public.clients(id) on delete set null;

alter table public.visa_applications
  add column if not exists client_id uuid references public.clients(id) on delete set null;

alter table public.booking_documents
  add column if not exists document_type text,
  add column if not exists title text,
  add column if not exists file_name text,
  add column if not exists notes text,
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.booking_documents
set
  document_type = coalesce(document_type, kind),
  title = coalesce(title, number),
  file_name = coalesce(file_name, number)
where document_type is null or title is null or file_name is null;

alter table public.booking_documents
  drop constraint if exists booking_documents_kind_check;

alter table public.booking_documents
  add constraint booking_documents_kind_check
  check (kind in ('quote','receipt','billet_avion','reservation_hotel_extra','reservation_activite_extra','assurance','visa','passeport','autre'));

create index if not exists idx_bookings_client_id on public.bookings(client_id);
create index if not exists idx_payments_client_id on public.payments(client_id);
create index if not exists idx_visa_applications_client_id on public.visa_applications(client_id);
create index if not exists idx_booking_documents_kind on public.booking_documents(kind);
create index if not exists idx_booking_documents_document_type on public.booking_documents(document_type);

create or replace function public.find_or_create_client_for_booking(
  _full_name text,
  _email text default null,
  _phone text default null,
  _passport_no text default null,
  _city text default null,
  _source text default 'booking',
  _metadata jsonb default '{}'::jsonb
)
returns table(client_id uuid, was_existing boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  _id uuid;
  _email_clean text := nullif(lower(trim(coalesce(_email, ''))), '');
  _phone_clean text := nullif(regexp_replace(coalesce(_phone, ''), '[^0-9+]', '', 'g'), '');
  _passport_clean text := nullif(upper(regexp_replace(coalesce(_passport_no, ''), '[\s-]+', '', 'g')), '');
  _name_clean text := nullif(regexp_replace(lower(trim(coalesce(_full_name, ''))), '\s+', ' ', 'g'), '');
begin
  if _passport_clean is not null then
    select id into _id from public.clients where upper(regexp_replace(coalesce(passport_number, ''), '[\s-]+', '', 'g')) = _passport_clean limit 1;
  end if;

  if _id is null and _email_clean is not null then
    select id into _id from public.clients where lower(email) = _email_clean limit 1;
  end if;

  if _id is null and _phone_clean is not null then
    select id into _id from public.clients where regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = _phone_clean limit 1;
  end if;

  if _id is null and _name_clean is not null and (_email_clean is not null or _phone_clean is not null) then
    select id into _id
    from public.clients
    where regexp_replace(lower(trim(coalesce(full_name, ''))), '\s+', ' ', 'g') = _name_clean
      and (
        (_email_clean is not null and lower(coalesce(email, '')) = _email_clean)
        or (_phone_clean is not null and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = _phone_clean)
      )
    limit 1;
  end if;

  if _id is not null then
    update public.clients
    set
      full_name = coalesce(nullif(trim(_full_name), ''), full_name),
      email = coalesce(_email_clean, email),
      phone = coalesce(_phone_clean, phone),
      passport_number = coalesce(_passport_clean, passport_number),
      city = coalesce(nullif(trim(coalesce(_city, '')), ''), city),
      source = coalesce(nullif(trim(coalesce(_source, '')), ''), source),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(_metadata, '{}'::jsonb),
      updated_at = now()
    where id = _id;
    return query select _id, true;
    return;
  end if;

  insert into public.clients (full_name, email, phone, passport_number, city, country, source, metadata)
  values (
    coalesce(nullif(trim(_full_name), ''), _email_clean, _phone_clean, 'Client'),
    _email_clean,
    _phone_clean,
    _passport_clean,
    nullif(trim(coalesce(_city, '')), ''),
    'Maroc',
    coalesce(nullif(trim(coalesce(_source, '')), ''), 'booking'),
    coalesce(_metadata, '{}'::jsonb)
  )
  returning id into _id;

  return query select _id, false;
end;
$$;

grant execute on function public.find_or_create_client_for_booking(text,text,text,text,text,text,jsonb) to anon, authenticated;

update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.contact_email is not null
  and lower(c.email) = lower(trim(b.contact_email));

update public.bookings b
set client_id = c.id
from public.clients c
where b.client_id is null
  and b.contact_phone is not null
  and regexp_replace(coalesce(c.phone, ''), '[^0-9+]', '', 'g') = regexp_replace(coalesce(b.contact_phone, ''), '[^0-9+]', '', 'g');

update public.payments p
set client_id = b.client_id
from public.bookings b
where p.client_id is null
  and p.booking_id = b.id
  and b.client_id is not null;

update public.visa_applications v
set client_id = c.id
from public.clients c
where v.client_id is null
  and v.residential_email is not null
  and lower(c.email) = lower(trim(v.residential_email));

update public.visa_applications v
set client_id = c.id
from public.clients c
where v.client_id is null
  and v.passport_no is not null
  and upper(regexp_replace(coalesce(c.passport_number, ''), '[\s-]+', '', 'g')) = upper(regexp_replace(coalesce(v.passport_no, ''), '[\s-]+', '', 'g'));

drop policy if exists "staff update booking_documents" on public.booking_documents;
create policy "staff update booking_documents" on public.booking_documents
  for update using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

notify pgrst, 'reload schema';
