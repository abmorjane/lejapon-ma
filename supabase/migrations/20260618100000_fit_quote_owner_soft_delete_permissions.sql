-- Propriété et soft delete des Devis FIT.
-- Chaque utilisateur autorisé gère ses propres devis; les admins gardent l'accès complet.

alter table public.fit_quotes
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

update public.fit_quotes
set owner_user_id = created_by
where owner_user_id is null
  and created_by is not null;

create index if not exists fit_quotes_owner_user_idx
  on public.fit_quotes(owner_user_id, updated_at desc)
  where deleted_at is null;

create index if not exists fit_quotes_partner_org_active_idx
  on public.fit_quotes(partner_organization_id, updated_at desc)
  where deleted_at is null;

create or replace function public.set_fit_quote_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is null then
    new.owner_user_id := coalesce(new.created_by, auth.uid());
  end if;

  if new.created_by is null then
    new.created_by := new.owner_user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists set_fit_quote_owner_before_insert on public.fit_quotes;
create trigger set_fit_quote_owner_before_insert
before insert on public.fit_quotes
for each row execute function public.set_fit_quote_owner();

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

create or replace function public.can_access_fit_quote(_quote_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.fit_quotes q
    where q.id = _quote_id
      and (
        public.can_view_fit_internal_costs(_user_id)
        or (
          q.deleted_at is null
          and coalesce(q.owner_user_id, q.created_by) = _user_id
          and public.can_create_partner_fit_quotes(_user_id)
        )
        or (
          q.deleted_at is null
          and q.quote_channel = 'partner'
          and q.partner_organization_id is not null
          and (
            public.is_partner_org_admin(q.partner_organization_id, _user_id)
            or coalesce(q.owner_user_id, q.created_by) = _user_id
          )
        )
      )
  );
$$;

drop policy if exists "staff manage fit quotes" on public.fit_quotes;
drop policy if exists "partner manage own fit quotes" on public.fit_quotes;
drop policy if exists "sales manage own partner style fit quotes" on public.fit_quotes;

