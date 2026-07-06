-- Visa -> CRM synchronization.
-- A visa application contains rich identity/passport data; keep the CRM client
-- record as the canonical profile without overwriting non-empty existing values.

alter table public.clients
  add column if not exists passport_no text,
  add column if not exists date_of_birth date,
  add column if not exists national_id_no text,
  add column if not exists passport_place_of_issue text,
  add column if not exists passport_issuing_authority text;

create index if not exists idx_clients_passport_no_normalized
  on public.clients (upper(regexp_replace(coalesce(passport_no, passport_number, ''), '[\s-]+', '', 'g')));

create index if not exists idx_visa_applications_passport_no_normalized
  on public.visa_applications (upper(regexp_replace(coalesce(passport_no, ''), '[\s-]+', '', 'g')));

create index if not exists idx_visa_applications_residential_email
  on public.visa_applications (lower(residential_email))
  where residential_email is not null and residential_email <> '';

create or replace function public.sync_visa_application_to_client(p_application_id uuid)
returns table(client_id uuid, was_existing boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.visa_applications%rowtype;
  v_client_id uuid;
  v_existing boolean := false;
  v_email text;
  v_phone text;
  v_passport text;
  v_full_name text;
  v_metadata jsonb;
begin
  select * into v_app
  from public.visa_applications
  where id = p_application_id;

  if not found then
    return;
  end if;

  if auth.uid() is not null
     and v_app.user_id is distinct from auth.uid()
     and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  v_email := nullif(lower(trim(coalesce(v_app.residential_email, ''))), '');
  v_phone := nullif(regexp_replace(coalesce(v_app.residential_mobile, v_app.residential_tel, ''), '[^0-9+]', '', 'g'), '');
  v_passport := nullif(upper(regexp_replace(coalesce(v_app.passport_no, ''), '[\s-]+', '', 'g')), '');
  v_full_name := nullif(regexp_replace(trim(concat_ws(' ', v_app.given_names, v_app.surname)), '\s+', ' ', 'g'), '');

  if v_app.client_id is not null then
    v_client_id := v_app.client_id;
    v_existing := true;
  end if;

  if v_client_id is null and v_passport is not null then
    select id into v_client_id
    from public.clients
    where upper(regexp_replace(coalesce(passport_no, passport_number, ''), '[\s-]+', '', 'g')) = v_passport
    order by created_at asc
    limit 1;
  end if;

  if v_client_id is null and v_email is not null then
    select id into v_client_id
    from public.clients
    where lower(coalesce(email, '')) = v_email
    order by created_at asc
    limit 1;
  end if;

  if v_client_id is null and v_phone is not null then
    select id into v_client_id
    from public.clients
    where regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = v_phone
    order by created_at asc
    limit 1;
  end if;

  v_existing := v_client_id is not null;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'visa_imported', true,
    'visa_imported_at', now(),
    'visa_last_application_id', v_app.id,
    'visa_reference', v_app.reference,
    'professional_situation', v_app.category,
    'visa_source', 'visa_application',
    'passport_ocr', jsonb_strip_nulls(jsonb_build_object(
      'passport_number', v_passport,
      'first_name', v_app.given_names,
      'last_name', v_app.surname,
      'birthdate', v_app.date_of_birth,
      'nationality', v_app.nationality,
      'sex', v_app.sex,
      'cin', v_app.national_id_no,
      'national_id_number', v_app.national_id_no,
      'place_of_birth', nullif(trim(concat_ws(', ', v_app.place_of_birth_city, v_app.place_of_birth_state, v_app.place_of_birth_country)), ''),
      'passport_issue_date', v_app.passport_date_of_issue,
      'passport_expiry_date', v_app.passport_date_of_expiry,
      'passport_authority', v_app.passport_issuing_authority,
      'profession', v_app.profession,
      'residence_address', v_app.residential_address
    ))
  ));

  if v_client_id is null then
    insert into public.clients (
      full_name,
      email,
      phone,
      city,
      country,
      birthdate,
      date_of_birth,
      passport_number,
      passport_no,
      passport_expiry,
      passport_issue_date,
      nationality,
      sex,
      profession,
      marital_status,
      address,
      national_id_no,
      passport_place_of_issue,
      passport_issuing_authority,
      source,
      metadata
    )
    values (
      coalesce(v_full_name, v_email, v_phone, v_passport, 'Client visa'),
      v_email,
      v_phone,
      null,
      'Maroc',
      v_app.date_of_birth,
      v_app.date_of_birth,
      v_passport,
      v_passport,
      v_app.passport_date_of_expiry,
      v_app.passport_date_of_issue,
      nullif(trim(coalesce(v_app.nationality, '')), ''),
      nullif(trim(coalesce(v_app.sex, '')), ''),
      nullif(trim(coalesce(v_app.profession, '')), ''),
      nullif(trim(coalesce(v_app.marital_status, '')), ''),
      nullif(trim(coalesce(v_app.residential_address, '')), ''),
      nullif(trim(coalesce(v_app.national_id_no, '')), ''),
      nullif(trim(coalesce(v_app.passport_place_of_issue, '')), ''),
      nullif(trim(coalesce(v_app.passport_issuing_authority, '')), ''),
      'visa_form',
      v_metadata
    )
    returning id into v_client_id;
  else
    update public.clients c
    set
      full_name = case
        when nullif(trim(coalesce(c.full_name, '')), '') is null or c.full_name = 'Client' then coalesce(v_full_name, c.full_name)
        else c.full_name
      end,
      email = coalesce(nullif(trim(coalesce(c.email, '')), ''), v_email),
      phone = coalesce(nullif(trim(coalesce(c.phone, '')), ''), v_phone),
      country = coalesce(nullif(trim(coalesce(c.country, '')), ''), 'Maroc'),
      birthdate = coalesce(c.birthdate, v_app.date_of_birth),
      date_of_birth = coalesce(c.date_of_birth, v_app.date_of_birth),
      passport_number = coalesce(nullif(trim(coalesce(c.passport_number, '')), ''), v_passport),
      passport_no = coalesce(nullif(trim(coalesce(c.passport_no, '')), ''), v_passport),
      passport_expiry = coalesce(c.passport_expiry, v_app.passport_date_of_expiry),
      passport_issue_date = coalesce(c.passport_issue_date, v_app.passport_date_of_issue),
      nationality = coalesce(nullif(trim(coalesce(c.nationality, '')), ''), nullif(trim(coalesce(v_app.nationality, '')), '')),
      sex = coalesce(nullif(trim(coalesce(c.sex, '')), ''), nullif(trim(coalesce(v_app.sex, '')), '')),
      profession = coalesce(nullif(trim(coalesce(c.profession, '')), ''), nullif(trim(coalesce(v_app.profession, '')), '')),
      marital_status = coalesce(nullif(trim(coalesce(c.marital_status, '')), ''), nullif(trim(coalesce(v_app.marital_status, '')), '')),
      address = coalesce(nullif(trim(coalesce(c.address, '')), ''), nullif(trim(coalesce(v_app.residential_address, '')), '')),
      national_id_no = coalesce(nullif(trim(coalesce(c.national_id_no, '')), ''), nullif(trim(coalesce(v_app.national_id_no, '')), '')),
      passport_place_of_issue = coalesce(nullif(trim(coalesce(c.passport_place_of_issue, '')), ''), nullif(trim(coalesce(v_app.passport_place_of_issue, '')), '')),
      passport_issuing_authority = coalesce(nullif(trim(coalesce(c.passport_issuing_authority, '')), ''), nullif(trim(coalesce(v_app.passport_issuing_authority, '')), '')),
      source = coalesce(nullif(trim(coalesce(c.source, '')), ''), 'visa_form'),
      metadata = coalesce(c.metadata, '{}'::jsonb) || v_metadata,
      updated_at = now()
    where c.id = v_client_id;
  end if;

  update public.visa_applications va
  set client_id = v_client_id,
      updated_at = now()
  where va.id = v_app.id
    and (va.client_id is distinct from v_client_id);

  return query select v_client_id, v_existing;
end;
$$;

grant execute on function public.sync_visa_application_to_client(uuid) to authenticated;

do $$
declare
  v_row record;
begin
  for v_row in
    select id
    from public.visa_applications
    where client_id is null
       or passport_no is not null
       or residential_email is not null
  loop
    perform public.sync_visa_application_to_client(v_row.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
