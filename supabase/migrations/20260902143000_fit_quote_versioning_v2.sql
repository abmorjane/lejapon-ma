-- Linked, immutable FIT quote versions. The existing duplication RPC remains
-- the single audited copier for editable commercial rows; this migration wraps
-- it transactionally and removes its intermediary duplication markers.

alter table public.fit_quotes
  add column if not exists quote_group_id uuid,
  add column if not exists quote_family_reference text,
  add column if not exists previous_version_id uuid,
  add column if not exists is_current_version boolean not null default true,
  add column if not exists version_created_at timestamptz not null default now(),
  add column if not exists version_created_by uuid,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fit_quotes'::regclass
      and conname = 'fit_quotes_quote_group_id_fkey'
  ) then
    alter table public.fit_quotes add constraint fit_quotes_quote_group_id_fkey
      foreign key (quote_group_id) references public.fit_quotes(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fit_quotes'::regclass
      and conname = 'fit_quotes_previous_version_id_fkey'
  ) then
    alter table public.fit_quotes add constraint fit_quotes_previous_version_id_fkey
      foreign key (previous_version_id) references public.fit_quotes(id) on delete restrict;
  end if;
end;
$$;

update public.fit_quotes
set quote_group_id = coalesce(quote_group_id, id),
    quote_family_reference = coalesce(quote_family_reference, quote_number),
    version_number = coalesce(version_number, 1),
    is_current_version = true,
    version_created_at = coalesce(created_at, now()),
    version_created_by = created_by
where quote_group_id is null or quote_family_reference is null;

create unique index if not exists fit_quotes_group_version_unique_idx
  on public.fit_quotes (quote_group_id, version_number)
  where deleted_at is null;
create unique index if not exists fit_quotes_one_current_version_idx
  on public.fit_quotes (quote_group_id)
  where is_current_version and deleted_at is null;
create index if not exists fit_quotes_version_history_idx
  on public.fit_quotes (quote_group_id, version_number desc);
create index if not exists fit_quotes_active_unarchived_idx
  on public.fit_quotes (updated_at desc)
  where deleted_at is null and archived_at is null;

create or replace function public.initialize_fit_quote_version_family()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.quote_group_id := coalesce(new.quote_group_id, new.id);
  new.quote_family_reference := coalesce(nullif(new.quote_family_reference, ''), new.quote_number);
  new.version_number := coalesce(new.version_number, 1);
  new.is_current_version := coalesce(new.is_current_version, true);
  new.version_created_at := coalesce(new.version_created_at, new.created_at, statement_timestamp());
  new.version_created_by := coalesce(new.version_created_by, new.created_by);

  -- duplicate_fit_quote copies newly-added columns through its dynamic record
  -- payload. A duplication is an independent family, so initialise it here.
  if new.duplicated_from_id is not null
     and coalesce(new.metadata ->> 'duplicated_from_id', '') <> '' then
    new.quote_group_id := new.id;
    new.quote_family_reference := new.quote_number;
    new.version_number := 1;
    new.previous_version_id := null;
    new.is_current_version := true;
  end if;
  return new;
end;
$$;

drop trigger if exists fit_quotes_initialize_version_family on public.fit_quotes;
create trigger fit_quotes_initialize_version_family
before insert on public.fit_quotes
for each row execute function public.initialize_fit_quote_version_family();

create or replace function public.protect_superseded_fit_quote()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not old.is_current_version then
    raise exception 'A superseded FIT quote version is read-only';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists fit_quotes_protect_superseded_update on public.fit_quotes;
create trigger fit_quotes_protect_superseded_update
before update or delete on public.fit_quotes
for each row execute function public.protect_superseded_fit_quote();

