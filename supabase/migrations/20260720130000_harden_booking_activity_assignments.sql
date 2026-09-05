-- Harden participant activity assignments.
-- The operations activity matrix must use explicit participant <-> activity
-- assignments. Booking-level extra quantities remain the commercial purchase
-- source, but they are no longer treated as per-participant selections.

do $$
begin
  if to_regclass('public.booking_participant_activities') is null then
    raise exception 'Required table public.booking_participant_activities is missing. Apply the booking participants migration first.';
  end if;

  if to_regclass('public.booking_participants') is null then
    raise exception 'Required table public.booking_participants is missing. Apply the booking participants migration first.';
  end if;

  if to_regclass('public.booking_extras') is null then
    raise exception 'Required table public.booking_extras is missing. Apply the booking extras migration first.';
  end if;
end $$;

alter table public.booking_extras
  add column if not exists activity_match_status text not null default 'snapshot',
  add column if not exists activity_match_reviewed_at timestamptz,
  add column if not exists activity_match_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists activity_match_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_extras_activity_match_status_check'
      and conrelid = 'public.booking_extras'::regclass
  ) then
    alter table public.booking_extras
      add constraint booking_extras_activity_match_status_check
      check (activity_match_status in ('snapshot', 'manual', 'unmatched'));
  end if;
end $$;

alter table public.booking_participant_activities
  add column if not exists booking_id uuid,
  add column if not exists booking_extra_id uuid,
  add column if not exists source text not null default 'manual',
  add column if not exists price_snapshot_mad numeric(10,2),
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid,
  add column if not exists removal_reason text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.booking_participant_activities bpa
set booking_id = bp.booking_id,
    assigned_at = coalesce(bpa.assigned_at, bpa.created_at)
from public.booking_participants bp
where bp.id = bpa.participant_id
  and (bpa.booking_id is null or bpa.assigned_at is null);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_participant_activities_booking_id_fkey'
      and conrelid = 'public.booking_participant_activities'::regclass
  ) then
    alter table public.booking_participant_activities
      add constraint booking_participant_activities_booking_id_fkey
      foreign key (booking_id) references public.bookings(id) on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_participant_activities_extra_id_fkey'
      and conrelid = 'public.booking_participant_activities'::regclass
  ) then
    alter table public.booking_participant_activities
      add constraint booking_participant_activities_extra_id_fkey
      foreign key (extra_id) references public.extras(id) on delete restrict
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_participant_activities_booking_extra_id_fkey'
      and conrelid = 'public.booking_participant_activities'::regclass
  ) then
    alter table public.booking_participant_activities
      add constraint booking_participant_activities_booking_extra_id_fkey
      foreign key (booking_extra_id) references public.booking_extras(id) on delete set null
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_participant_activities_source_check'
      and conrelid = 'public.booking_participant_activities'::regclass
  ) then
    alter table public.booking_participant_activities
      add constraint booking_participant_activities_source_check
      check (source in ('manual', 'safe_reconciliation', 'admin_adjustment', 'booking_extra_import'));
  end if;
end $$;

create index if not exists idx_bpa_booking_extra
  on public.booking_participant_activities(booking_id, extra_id);

create index if not exists idx_bpa_selected
  on public.booking_participant_activities(booking_id, extra_id)
  where is_selected = true;

create table if not exists public.booking_participant_activity_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade,
  booking_participant_activity_id uuid references public.booking_participant_activities(id) on delete set null,
  participant_id uuid references public.booking_participants(id) on delete set null,
  extra_id uuid references public.extras(id) on delete set null,
  booking_extra_id uuid references public.booking_extras(id) on delete set null,
  action text not null check (action in ('assigned', 'removed', 'financial_added', 'financial_removed', 'reconciled')),
  old_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  quantity_before integer,
  quantity_after integer,
  total_before_mad numeric(10,2),
  total_after_mad numeric(10,2),
  user_id uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_booking_activity_history_booking
  on public.booking_participant_activity_history(booking_id, created_at desc);

create index if not exists idx_booking_activity_history_participant
  on public.booking_participant_activity_history(participant_id, created_at desc);

alter table public.booking_participant_activity_history enable row level security;

drop policy if exists "staff read booking participant activity history"
  on public.booking_participant_activity_history;

create policy "staff read booking participant activity history"
on public.booking_participant_activity_history
for select
using (public.v2_is_staff(auth.uid()));

