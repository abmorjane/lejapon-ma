-- Phase B / CRM client unifie V1.
-- Centralise le rapprochement par passeport, email puis telephone.
-- Cette migration ne fusionne et ne supprime aucun client existant.

alter table public.booking_participants
  add column if not exists city text;

create or replace function public.crm_normalize_email(value text)
returns text
language sql
immutable
parallel safe
as $$
  with normalized as (
    select nullif(lower(trim(coalesce(value, ''))), '') as email
  )
  select case
    when length(email) <= 320
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then email
    else null
  end
  from normalized;
$$;

create or replace function public.crm_normalize_passport(value text)
returns text
language sql
immutable
parallel safe
as $$
  with normalized as (
    select nullif(upper(regexp_replace(coalesce(value, ''), '[^a-zA-Z0-9]', '', 'g')), '') as passport
  )
  select case
    when length(passport) between 5 and 20 then passport
    else null
  end
  from normalized;
$$;

create or replace function public.crm_normalize_phone(value text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
begin
  if digits = '' then
    return null;
  end if;
  if digits like '00%' then
    digits := substring(digits from 3);
  end if;
  if digits like '2120%' then
    digits := '212' || substring(digits from 5);
  elsif length(digits) = 10 and digits like '0%' then
    digits := '212' || substring(digits from 2);
  elsif length(digits) = 9 and digits ~ '^[5-8]' then
    digits := '212' || digits;
  end if;
  if length(digits) < 7 or length(digits) > 15 then
    return null;
  end if;
  return '+' || digits;
end;
$$;

create or replace function public.crm_safe_date(value text)
returns date
language plpgsql
immutable
parallel safe
as $$
declare
  date_parts text[];
begin
  if nullif(trim(coalesce(value, '')), '') is null then
    return null;
  end if;
  date_parts := regexp_match(trim(value), '^(\d{4})-(\d{2})-(\d{2})$');
  if date_parts is null then
    return null;
  end if;
  return make_date(date_parts[1]::integer, date_parts[2]::integer, date_parts[3]::integer);
exception
  when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    return null;
end;
$$;

revoke all on function public.crm_normalize_email(text) from public, anon, authenticated;
revoke all on function public.crm_normalize_passport(text) from public, anon, authenticated;
revoke all on function public.crm_normalize_phone(text) from public, anon, authenticated;
revoke all on function public.crm_safe_date(text) from public, anon, authenticated;

create index if not exists clients_crm_email_normalized_idx
  on public.clients (public.crm_normalize_email(email))
  where public.crm_normalize_email(email) is not null;

create index if not exists clients_crm_phone_normalized_idx
  on public.clients (public.crm_normalize_phone(phone))
  where public.crm_normalize_phone(phone) is not null;

create index if not exists clients_crm_passport_no_normalized_idx
  on public.clients (public.crm_normalize_passport(passport_no))
  where public.crm_normalize_passport(passport_no) is not null;

create index if not exists clients_crm_passport_number_normalized_idx
  on public.clients (public.crm_normalize_passport(passport_number))
  where public.crm_normalize_passport(passport_number) is not null;

create table if not exists public.crm_identity_conflicts (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  source_record_id uuid,
  candidate_client_ids uuid[] not null default '{}'::uuid[],
  matched_by text[] not null default '{}'::text[],
  normalized_passport text,
  normalized_email text,
  normalized_phone text,
  identity_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  resolution_notes text,
  resolved_client_id uuid references public.clients(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_identity_conflicts_status_check
    check (status in ('pending', 'resolved', 'dismissed')),
  constraint crm_identity_conflicts_candidates_check
    check (coalesce(array_length(candidate_client_ids, 1), 0) > 0)
);

create index if not exists crm_identity_conflicts_status_idx
  on public.crm_identity_conflicts (status, created_at desc);
create index if not exists crm_identity_conflicts_candidates_gin_idx
  on public.crm_identity_conflicts using gin (candidate_client_ids);

alter table public.crm_identity_conflicts enable row level security;
revoke all on table public.crm_identity_conflicts from public, anon;
grant select, insert, update, delete on table public.crm_identity_conflicts to authenticated, service_role;

drop policy if exists "staff read crm identity conflicts" on public.crm_identity_conflicts;
create policy "staff read crm identity conflicts"
on public.crm_identity_conflicts
for select
to authenticated
using (public.is_staff(auth.uid()));

drop policy if exists "staff manage crm identity conflicts" on public.crm_identity_conflicts;
create policy "staff manage crm identity conflicts"
on public.crm_identity_conflicts
for all
to authenticated
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

create or replace function public.resolve_crm_client_identity_v1(
  p_identity jsonb,
  p_source text default 'unknown',
  p_preferred_client_id uuid default null,
  p_source_record_id uuid default null
)
returns table(client_id uuid, resolution text, matched_by text, conflict_id uuid)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_identity jsonb := coalesce(p_identity, '{}'::jsonb);
  v_email text := public.crm_normalize_email(p_identity ->> 'email');
  v_phone text := public.crm_normalize_phone(p_identity ->> 'phone');
  v_passport text := public.crm_normalize_passport(coalesce(p_identity ->> 'passport_no', p_identity ->> 'passport_number'));
  v_passport_ids uuid[] := '{}'::uuid[];
  v_email_ids uuid[] := '{}'::uuid[];
  v_phone_ids uuid[] := '{}'::uuid[];
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_match_types text[] := '{}'::text[];
  v_client_id uuid;
  v_conflict_id uuid;
  v_resolution text;
  v_matched_by text;
  v_name text := nullif(trim(coalesce(p_identity ->> 'full_name', concat_ws(' ', p_identity ->> 'first_name', p_identity ->> 'last_name'))), '');
  v_birthdate date;
  v_lock_key text;
begin
  v_birthdate := public.crm_safe_date(coalesce(v_identity ->> 'birthdate', v_identity ->> 'date_of_birth'));

  if p_preferred_client_id is null and v_passport is null and v_email is null and v_phone is null then
    return query select null::uuid, 'no_identity'::text, null::text, null::uuid;
    return;
  end if;

  -- Serialize concurrent resolutions sharing at least one strong identity key.
  -- Deterministic ordering avoids deadlocks when several keys are present.
  for v_lock_key in
    select identity_key
    from unnest(array[
      case when v_passport is not null then 'passport:' || v_passport end,
      case when v_email is not null then 'email:' || v_email end,
      case when v_phone is not null then 'phone:' || v_phone end
    ]) identity_key
    where identity_key is not null
    order by identity_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lejapon-crm:' || v_lock_key, 0));
  end loop;

  if v_passport is not null then
    select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_passport_ids
    from public.clients c
    where public.crm_normalize_passport(c.passport_no) = v_passport
       or public.crm_normalize_passport(c.passport_number) = v_passport;
  end if;

  if v_email is not null then
    select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_email_ids
    from public.clients c
    where public.crm_normalize_email(c.email) = v_email;
  end if;

  if v_phone is not null then
    select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_phone_ids
    from public.clients c
    where public.crm_normalize_phone(c.phone) = v_phone;
  end if;

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::uuid[])
  into v_candidate_ids
  from (
    select distinct unnest(v_passport_ids || v_email_ids || v_phone_ids) as candidate_id
  ) candidates;

  if coalesce(array_length(v_passport_ids, 1), 0) > 0 then v_match_types := array_append(v_match_types, 'passport'); end if;
  if coalesce(array_length(v_email_ids, 1), 0) > 0 then v_match_types := array_append(v_match_types, 'email'); end if;
  if coalesce(array_length(v_phone_ids, 1), 0) > 0 then v_match_types := array_append(v_match_types, 'phone'); end if;

  if p_preferred_client_id is not null then
    if not exists (select 1 from public.clients where id = p_preferred_client_id) then
      raise exception 'crm_preferred_client_not_found';
    end if;
    v_client_id := p_preferred_client_id;
    if exists (select 1 from unnest(v_candidate_ids) candidate_id where candidate_id <> p_preferred_client_id) then
      v_resolution := 'linked_conflict';
    else
      v_resolution := 'linked';
    end if;
  elsif coalesce(array_length(v_candidate_ids, 1), 0) = 1
    and coalesce(array_length(v_passport_ids, 1), 0) <= 1
    and coalesce(array_length(v_email_ids, 1), 0) <= 1
    and coalesce(array_length(v_phone_ids, 1), 0) <= 1 then
    v_client_id := v_candidate_ids[1];
    v_resolution := 'matched';
  elsif coalesce(array_length(v_candidate_ids, 1), 0) > 1
    or coalesce(array_length(v_passport_ids, 1), 0) > 1
    or coalesce(array_length(v_email_ids, 1), 0) > 1
    or coalesce(array_length(v_phone_ids, 1), 0) > 1 then
    v_resolution := 'ambiguous';
  else
    v_resolution := 'created';
  end if;

  v_matched_by := case
    when coalesce(array_length(v_passport_ids, 1), 0) > 0 then 'passport'
    when coalesce(array_length(v_email_ids, 1), 0) > 0 then 'email'
    when coalesce(array_length(v_phone_ids, 1), 0) > 0 then 'phone'
    else null
  end;

  if v_resolution in ('ambiguous', 'linked_conflict') then
    if v_resolution = 'linked_conflict' and not (p_preferred_client_id = any(v_candidate_ids)) then
      select array_agg(candidate_id order by candidate_id)
      into v_candidate_ids
      from (select distinct unnest(v_candidate_ids || array[p_preferred_client_id]) as candidate_id) ids;
    end if;

    select c.id into v_conflict_id
    from public.crm_identity_conflicts c
    where c.status = 'pending'
      and c.candidate_client_ids = v_candidate_ids
      and c.normalized_passport is not distinct from v_passport
      and c.normalized_email is not distinct from v_email
      and c.normalized_phone is not distinct from v_phone
    order by c.created_at desc
    limit 1;

    if v_conflict_id is null then
      insert into public.crm_identity_conflicts (
        source_kind, source_record_id, candidate_client_ids, matched_by,
        normalized_passport, normalized_email, normalized_phone, identity_snapshot
      ) values (
        coalesce(nullif(trim(p_source), ''), 'unknown'),
        p_source_record_id,
        v_candidate_ids,
        v_match_types,
        v_passport,
        v_email,
        v_phone,
        jsonb_strip_nulls(jsonb_build_object(
          'full_name', v_name,
          'email', v_email,
          'phone', v_phone,
          'passport_no', v_passport
        ))
      ) returning id into v_conflict_id;
    elsif p_source_record_id is not null then
      update public.crm_identity_conflicts
      set source_record_id = coalesce(source_record_id, p_source_record_id),
          updated_at = now()
      where id = v_conflict_id;
    end if;

    if v_resolution = 'ambiguous' then
      return query select null::uuid, v_resolution, coalesce(v_matched_by, 'conflicting_fields'), v_conflict_id;
      return;
    elsif v_resolution = 'linked_conflict' then
      -- Preserve the existing relation and do not copy disputed identity data
      -- into either candidate. Staff must resolve the conflict explicitly.
      return query select v_client_id, v_resolution, coalesce(v_matched_by, 'conflicting_fields'), v_conflict_id;
      return;
    end if;
  end if;

  if v_resolution = 'created' then
    insert into public.clients (
      full_name, email, phone, city, country, passport_number, passport_no,
      nationality, birthdate, date_of_birth, sex, address, profession, marital_status,
      passport_issue_date, passport_expiry, passport_file_path, source, metadata
    ) values (
      coalesce(v_name, v_email, v_phone, v_passport, 'Client'),
      v_email,
      v_phone,
      nullif(trim(v_identity ->> 'city'), ''),
      coalesce(nullif(trim(v_identity ->> 'country'), ''), 'Maroc'),
      v_passport,
      v_passport,
      nullif(trim(v_identity ->> 'nationality'), ''),
      v_birthdate,
      v_birthdate,
      nullif(trim(v_identity ->> 'sex'), ''),
      nullif(trim(v_identity ->> 'address'), ''),
      nullif(trim(v_identity ->> 'profession'), ''),
      nullif(trim(v_identity ->> 'marital_status'), ''),
      public.crm_safe_date(v_identity ->> 'passport_issue_date'),
      public.crm_safe_date(v_identity ->> 'passport_expiry'),
      nullif(trim(v_identity ->> 'passport_file_path'), ''),
      coalesce(nullif(trim(p_source), ''), 'unknown'),
      coalesce(v_identity -> 'metadata', '{}'::jsonb)
    ) returning id into v_client_id;
  else
    update public.clients c
    set
      full_name = case
        when nullif(trim(coalesce(c.full_name, '')), '') is null or c.full_name in ('Client', 'Client visa')
          then coalesce(v_name, c.full_name)
        else c.full_name
      end,
      email = coalesce(nullif(trim(coalesce(c.email, '')), ''), v_email),
      phone = coalesce(nullif(trim(coalesce(c.phone, '')), ''), v_phone),
      city = coalesce(nullif(trim(coalesce(c.city, '')), ''), nullif(trim(v_identity ->> 'city'), '')),
      country = coalesce(nullif(trim(coalesce(c.country, '')), ''), nullif(trim(v_identity ->> 'country'), ''), 'Maroc'),
      passport_number = coalesce(nullif(trim(coalesce(c.passport_number, '')), ''), v_passport),
      passport_no = coalesce(nullif(trim(coalesce(c.passport_no, '')), ''), v_passport),
      nationality = coalesce(nullif(trim(coalesce(c.nationality, '')), ''), nullif(trim(v_identity ->> 'nationality'), '')),
      birthdate = coalesce(c.birthdate, v_birthdate),
      date_of_birth = coalesce(c.date_of_birth, v_birthdate),
      sex = coalesce(nullif(trim(coalesce(c.sex, '')), ''), nullif(trim(v_identity ->> 'sex'), '')),
      address = coalesce(nullif(trim(coalesce(c.address, '')), ''), nullif(trim(v_identity ->> 'address'), '')),
      profession = coalesce(nullif(trim(coalesce(c.profession, '')), ''), nullif(trim(v_identity ->> 'profession'), '')),
      marital_status = coalesce(nullif(trim(coalesce(c.marital_status, '')), ''), nullif(trim(v_identity ->> 'marital_status'), '')),
      passport_issue_date = coalesce(c.passport_issue_date, public.crm_safe_date(v_identity ->> 'passport_issue_date')),
      passport_expiry = coalesce(c.passport_expiry, public.crm_safe_date(v_identity ->> 'passport_expiry')),
      passport_file_path = coalesce(nullif(trim(coalesce(c.passport_file_path, '')), ''), nullif(trim(v_identity ->> 'passport_file_path'), '')),
      source = coalesce(nullif(trim(coalesce(c.source, '')), ''), nullif(trim(p_source), ''), 'unknown'),
      metadata = coalesce(v_identity -> 'metadata', '{}'::jsonb) || coalesce(c.metadata, '{}'::jsonb),
      updated_at = now()
    where c.id = v_client_id;
  end if;

  return query select v_client_id, v_resolution, v_matched_by, v_conflict_id;
end;
$$;

revoke all on function public.resolve_crm_client_identity_v1(jsonb,text,uuid,uuid) from public, anon, authenticated;

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
set search_path = pg_catalog
as $$
declare
  v_result record;
begin
  select * into v_result
  from public.resolve_crm_client_identity_v1(
    jsonb_strip_nulls(jsonb_build_object(
      'full_name', nullif(trim(_full_name), ''),
      'email', _email,
      'phone', _phone,
      'passport_no', _passport_no,
      'city', _city,
      'country', 'Maroc',
      'metadata', coalesce(_metadata, '{}'::jsonb)
    )),
    coalesce(nullif(trim(_source), ''), 'booking'),
    null,
    null
  );
  return query select v_result.client_id, v_result.resolution in ('matched', 'linked', 'linked_conflict');
end;
$$;

revoke all on function public.find_or_create_client_for_booking(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.find_or_create_client_for_booking(text,text,text,text,text,text,jsonb) to anon, authenticated, service_role;

create or replace function public.find_or_create_client_for_participant(
  _full_name text,
  _email text,
  _phone text,
  _passport_no text
)
returns table(client_id uuid, was_existing boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result record;
begin
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  select * into v_result
  from public.resolve_crm_client_identity_v1(
    jsonb_strip_nulls(jsonb_build_object(
      'full_name', nullif(trim(_full_name), ''),
      'email', _email,
      'phone', _phone,
      'passport_no', _passport_no,
      'country', 'Maroc'
    )),
    'booking_participant',
    null,
    null
  );
  return query select v_result.client_id, v_result.resolution = 'matched';
end;
$$;

revoke all on function public.find_or_create_client_for_participant(text,text,text,text) from public, anon;
grant execute on function public.find_or_create_client_for_participant(text,text,text,text) to authenticated, service_role;

create or replace function public.sync_visa_application_to_client(p_application_id uuid)
returns table(client_id uuid, was_existing boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_app public.visa_applications%rowtype;
  v_result record;
  v_metadata jsonb;
begin
  select * into v_app from public.visa_applications where id = p_application_id;
  if not found then return; end if;

  if auth.uid() is not null
     and v_app.user_id is distinct from auth.uid()
     and not public.is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'visa_imported', true,
    'visa_imported_at', now(),
    'visa_last_application_id', v_app.id,
    'visa_reference', v_app.reference,
    'professional_situation', v_app.category,
    'visa_source', 'visa_application',
    'passport_ocr', jsonb_strip_nulls(jsonb_build_object(
      'passport_number', v_app.passport_no,
      'first_name', v_app.given_names,
      'last_name', v_app.surname,
      'birthdate', v_app.date_of_birth,
      'nationality', v_app.nationality,
      'sex', v_app.sex,
      'cin', v_app.national_id_no,
      'passport_issue_date', v_app.passport_date_of_issue,
      'passport_expiry_date', v_app.passport_date_of_expiry,
      'passport_authority', v_app.passport_issuing_authority,
      'profession', v_app.profession,
      'residence_address', v_app.residential_address
    ))
  ));

  select * into v_result
  from public.resolve_crm_client_identity_v1(
    jsonb_strip_nulls(jsonb_build_object(
      'first_name', v_app.given_names,
      'last_name', v_app.surname,
      'email', v_app.residential_email,
      'phone', coalesce(v_app.residential_mobile, v_app.residential_tel),
      'passport_no', v_app.passport_no,
      'nationality', v_app.nationality,
      'birthdate', v_app.date_of_birth,
      'sex', v_app.sex,
      'address', v_app.residential_address,
      'profession', v_app.profession,
      'country', 'Maroc',
      'metadata', v_metadata
    )),
    'visa_application',
    v_app.client_id,
    v_app.id
  );

  if v_result.client_id is not null and v_result.resolution not in ('linked_conflict', 'ambiguous') then
    update public.clients c
    set
      passport_expiry = coalesce(c.passport_expiry, v_app.passport_date_of_expiry),
      passport_issue_date = coalesce(c.passport_issue_date, v_app.passport_date_of_issue),
      national_id_no = coalesce(nullif(trim(coalesce(c.national_id_no, '')), ''), nullif(trim(coalesce(v_app.national_id_no, '')), '')),
      passport_place_of_issue = coalesce(nullif(trim(coalesce(c.passport_place_of_issue, '')), ''), nullif(trim(coalesce(v_app.passport_place_of_issue, '')), '')),
      passport_issuing_authority = coalesce(nullif(trim(coalesce(c.passport_issuing_authority, '')), ''), nullif(trim(coalesce(v_app.passport_issuing_authority, '')), '')),
      marital_status = coalesce(nullif(trim(coalesce(c.marital_status, '')), ''), nullif(trim(coalesce(v_app.marital_status, '')), '')),
      updated_at = now()
    where c.id = v_result.client_id;

  end if;

  if v_result.client_id is not null then
    update public.visa_applications va
    set client_id = v_result.client_id, updated_at = now()
    where va.id = v_app.id and va.client_id is distinct from v_result.client_id;
  end if;

  return query select v_result.client_id, v_result.resolution in ('matched', 'linked', 'linked_conflict');
end;
$$;

revoke all on function public.sync_visa_application_to_client(uuid) from public, anon;
grant execute on function public.sync_visa_application_to_client(uuid) to authenticated, service_role;

create or replace function public.sync_booking_participant_to_crm_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result record;
begin
  if new.client_id is null
     and public.crm_normalize_passport(new.passport_no) is null
     and public.crm_normalize_email(new.email) is null
     and public.crm_normalize_phone(new.phone) is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.client_id is not distinct from old.client_id
     and new.first_name is not distinct from old.first_name
     and new.last_name is not distinct from old.last_name
     and new.email is not distinct from old.email
     and new.phone is not distinct from old.phone
     and new.passport_no is not distinct from old.passport_no
     and new.date_of_birth is not distinct from old.date_of_birth
     and new.nationality is not distinct from old.nationality
     and new.sex is not distinct from old.sex
     and new.profession is not distinct from old.profession
     and new.marital_status is not distinct from old.marital_status
     and new.address is not distinct from old.address
     and new.city is not distinct from old.city
     and new.passport_issue_date is not distinct from old.passport_issue_date
     and new.passport_expiry is not distinct from old.passport_expiry
     and new.passport_file_path is not distinct from old.passport_file_path then
    return new;
  end if;

  select * into v_result
  from public.resolve_crm_client_identity_v1(
    jsonb_strip_nulls(jsonb_build_object(
      'first_name', new.first_name,
      'last_name', new.last_name,
      'email', new.email,
      'phone', new.phone,
      'passport_no', new.passport_no,
      'birthdate', new.date_of_birth,
      'nationality', new.nationality,
      'sex', new.sex,
      'profession', new.profession,
      'marital_status', new.marital_status,
      'address', new.address,
      'city', new.city,
      'passport_issue_date', new.passport_issue_date,
      'passport_expiry', new.passport_expiry,
      'passport_file_path', new.passport_file_path,
      'metadata', jsonb_build_object('last_booking_participant_id', new.id)
    )),
    'booking_participant',
    new.client_id,
    new.id
  );
  if v_result.client_id is not null then new.client_id := v_result.client_id; end if;
  return new;
end;
$$;

revoke all on function public.sync_booking_participant_to_crm_v1() from public, anon, authenticated;

drop trigger if exists booking_participant_crm_identity_v1 on public.booking_participants;
create trigger booking_participant_crm_identity_v1
before insert or update of client_id, first_name, last_name, email, phone, passport_no, date_of_birth, nationality, sex, profession, marital_status, address, city, passport_issue_date, passport_expiry, passport_file_path
on public.booking_participants
for each row execute function public.sync_booking_participant_to_crm_v1();

comment on table public.crm_identity_conflicts is
  'Correspondances CRM ambigues a valider par un membre du staff; aucune fusion automatique.';

notify pgrst, 'reload schema';