create or replace function public.create_new_fit_quote_version(p_source_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor_id uuid := auth.uid();
  v_source public.fit_quotes%rowtype;
  v_copy_result jsonb;
  v_new_id uuid;
  v_new public.fit_quotes%rowtype;
  v_next_version integer;
  v_family_reference text;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select * into v_source
  from public.fit_quotes
  where id = p_source_quote_id and deleted_at is null and archived_at is null
  for update;

  if not found then raise exception 'FIT quote not found'; end if;
  if not v_source.is_current_version then
    raise exception 'Only the current FIT quote version can be versioned';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_source.quote_group_id::text, 0));
  v_next_version := coalesce((
    select max(version_number) + 1
    from public.fit_quotes
    where quote_group_id = v_source.quote_group_id
  ), 2);
  v_family_reference := coalesce(v_source.quote_family_reference, v_source.quote_number);

  -- Reuse the hardened copier: access checks, organization isolation, fresh
  -- IDs/token, editable children and attachment exclusions stay identical.
  v_copy_result := public.duplicate_fit_quote(v_source.id);
  v_new_id := (v_copy_result ->> 'new_quote_id')::uuid;

  -- The two intermediary duplication events are not real business events for
  -- a linked version and are removed inside this same transaction.
  delete from public.quote_audit_logs
  where user_id = v_actor_id
    and (
      (quote_id = v_source.id and action_type = 'duplicated_to' and payload ->> 'duplicated_to_id' = v_new_id::text)
      or
      (quote_id = v_new_id and action_type = 'duplicated_from' and payload ->> 'duplicated_from_id' = v_source.id::text)
    );

  update public.fit_quotes
  set is_current_version = false,
      share_enabled = false,
      public_client_visible = false,
      public_link_revoked_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = v_source.id;

  update public.fit_quotes
  set quote_number = format('%s-V%s', v_family_reference, v_next_version),
      quote_group_id = v_source.quote_group_id,
      quote_family_reference = v_family_reference,
      version_number = v_next_version,
      previous_version_id = v_source.id,
      is_current_version = true,
      version_created_at = statement_timestamp(),
      version_created_by = v_actor_id,
      duplicated_from_id = v_source.duplicated_from_id,
      metadata = coalesce(metadata, '{}'::jsonb)
        - 'duplicated_from_id' - 'duplicated_at'
        || jsonb_build_object(
          'versioned_from_id', v_source.id,
          'version_number', v_next_version,
          'version_created_at', statement_timestamp()
        ),
      updated_at = statement_timestamp()
  where id = v_new_id
  returning * into v_new;

  -- The hardened duplication copier intentionally copies partner pricing only
  -- for drafts. A new version may start from a sent version, so copy only the
  -- editable configuration when no row exists; approval/snapshot state resets.
  insert into public.fit_quote_partner_pricing (
    quote_id, organization_id, net_partner_total, partner_margin_type,
    partner_margin_value, partner_margin_total, manual_adjustment_mad,
    client_sale_total, client_sale_per_person, approval_required,
    approval_reason, created_at, updated_at
  )
  select
    v_new_id, organization_id, net_partner_total, partner_margin_type,
    partner_margin_value, partner_margin_total, manual_adjustment_mad,
    client_sale_total, client_sale_per_person, false,
    null, statement_timestamp(), statement_timestamp()
  from public.fit_quote_partner_pricing
  where quote_id = v_source.id
  on conflict (quote_id) do nothing;

  insert into public.quote_audit_logs (quote_id, organization_id, user_id, action_type, payload)
  values
    (v_source.id, v_source.partner_organization_id, v_actor_id, 'version_superseded',
      jsonb_build_object('new_version_id', v_new.id, 'new_version_number', v_next_version)),
    (v_new.id, v_new.partner_organization_id, v_actor_id, 'version_created',
      jsonb_build_object('previous_version_id', v_source.id, 'version_number', v_next_version));

  return jsonb_build_object(
    'ok', true,
    'quote_group_id', v_source.quote_group_id,
    'family_reference', v_family_reference,
    'previous_version_id', v_source.id,
    'new_quote_id', v_new.id,
    'version_number', v_next_version,
    'new_reference', v_new.quote_number,
    'attachments', jsonb_build_object(
      'copied_files', 0,
      'referenced', 'reusable itinerary image URLs and source component/template references',
      'skipped', 'FIT documents, generated PDFs, signed/client files and storage objects'
    )
  );
end;
$$;

revoke all on function public.create_new_fit_quote_version(uuid) from public, anon;
grant execute on function public.create_new_fit_quote_version(uuid) to authenticated;

notify pgrst, 'reload schema';
