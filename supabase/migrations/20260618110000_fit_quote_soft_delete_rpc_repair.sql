-- Repair RPC for FIT quote soft delete if the previous permissions migration
-- stopped before creating the function.

alter table public.fit_quotes
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

update public.fit_quotes
set owner_user_id = created_by
where owner_user_id is null
  and created_by is not null;

create or replace function public.can_view_fit_internal_costs(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in ('super_admin', 'admin')
  );
$$;

create or replace function public.can_create_partner_fit_quotes(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id
      and ur.role::text in (
        'super_admin',
        'admin',
        'manager',
        'sales',
        'sales_user',
        'sales_manager',
        'partner_agency_admin',
        'partner_agent'
      )
  )
  or exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.user_id = _user_id
      and om.status = 'active'
      and o.type = 'agency'
      and o.status = 'active'
  );
$$;

create or replace function public.is_partner_org_admin(_organization_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.organization_id = _organization_id
      and om.user_id = _user_id
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'agency_admin', 'partner_agency_admin')
      and o.type = 'agency'
      and o.status = 'active'
  );
$$;

create or replace function public.soft_delete_fit_quote(_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  quote_row public.fit_quotes%rowtype;
  allowed boolean := false;
begin
  if actor_id is null then
    raise exception 'not authenticated';
  end if;

  select * into quote_row
  from public.fit_quotes
  where id = _quote_id
  for update;

  if not found then
    raise exception 'quote not found';
  end if;

  allowed :=
    public.can_view_fit_internal_costs(actor_id)
    or (
      quote_row.deleted_at is null
      and coalesce(quote_row.owner_user_id, quote_row.created_by) = actor_id
      and public.can_create_partner_fit_quotes(actor_id)
    )
    or (
      quote_row.deleted_at is null
      and quote_row.quote_channel = 'partner'
      and quote_row.partner_organization_id is not null
      and public.is_partner_org_admin(quote_row.partner_organization_id, actor_id)
    );

  if not allowed then
    raise exception 'not allowed';
  end if;

  if quote_row.deleted_at is null then
    update public.fit_quotes
    set deleted_at = now(),
        deleted_by = actor_id,
        share_enabled = false,
        updated_at = now()
    where id = _quote_id;

    insert into public.quote_audit_logs (
      quote_id,
      organization_id,
      user_id,
      action_type,
      payload
    )
    values (
      quote_row.id,
      quote_row.partner_organization_id,
      actor_id,
      'quote_soft_deleted',
      jsonb_build_object(
        'quote_number', quote_row.quote_number,
        'previous_status', quote_row.status
      )
    );
  end if;

  return jsonb_build_object('ok', true, 'quote_id', _quote_id);
end;
$$;

grant execute on function public.soft_delete_fit_quote(uuid) to authenticated;

notify pgrst, 'reload schema';