drop policy if exists "fit quotes admin full access" on public.fit_quotes;
create policy "fit quotes admin full access" on public.fit_quotes
for all using (public.can_view_fit_internal_costs(auth.uid()))
with check (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "fit quotes owner read active" on public.fit_quotes;
create policy "fit quotes owner read active" on public.fit_quotes
for select using (
  deleted_at is null
  and coalesce(owner_user_id, created_by) = auth.uid()
  and public.can_create_partner_fit_quotes(auth.uid())
);

drop policy if exists "fit quotes owner update active" on public.fit_quotes;
create policy "fit quotes owner update active" on public.fit_quotes
for update using (
  deleted_at is null
  and coalesce(owner_user_id, created_by) = auth.uid()
  and public.can_create_partner_fit_quotes(auth.uid())
)
with check (
  coalesce(owner_user_id, created_by) = auth.uid()
  and public.can_create_partner_fit_quotes(auth.uid())
);

drop policy if exists "fit quotes partner agency admin manage active" on public.fit_quotes;
create policy "fit quotes partner agency admin manage active" on public.fit_quotes
for all using (
  deleted_at is null
  and quote_channel = 'partner'
  and partner_organization_id is not null
  and public.is_partner_org_admin(partner_organization_id, auth.uid())
)
with check (
  quote_channel = 'partner'
  and partner_organization_id is not null
  and public.is_partner_org_admin(partner_organization_id, auth.uid())
);

drop policy if exists "fit quotes authorized insert owned" on public.fit_quotes;
create policy "fit quotes authorized insert owned" on public.fit_quotes
for insert with check (
  public.can_create_partner_fit_quotes(auth.uid())
  and coalesce(owner_user_id, created_by, auth.uid()) = auth.uid()
  and (
    partner_organization_id is null
    or public.is_partner_org_member(partner_organization_id, auth.uid())
  )
);

drop policy if exists "fit quotes admin hard delete only" on public.fit_quotes;
create policy "fit quotes admin hard delete only" on public.fit_quotes
for delete using (public.can_view_fit_internal_costs(auth.uid()));

drop policy if exists "public read shared fit quotes" on public.fit_quotes;
create policy "public read shared fit quotes" on public.fit_quotes
for select using (
  deleted_at is null
  and share_enabled = true
  and share_token is not null
);

drop policy if exists "public update shared fit quote response" on public.fit_quotes;
create policy "public update shared fit quote response" on public.fit_quotes
for update using (
  deleted_at is null
  and share_enabled = true
  and share_token is not null
)
with check (
  deleted_at is null
  and share_enabled = true
  and share_token is not null
);

drop policy if exists "public read shared fit quote days" on public.fit_quote_days;
create policy "public read shared fit quote days" on public.fit_quote_days
for select using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_days.quote_id
      and q.deleted_at is null
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read visible shared fit quote day lines" on public.fit_quote_day_cost_lines;
create policy "public read visible shared fit quote day lines" on public.fit_quote_day_cost_lines
for select using (
  is_client_visible = true
  and exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_day_cost_lines.quote_id
      and q.deleted_at is null
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read shared fit quote hotels" on public.fit_quote_hotel_lines;
create policy "public read shared fit quote hotels" on public.fit_quote_hotel_lines
for select using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_hotel_lines.quote_id
      and q.deleted_at is null
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "public read shared fit quote flights" on public.fit_quote_flight_lines;
create policy "public read shared fit quote flights" on public.fit_quote_flight_lines
for select using (
  exists (
    select 1 from public.fit_quotes q
    where q.id = fit_quote_flight_lines.quote_id
      and q.deleted_at is null
      and q.share_enabled = true
      and q.share_token is not null
  )
);

drop policy if exists "partner manage own fit quote days" on public.fit_quote_days;
drop policy if exists "sales manage own partner style fit quote days" on public.fit_quote_days;
drop policy if exists "authorized manage accessible fit quote days" on public.fit_quote_days;
create policy "authorized manage accessible fit quote days" on public.fit_quote_days
for all using (public.can_access_fit_quote(quote_id, auth.uid()))
with check (public.can_access_fit_quote(quote_id, auth.uid()));

drop policy if exists "partner manage own fit quote day components" on public.fit_quote_day_components;
drop policy if exists "sales manage own partner style quote components" on public.fit_quote_day_components;
drop policy if exists "authorized manage accessible fit quote day components" on public.fit_quote_day_components;
create policy "authorized manage accessible fit quote day components" on public.fit_quote_day_components
for all using (
  exists (
    select 1
    from public.fit_quote_days d
    where d.id = fit_quote_day_components.quote_day_id
      and public.can_access_fit_quote(d.quote_id, auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.fit_quote_days d
    where d.id = fit_quote_day_components.quote_day_id
      and public.can_access_fit_quote(d.quote_id, auth.uid())
  )
);

drop policy if exists "partner manage own quote pricing" on public.fit_quote_partner_pricing;
drop policy if exists "sales manage own partner style quote pricing" on public.fit_quote_partner_pricing;
drop policy if exists "authorized manage accessible partner quote pricing" on public.fit_quote_partner_pricing;
create policy "authorized manage accessible partner quote pricing" on public.fit_quote_partner_pricing
for all using (public.can_access_fit_quote(quote_id, auth.uid()))
with check (public.can_access_fit_quote(quote_id, auth.uid()));

drop policy if exists "partner manage own fit hotel lines" on public.fit_quote_hotel_lines;
drop policy if exists "authorized manage accessible fit hotel lines" on public.fit_quote_hotel_lines;
create policy "authorized manage accessible fit hotel lines" on public.fit_quote_hotel_lines
for all using (public.can_access_fit_quote(quote_id, auth.uid()))
with check (public.can_access_fit_quote(quote_id, auth.uid()));

drop policy if exists "partner manage own fit flight lines" on public.fit_quote_flight_lines;
drop policy if exists "authorized manage accessible fit flight lines" on public.fit_quote_flight_lines;
create policy "authorized manage accessible fit flight lines" on public.fit_quote_flight_lines
for all using (public.can_access_fit_quote(quote_id, auth.uid()))
with check (public.can_access_fit_quote(quote_id, auth.uid()));

drop policy if exists "partner read own quote audit logs" on public.quote_audit_logs;
drop policy if exists "sales read own quote audit logs" on public.quote_audit_logs;
drop policy if exists "authorized read accessible quote audit logs" on public.quote_audit_logs;
create policy "authorized read accessible quote audit logs" on public.quote_audit_logs
for select using (public.can_access_fit_quote(quote_id, auth.uid()));

drop policy if exists "partner insert own quote audit logs" on public.quote_audit_logs;
drop policy if exists "sales insert own quote audit logs" on public.quote_audit_logs;
drop policy if exists "authorized insert accessible quote audit logs" on public.quote_audit_logs;
create policy "authorized insert accessible quote audit logs" on public.quote_audit_logs
for insert with check (
  user_id = auth.uid()
  and public.can_access_fit_quote(quote_id, auth.uid())
);

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

    insert into public.quote_audit_logs (quote_id, organization_id, user_id, action_type, payload)
    values (
      quote_row.id,
      quote_row.partner_organization_id,
      actor_id,
      'quote_soft_deleted',
      jsonb_build_object('quote_number', quote_row.quote_number, 'previous_status', quote_row.status)
    );
  end if;

  return jsonb_build_object('ok', true, 'quote_id', _quote_id);
end;
$$;

grant execute on function public.soft_delete_fit_quote(uuid) to authenticated;

grant select, insert, update, delete on public.fit_quotes to authenticated;
grant select, insert, update on public.quote_audit_logs to authenticated;

notify pgrst, 'reload schema';
