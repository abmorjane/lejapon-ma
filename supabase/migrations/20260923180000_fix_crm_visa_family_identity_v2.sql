-- CRM Visa family identity V2.
-- Additive follow-up to the already-applied unified CRM V1 migration.
-- Replaces only identity resolution and Visa synchronization functions.
-- Installing this migration does not backfill or modify historical rows.

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
  v_selected_key text;
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

  -- Select exactly one identity tier. A valid passport is authoritative and
  -- shared family contact details must not create a cross-person conflict.
  if v_passport is not null then
    v_selected_key := 'passport';
    v_candidate_ids := v_passport_ids;
  elsif v_email is not null then
    v_selected_key := 'email';
    v_candidate_ids := v_email_ids;
  elsif v_phone is not null then
    v_selected_key := 'phone';
    v_candidate_ids := v_phone_ids;
  end if;

  if coalesce(array_length(v_candidate_ids, 1), 0) > 0 then
    v_match_types := array[v_selected_key];
  end if;

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
  elsif coalesce(array_length(v_candidate_ids, 1), 0) = 1 then
    v_client_id := v_candidate_ids[1];
    v_resolution := 'matched';
  elsif coalesce(array_length(v_candidate_ids, 1), 0) > 1 then
    v_resolution := 'ambiguous';
  else
    v_resolution := 'created';
  end if;

  v_matched_by := case
    when coalesce(array_length(v_candidate_ids, 1), 0) > 0 then v_selected_key
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
  v_visa_full_name text;
begin
  select * into v_app from public.visa_applications where id = p_application_id;
  if not found then return; end if;

  if auth.uid() is not null
     and v_app.user_id is distinct from auth.uid()
     and not public.is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  v_visa_full_name := nullif(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(pg_catalog.concat_ws(' ', v_app.given_names, v_app.surname)),
      '\s+',
      ' ',
      'g'
    ),
    ''
  );

  -- user_id identifies the Auth account managing the family dossier. Only the
  -- applicant fields on this Visa application identify the CRM person.
  if v_visa_full_name is null
     or (
       public.crm_normalize_passport(v_app.passport_no) is null
       and public.crm_normalize_email(v_app.residential_email) is null
       and public.crm_normalize_phone(coalesce(v_app.residential_mobile, v_app.residential_tel)) is null
     ) then
    return query select null::uuid, false;
    return;
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
    null,
    v_app.id
  );

  if v_result.client_id is not null and v_result.resolution not in ('linked_conflict', 'ambiguous') then
    update public.clients c
    set
      full_name = coalesce(v_visa_full_name, c.full_name),
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

notify pgrst, 'reload schema';
