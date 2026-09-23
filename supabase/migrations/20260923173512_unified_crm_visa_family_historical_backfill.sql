-- Controlled historical repair for Visa family accounts.
-- Applying this migration only installs the preview/apply function. It does not
-- update production data until an authorized operator calls it with true.

create or replace function public.backfill_visa_family_crm_v1(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_app record;
  v_signup record;
  v_passport text;
  v_full_name text;
  v_candidate_ids uuid[];
  v_target_client_id uuid;
  v_client_count integer;
  v_application_count integer;
  v_relinks integer := 0;
  v_name_repairs integer := 0;
  v_conflicts integer := 0;
  v_signup_candidates integer := 0;
begin
  if auth.uid() is not null and not public.is_staff(auth.uid()) then
    raise exception 'not_allowed';
  end if;

  for v_app in
    select
      va.id,
      va.client_id,
      va.given_names,
      va.surname,
      va.passport_no,
      va.residential_email,
      coalesce(va.residential_mobile, va.residential_tel) as residential_phone
    from public.visa_applications va
    where public.crm_normalize_passport(va.passport_no) is not null
    order by va.created_at, va.id
  loop
    v_passport := public.crm_normalize_passport(v_app.passport_no);
    v_full_name := nullif(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(pg_catalog.concat_ws(' ', v_app.given_names, v_app.surname)),
        '\s+',
        ' ',
        'g'
      ),
      ''
    );

    select
      coalesce(pg_catalog.array_agg(distinct c.id order by c.id), '{}'::uuid[]),
      count(distinct c.id)::integer
    into v_candidate_ids, v_client_count
    from public.clients c
    where public.crm_normalize_passport(c.passport_no) = v_passport
       or public.crm_normalize_passport(c.passport_number) = v_passport;

    select count(*)::integer
    into v_application_count
    from public.visa_applications va
    where public.crm_normalize_passport(va.passport_no) = v_passport;

    if v_client_count = 1 and v_application_count = 1 then
      v_target_client_id := v_candidate_ids[1];

      if v_app.client_id is distinct from v_target_client_id then
        v_relinks := v_relinks + 1;
        if p_apply then
          update public.visa_applications
          set client_id = v_target_client_id,
              updated_at = now()
          where id = v_app.id;
        end if;
      end if;

      if v_full_name is not null and exists (
        select 1
        from public.clients c
        where c.id = v_target_client_id
          and c.source = 'visa_form'
          and c.full_name is distinct from v_full_name
      ) then
        v_name_repairs := v_name_repairs + 1;
        if p_apply then
          update public.clients
          set full_name = v_full_name,
              updated_at = now()
          where id = v_target_client_id
            and source = 'visa_form';
        end if;
      end if;
    else
      if coalesce(pg_catalog.array_length(v_candidate_ids, 1), 0) = 0
         and v_app.client_id is not null then
        v_candidate_ids := array[v_app.client_id];
      end if;

      if coalesce(pg_catalog.array_length(v_candidate_ids, 1), 0) > 0 then
        v_conflicts := v_conflicts + 1;
        if p_apply and not exists (
          select 1
          from public.crm_identity_conflicts conflict
          where conflict.status = 'pending'
            and conflict.source_kind = 'visa_family_backfill'
            and conflict.source_record_id = v_app.id
        ) then
          insert into public.crm_identity_conflicts (
            source_kind,
            source_record_id,
            candidate_client_ids,
            matched_by,
            normalized_passport,
            normalized_email,
            normalized_phone,
            identity_snapshot
          ) values (
            'visa_family_backfill',
            v_app.id,
            v_candidate_ids,
            array['passport'],
            v_passport,
            public.crm_normalize_email(v_app.residential_email),
            public.crm_normalize_phone(v_app.residential_phone),
            jsonb_strip_nulls(jsonb_build_object(
              'full_name', v_full_name,
              'passport_no', v_passport,
              'reason', case
                when v_client_count > 1 then 'duplicate_client_passport'
                when v_application_count > 1 then 'passport_used_by_multiple_visa_applications'
                else 'current_client_passport_mismatch'
              end
            ))
          );
        end if;
      end if;
    end if;
  end loop;

  -- A signup client with no business relation is only flagged for staff review.
  -- No client is archived, merged, reassigned or deleted here.
  for v_signup in
    select c.id, c.full_name, c.email, c.phone, c.passport_no, c.passport_number
    from public.clients c
    where c.source = 'visa_signup'
      and not exists (select 1 from public.bookings b where b.client_id = c.id)
      and not exists (select 1 from public.booking_participants bp where bp.client_id = c.id)
      and not exists (select 1 from public.visa_applications va where va.client_id = c.id)
      and not exists (select 1 from public.payments p where p.client_id = c.id)
      and not exists (select 1 from public.fit_quotes fq where fq.client_id = c.id)
      and not exists (select 1 from public.client_notes cn where cn.client_id = c.id)
      and not exists (
        select 1
        from public.operation_tasks ot
        where ot.customer_id = c.id
      )
      and not exists (
        select 1
        from public.operation_checklists oc
        where oc.client_id = c.id or oc.customer_id = c.id
      )
    order by c.created_at, c.id
  loop
    v_signup_candidates := v_signup_candidates + 1;
    if p_apply and not exists (
      select 1
      from public.crm_identity_conflicts conflict
      where conflict.status = 'pending'
        and conflict.source_kind = 'visa_signup_orphan_candidate'
        and conflict.candidate_client_ids = array[v_signup.id]
    ) then
      insert into public.crm_identity_conflicts (
        source_kind,
        candidate_client_ids,
        matched_by,
        normalized_passport,
        normalized_email,
        normalized_phone,
        identity_snapshot
      ) values (
        'visa_signup_orphan_candidate',
        array[v_signup.id],
        array['manual_review'],
        public.crm_normalize_passport(coalesce(v_signup.passport_no, v_signup.passport_number)),
        public.crm_normalize_email(v_signup.email),
        public.crm_normalize_phone(v_signup.phone),
        jsonb_strip_nulls(jsonb_build_object(
          'full_name', v_signup.full_name,
          'reason', 'visa_signup_without_business_relation'
        ))
      );
    end if;
  end loop;

  return jsonb_build_object(
    'mode', case when p_apply then 'applied' else 'preview' end,
    'visa_application_relinks', v_relinks,
    'visa_client_name_repairs', v_name_repairs,
    'identity_conflicts_to_review', v_conflicts,
    'visa_signup_candidates_for_human_review', v_signup_candidates,
    'clients_deleted', 0,
    'clients_merged', 0
  );
end;
$$;

revoke all on function public.backfill_visa_family_crm_v1(boolean) from public, anon, authenticated;
grant execute on function public.backfill_visa_family_crm_v1(boolean) to authenticated, service_role;

comment on function public.backfill_visa_family_crm_v1(boolean) is
  'Preview (false) or apply (true) the conservative Visa-family CRM repair. Never deletes or merges clients.';

notify pgrst, 'reload schema';