drop policy if exists "staff insert booking participant activity history"
  on public.booking_participant_activity_history;

create policy "staff insert booking participant activity history"
on public.booking_participant_activity_history
for insert
with check (public.v2_is_staff(auth.uid()));

create or replace function public.normalize_activity_match_text(_value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.booking_extra_activity_match_is_trusted(
  _name_snapshot text,
  _extra_name text,
  _activity_match_status text
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(_activity_match_status, 'snapshot') = 'manual'
    or public.normalize_activity_match_text(_name_snapshot) = public.normalize_activity_match_text(_extra_name);
$$;

create or replace function public.validate_booking_participant_activity_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_booking_id uuid;
  v_participant_trip_id uuid;
  v_booking_trip_id uuid;
  v_booking_extra record;
  v_extra record;
begin
  select bp.booking_id, bp.trip_id
  into v_participant_booking_id, v_participant_trip_id
  from public.booking_participants bp
  where bp.id = new.participant_id;

  if v_participant_booking_id is null then
    raise exception 'participant_not_found'
      using errcode = '23503';
  end if;

  select b.trip_id
  into v_booking_trip_id
  from public.bookings b
  where b.id = coalesce(new.booking_id, v_participant_booking_id);

  if v_booking_trip_id is null then
    raise exception 'booking_not_found'
      using errcode = '23503';
  end if;

  if coalesce(new.booking_id, v_participant_booking_id) is distinct from v_participant_booking_id then
    raise exception 'participant_booking_mismatch'
      using errcode = '23514';
  end if;

  if v_participant_trip_id is not null and v_booking_trip_id is not null and v_participant_trip_id is distinct from v_booking_trip_id then
    raise exception 'participant_trip_mismatch'
      using errcode = '23514';
  end if;

  select e.id, e.is_active, e.price_mad
  into v_extra
  from public.extras e
  where e.id = new.extra_id;

  if v_extra.id is null then
    raise exception 'extra_not_found'
      using errcode = '23503';
  end if;

  if new.is_selected and not coalesce(v_extra.is_active, false) then
    raise exception 'extra_inactive'
      using errcode = '23514';
  end if;

  if new.booking_extra_id is not null then
    select be.id, be.booking_id, be.extra_id
    into v_booking_extra
    from public.booking_extras be
    where be.id = new.booking_extra_id;

    if v_booking_extra.id is null then
      raise exception 'booking_extra_not_found'
        using errcode = '23503';
    end if;

    if v_booking_extra.booking_id is distinct from v_participant_booking_id
       or v_booking_extra.extra_id is distinct from new.extra_id then
      raise exception 'booking_extra_mismatch'
        using errcode = '23514';
    end if;
  end if;

  new.booking_id := v_participant_booking_id;
  new.price_snapshot_mad := coalesce(new.price_snapshot_mad, v_extra.price_mad);
  new.assigned_at := case
    when new.is_selected then coalesce(new.assigned_at, now())
    else new.assigned_at
  end;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists validate_booking_participant_activity_row
  on public.booking_participant_activities;

create trigger validate_booking_participant_activity_row
before insert or update
on public.booking_participant_activities
for each row
execute function public.validate_booking_participant_activity_row();

drop trigger if exists booking_participant_activities_updated_at
  on public.booking_participant_activities;

create trigger booking_participant_activities_updated_at
before update on public.booking_participant_activities
for each row execute function public.set_updated_at();

create or replace function public.admin_set_booking_participant_activity(
  p_participant_id uuid,
  p_extra_id uuid,
  p_is_selected boolean,
  p_adjust_booking_extra boolean default false,
  p_reduce_booking_extra boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := auth.jwt() ->> 'email';
  v_participant public.booking_participants%rowtype;
  v_booking public.bookings%rowtype;
  v_extra public.extras%rowtype;
  v_existing public.booking_participant_activities%rowtype;
  v_booking_extra public.booking_extras%rowtype;
  v_purchased_before integer := 0;
  v_purchased_after integer := 0;
  v_assigned_before integer := 0;
  v_assigned_after integer := 0;
  v_total_before numeric(10,2) := 0;
  v_total_after numeric(10,2) := 0;
  v_delta numeric(10,2) := 0;
  v_action text;
  v_assignment_id uuid;
begin
  if not public.v2_is_staff(v_user_id) then
    raise exception 'not_allowed'
      using errcode = '42501';
  end if;

  select * into v_participant
  from public.booking_participants
  where id = p_participant_id;

  if v_participant.id is null then
    raise exception 'participant_not_found'
      using errcode = '23503';
  end if;

  select * into v_booking
  from public.bookings
  where id = v_participant.booking_id
  for update;

  if v_booking.id is null then
    raise exception 'booking_not_found'
      using errcode = '23503';
  end if;

  if v_booking.status::text in ('cancelled', 'canceled', 'archived') then
    raise exception 'booking_not_editable'
      using errcode = '23514';
  end if;

  if v_participant.trip_id is not null and v_booking.trip_id is not null and v_participant.trip_id is distinct from v_booking.trip_id then
    raise exception 'participant_trip_mismatch'
      using errcode = '23514';
  end if;

  select * into v_extra
  from public.extras
  where id = p_extra_id
  for share;

  if v_extra.id is null then
    raise exception 'extra_not_found'
      using errcode = '23503';
  end if;

  if p_is_selected and not coalesce(v_extra.is_active, false) then
    raise exception 'extra_inactive'
      using errcode = '23514';
  end if;

  select coalesce(sum(qty), 0)::integer
  into v_purchased_before
  from public.booking_extras
  where booking_id = v_booking.id
    and extra_id = p_extra_id
    and public.booking_extra_activity_match_is_trusted(name_snapshot, v_extra.name, activity_match_status);

  select count(*)::integer
  into v_assigned_before
  from public.booking_participant_activities
  where booking_id = v_booking.id
    and extra_id = p_extra_id
    and is_selected = true;

  select *
  into v_existing
  from public.booking_participant_activities
  where participant_id = p_participant_id
    and extra_id = p_extra_id
  for update;

  select *
  into v_booking_extra
  from public.booking_extras
  where booking_id = v_booking.id
    and extra_id = p_extra_id
    and public.booking_extra_activity_match_is_trusted(name_snapshot, v_extra.name, activity_match_status)
  order by created_at, id
  limit 1
  for update;

  v_total_before := coalesce(v_booking.total_amount_mad, 0);

  if p_is_selected then
    if v_existing.id is not null and v_existing.is_selected then
      return jsonb_build_object('ok', true, 'status', 'already_assigned');
    end if;

    if v_purchased_before <= v_assigned_before then
      if not p_adjust_booking_extra then
        raise exception 'activity_extra_capacity_exceeded'
          using errcode = '23514',
                detail = 'No purchased unit is available for this participant. Confirm a financial adjustment first.';
      end if;

      if not public.has_any_role(v_user_id, array['super_admin','admin']::public.app_role[]) then
        raise exception 'admin_required_for_financial_adjustment'
          using errcode = '42501';
      end if;

      v_delta := coalesce(v_extra.price_mad, 0);

      if v_booking_extra.id is null then
        insert into public.booking_extras (booking_id, extra_id, name_snapshot, qty, unit_price_mad)
        values (v_booking.id, p_extra_id, coalesce(v_extra.name, 'Expérience optionnelle'), 1, coalesce(v_extra.price_mad, 0))
        returning * into v_booking_extra;
      else
        update public.booking_extras
        set qty = coalesce(qty, 0) + 1,
            unit_price_mad = coalesce(v_extra.price_mad, unit_price_mad)
        where id = v_booking_extra.id
        returning * into v_booking_extra;
      end if;

      update public.bookings
      set total_amount_mad = coalesce(total_amount_mad, 0) + v_delta,
          updated_at = now()
      where id = v_booking.id
      returning total_amount_mad into v_total_after;

      v_action := 'financial_added';
    else
      v_total_after := v_total_before;
      v_action := 'assigned';
    end if;

    if v_existing.id is null then
      insert into public.booking_participant_activities (
        participant_id,
        booking_id,
        extra_id,
        booking_extra_id,
        is_selected,
        source,
        price_snapshot_mad,
        assigned_at,
        assigned_by,
        removed_at,
        removed_by,
        removal_reason,
        metadata
      ) values (
        p_participant_id,
        v_booking.id,
        p_extra_id,
        v_booking_extra.id,
        true,
        case when v_action = 'financial_added' then 'admin_adjustment' else 'manual' end,
        coalesce(v_extra.price_mad, 0),
        now(),
        v_user_id,
        null,
        null,
        null,
        jsonb_build_object('reason', p_reason)
      )
      returning id into v_assignment_id;
    else
      update public.booking_participant_activities
      set booking_id = v_booking.id,
          booking_extra_id = v_booking_extra.id,
          is_selected = true,
          source = case when v_action = 'financial_added' then 'admin_adjustment' else 'manual' end,
          price_snapshot_mad = coalesce(v_extra.price_mad, price_snapshot_mad),
          assigned_at = now(),
          assigned_by = v_user_id,
          removed_at = null,
          removed_by = null,
          removal_reason = null,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
      where id = v_existing.id
      returning id into v_assignment_id;
    end if;
  else
    if v_existing.id is null or not v_existing.is_selected then
      return jsonb_build_object('ok', true, 'status', 'already_unassigned');
    end if;

    if p_reduce_booking_extra then
      if not public.has_any_role(v_user_id, array['super_admin','admin']::public.app_role[]) then
        raise exception 'admin_required_for_financial_adjustment'
          using errcode = '42501';
      end if;

      if v_booking_extra.id is null then
        raise exception 'booking_extra_not_found_for_financial_reduction'
          using errcode = '23514',
                detail = 'No stable purchased booking extra exists for this activity.';
      end if;

      v_delta := coalesce(v_booking_extra.unit_price_mad, v_extra.price_mad, 0);

      update public.booking_participant_activities
      set is_selected = false,
          removed_at = now(),
          removed_by = v_user_id,
          removal_reason = p_reason,
          booking_extra_id = null,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
      where id = v_existing.id
      returning id into v_assignment_id;

      if v_booking_extra.id is not null then
        if coalesce(v_booking_extra.qty, 0) <= 1 then
          delete from public.booking_extras where id = v_booking_extra.id;
        else
          update public.booking_extras
          set qty = qty - 1
          where id = v_booking_extra.id;
        end if;
      end if;

      update public.bookings
      set total_amount_mad = greatest(0, coalesce(total_amount_mad, 0) - v_delta),
          updated_at = now()
      where id = v_booking.id
      returning total_amount_mad into v_total_after;

      v_action := 'financial_removed';
    else
      update public.booking_participant_activities
      set is_selected = false,
          removed_at = now(),
          removed_by = v_user_id,
          removal_reason = p_reason,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
      where id = v_existing.id
      returning id into v_assignment_id;

      v_total_after := v_total_before;
      v_action := 'removed';
    end if;
  end if;

  select coalesce(sum(qty), 0)::integer
  into v_purchased_after
  from public.booking_extras
  where booking_id = v_booking.id
    and extra_id = p_extra_id
    and public.booking_extra_activity_match_is_trusted(name_snapshot, v_extra.name, activity_match_status);

  select count(*)::integer
  into v_assigned_after
  from public.booking_participant_activities
  where booking_id = v_booking.id
    and extra_id = p_extra_id
    and is_selected = true;

  insert into public.booking_participant_activity_history (
    booking_id,
    booking_participant_activity_id,
    participant_id,
    extra_id,
    booking_extra_id,
    action,
    old_state,
    new_state,
    quantity_before,
    quantity_after,
    total_before_mad,
    total_after_mad,
    user_id,
    reason
  ) values (
    v_booking.id,
    v_assignment_id,
    p_participant_id,
    p_extra_id,
    v_booking_extra.id,
    v_action,
    jsonb_build_object('purchased', v_purchased_before, 'assigned', v_assigned_before),
    jsonb_build_object('purchased', v_purchased_after, 'assigned', v_assigned_after, 'selected', p_is_selected),
    v_purchased_before,
    v_purchased_after,
    v_total_before,
    v_total_after,
    v_user_id,
    p_reason
  );

  insert into public.booking_audit_log (booking_id, user_id, user_email, field, old_value, new_value)
  values (
    v_booking.id,
    v_user_id,
    v_user_email,
    'Activité participant',
    concat('achetées=', v_purchased_before, ', affectées=', v_assigned_before, ', total=', v_total_before),
    concat('extra=', coalesce(v_extra.name, p_extra_id::text), ', sélection=', p_is_selected, ', action=', v_action, ', achetées=', v_purchased_after, ', affectées=', v_assigned_after, ', total=', v_total_after)
  );

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'booking_id', v_booking.id,
    'participant_id', p_participant_id,
    'extra_id', p_extra_id,
    'purchased_before', v_purchased_before,
    'purchased_after', v_purchased_after,
    'assigned_before', v_assigned_before,
    'assigned_after', v_assigned_after,
    'total_before_mad', v_total_before,
    'total_after_mad', v_total_after
  );
end;
$$;

grant execute on function public.admin_set_booking_participant_activity(uuid, uuid, boolean, boolean, boolean, text) to authenticated;

create or replace function public.admin_link_booking_extra_to_activity(
  p_booking_extra_id uuid,
  p_extra_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := auth.jwt() ->> 'email';
  v_booking_extra public.booking_extras%rowtype;
  v_booking public.bookings%rowtype;
  v_extra public.extras%rowtype;
  v_previous_extra_name text;
begin
  if not public.v2_is_staff(v_user_id) then
    raise exception 'not_allowed'
      using errcode = '42501';
  end if;

  select * into v_booking_extra
  from public.booking_extras
  where id = p_booking_extra_id
  for update;

  if v_booking_extra.id is null then
    raise exception 'booking_extra_not_found'
      using errcode = '23503';
  end if;

  select * into v_booking
  from public.bookings
  where id = v_booking_extra.booking_id
  for update;

  if v_booking.id is null then
    raise exception 'booking_not_found'
      using errcode = '23503';
  end if;

  if v_booking.status::text in ('cancelled', 'canceled', 'archived') then
    raise exception 'booking_not_editable'
      using errcode = '23514';
  end if;

  select name into v_previous_extra_name
  from public.extras
  where id = v_booking_extra.extra_id;

  select * into v_extra
  from public.extras
  where id = p_extra_id
  for share;

  if v_extra.id is null then
    raise exception 'extra_not_found'
      using errcode = '23503';
  end if;

  if not coalesce(v_extra.is_active, false) then
    raise exception 'extra_inactive'
      using errcode = '23514';
  end if;

  update public.booking_extras
  set extra_id = p_extra_id,
      activity_match_status = 'manual',
      activity_match_reviewed_at = now(),
      activity_match_reviewed_by = v_user_id,
      activity_match_note = p_reason
  where id = p_booking_extra_id
  returning * into v_booking_extra;

  insert into public.booking_audit_log (booking_id, user_id, user_email, field, old_value, new_value)
  values (
    v_booking.id,
    v_user_id,
    v_user_email,
    'Association activité extra',
    concat('booking_extra=', p_booking_extra_id, ', snapshot=', v_booking_extra.name_snapshot, ', activité précédente=', coalesce(v_previous_extra_name, 'aucune')),
    concat('activité=', coalesce(v_extra.name, p_extra_id::text), ', mode=manual')
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_extra_id', p_booking_extra_id,
    'extra_id', p_extra_id,
    'activity_name', v_extra.name,
    'activity_match_status', v_booking_extra.activity_match_status
  );
end;
$$;

grant execute on function public.admin_link_booking_extra_to_activity(uuid, uuid, text) to authenticated;

create or replace function public.admin_reconcile_trip_activity_assignments(
  p_trip_id uuid,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item record;
  v_participant record;
  v_assignment_id uuid;
  v_active_count integer;
  v_existing_count integer;
  v_status text;
  v_report jsonb := '[]'::jsonb;
  v_applied integer := 0;
  v_safe integer := 0;
  v_ambiguous integer := 0;
begin
  if not public.v2_is_staff(v_user_id) then
    raise exception 'not_allowed'
      using errcode = '42501';
  end if;

  for v_item in
    select
      be.id as booking_extra_id,
      be.booking_id,
      be.extra_id,
      be.name_snapshot,
      be.activity_match_status,
      coalesce(be.qty, 0)::integer as qty,
      coalesce(be.unit_price_mad, 0) as unit_price_mad,
      b.reference,
      e.name as extra_name,
      e.is_active
    from public.booking_extras be
    join public.bookings b on b.id = be.booking_id
    left join public.extras e on e.id = be.extra_id
    where b.trip_id = p_trip_id
    order by b.reference, be.created_at, be.id
  loop
    select count(*)::integer
    into v_active_count
    from public.booking_participants bp
    where bp.booking_id = v_item.booking_id
      and coalesce(lower(bp.client_type), '') not in ('cancelled', 'canceled', 'deleted', 'archived', 'removed');

    select count(*)::integer
    into v_existing_count
    from public.booking_participant_activities bpa
    where bpa.booking_id = v_item.booking_id
      and bpa.extra_id = v_item.extra_id
      and bpa.is_selected = true;

    if v_item.extra_id is null or v_item.extra_name is null then
      v_status := 'no_activity_match';
    elsif not coalesce(v_item.is_active, false) then
      v_status := 'activity_inactive';
    elsif not public.booking_extra_activity_match_is_trusted(v_item.name_snapshot, v_item.extra_name, v_item.activity_match_status) then
      v_status := 'ambiguous_name_mismatch';
    elsif v_existing_count > 0 then
      v_status := 'already_has_assignments';
    elsif v_item.qty <> v_active_count then
      v_status := 'quantity_mismatch';
    elsif v_active_count = 0 then
      v_status := 'no_active_participants';
    else
      v_status := 'safe_exact';
    end if;

    if v_status = 'safe_exact' then
      v_safe := v_safe + 1;
      if p_apply then
        for v_participant in
          select bp.id
          from public.booking_participants bp
          where bp.booking_id = v_item.booking_id
            and coalesce(lower(bp.client_type), '') not in ('cancelled', 'canceled', 'deleted', 'archived', 'removed')
          order by bp.created_at, bp.last_name, bp.first_name
        loop
          insert into public.booking_participant_activities (
            participant_id,
            booking_id,
            extra_id,
            booking_extra_id,
            is_selected,
            source,
            price_snapshot_mad,
            assigned_at,
            assigned_by,
            metadata
          ) values (
            v_participant.id,
            v_item.booking_id,
            v_item.extra_id,
            v_item.booking_extra_id,
            true,
            'safe_reconciliation',
            v_item.unit_price_mad,
            now(),
            v_user_id,
            jsonb_build_object('booking_reference', v_item.reference)
          )
          on conflict (participant_id, extra_id)
          do update set
            is_selected = true,
            booking_id = excluded.booking_id,
            booking_extra_id = excluded.booking_extra_id,
            source = 'safe_reconciliation',
            price_snapshot_mad = excluded.price_snapshot_mad,
            assigned_at = now(),
            assigned_by = v_user_id,
            removed_at = null,
            removed_by = null,
            removal_reason = null,
            metadata = coalesce(public.booking_participant_activities.metadata, '{}'::jsonb) || excluded.metadata
          returning id into v_assignment_id;

          insert into public.booking_participant_activity_history (
            booking_id,
            booking_participant_activity_id,
            participant_id,
            extra_id,
            booking_extra_id,
            action,
            old_state,
            new_state,
            quantity_before,
            quantity_after,
            user_id,
            reason
          ) values (
            v_item.booking_id,
            v_assignment_id,
            v_participant.id,
            v_item.extra_id,
            v_item.booking_extra_id,
            'reconciled',
            jsonb_build_object('selected', false, 'booking_reference', v_item.reference),
            jsonb_build_object('selected', true, 'source', 'safe_reconciliation'),
            v_item.qty,
            v_item.qty,
            v_user_id,
            'safe_exact_booking_extra_reconciliation'
          );
        end loop;
        v_applied := v_applied + 1;
      end if;
    elsif v_status in ('ambiguous_name_mismatch', 'no_activity_match', 'quantity_mismatch') then
      v_ambiguous := v_ambiguous + 1;
    end if;

    v_report := v_report || jsonb_build_array(jsonb_build_object(
      'booking_reference', v_item.reference,
      'booking_id', v_item.booking_id,
      'booking_extra_id', v_item.booking_extra_id,
      'extra_id', v_item.extra_id,
      'name_snapshot', v_item.name_snapshot,
      'activity_name', v_item.extra_name,
      'activity_match_status', v_item.activity_match_status,
      'qty', v_item.qty,
      'active_participants', v_active_count,
      'existing_assignments', v_existing_count,
      'status', v_status
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'trip_id', p_trip_id,
    'apply', p_apply,
    'safe_exact', v_safe,
    'ambiguous', v_ambiguous,
    'applied', v_applied,
    'items', v_report
  );
end;
$$;

grant execute on function public.admin_reconcile_trip_activity_assignments(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
