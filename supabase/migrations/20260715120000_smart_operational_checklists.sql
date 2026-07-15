-- Smart Operational Checklists V1.
-- Generic, template-driven operational checklists for reservations, trips and clients.

create table if not exists public.operation_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  description text,
  category text not null default 'general',
  applies_to text not null default 'booking'
    check (applies_to in ('booking','trip','client','visa')),
  priority text not null default 'medium'
    check (priority in ('low','medium','high','critical')),
  conditions jsonb not null default '{"always": true}'::jsonb,
  default_deadline_offset_days integer,
  recurring_interval_days integer,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_checklists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  checklist_type text not null default 'booking'
    check (checklist_type in ('booking','trip','client','visa','manual')),
  status text not null default 'active'
    check (status in ('active','completed','cancelled','archived')),
  progress_percent integer not null default 0
    check (progress_percent >= 0 and progress_percent <= 100),
  booking_id uuid references public.bookings(id) on delete cascade,
  reservation_id uuid references public.bookings(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete set null,
  visa_application_id uuid references public.visa_applications(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  customer_id uuid references public.clients(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  generated_from text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.operation_checklists(id) on delete cascade,
  template_id uuid references public.operation_checklist_templates(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'general',
  priority text not null default 'medium'
    check (priority in ('low','medium','high','critical')),
  status text not null default 'todo'
    check (status in ('todo','in_progress','waiting','completed','cancelled')),
  assigned_to uuid references auth.users(id) on delete set null,
  deadline timestamptz,
  recurring_interval_days integer check (recurring_interval_days is null or recurring_interval_days > 0),
  next_due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_checklist_history (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid references public.operation_checklists(id) on delete cascade,
  item_id uuid references public.operation_checklist_items(id) on delete cascade,
  action text not null,
  old_status text,
  new_status text,
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_operation_checklist_templates_active
  on public.operation_checklist_templates(applies_to, is_active, sort_order);

create unique index if not exists ux_operation_checklists_booking
  on public.operation_checklists(booking_id)
  where booking_id is not null and checklist_type = 'booking';

create index if not exists idx_operation_checklists_trip
  on public.operation_checklists(trip_id, status, updated_at desc);

create index if not exists idx_operation_checklists_customer
  on public.operation_checklists(customer_id, client_id, status, updated_at desc);

create index if not exists idx_operation_checklist_items_checklist
  on public.operation_checklist_items(checklist_id, status, sort_order);

create unique index if not exists ux_operation_checklist_template_item
  on public.operation_checklist_items(checklist_id, template_id)
  where template_id is not null;

create index if not exists idx_operation_checklist_items_deadline
  on public.operation_checklist_items(deadline)
  where status not in ('completed','cancelled');

create index if not exists idx_operation_checklist_items_assigned
  on public.operation_checklist_items(assigned_to, status, deadline);

drop trigger if exists operation_checklist_templates_updated_at on public.operation_checklist_templates;
create trigger operation_checklist_templates_updated_at
before update on public.operation_checklist_templates
for each row execute function public.set_updated_at();

drop trigger if exists operation_checklists_updated_at on public.operation_checklists;
create trigger operation_checklists_updated_at
before update on public.operation_checklists
for each row execute function public.set_updated_at();

drop trigger if exists operation_checklist_items_updated_at on public.operation_checklist_items;
create trigger operation_checklist_items_updated_at
before update on public.operation_checklist_items
for each row execute function public.set_updated_at();

create or replace function public.operation_template_matches_booking(
  p_template public.operation_checklist_templates,
  p_trip_title text,
  p_trip_destination text
)
returns boolean
language plpgsql
stable
as $$
declare
  v_context text := lower(coalesce(p_trip_title, '') || ' ' || coalesce(p_trip_destination, ''));
  v_value text;
begin
  if coalesce((p_template.conditions ->> 'always')::boolean, false) then
    return true;
  end if;

  if p_template.conditions ? 'destination_contains' then
    for v_value in select lower(value) from jsonb_array_elements_text(p_template.conditions -> 'destination_contains')
    loop
      if v_context like '%' || v_value || '%' then
        return true;
      end if;
    end loop;
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.recalculate_operation_checklist_progress(p_checklist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_done integer;
  v_percent integer;
begin
  select count(*), count(*) filter (where status = 'completed')
  into v_total, v_done
  from public.operation_checklist_items
  where checklist_id = p_checklist_id
    and status <> 'cancelled';

  v_percent := case when coalesce(v_total, 0) = 0 then 0 else round((v_done::numeric / v_total::numeric) * 100)::integer end;

  update public.operation_checklists
  set progress_percent = v_percent,
      status = case when v_total > 0 and v_done = v_total then 'completed' else 'active' end,
      updated_at = now()
  where id = p_checklist_id;
end;
$$;

create or replace function public.ensure_operation_checklist_for_booking(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_checklist_id uuid;
  v_template public.operation_checklist_templates%rowtype;
begin
  select b.id, b.reference, b.trip_id, b.client_id, b.agency_organization_id, t.title as trip_title, t.destination as trip_destination
  into v_booking
  from public.bookings b
  left join public.trips t on t.id = b.trip_id
  where b.id = p_booking_id;

  if not found then
    raise exception 'booking_not_found';
  end if;

  insert into public.operation_checklists (
    title,
    checklist_type,
    booking_id,
    reservation_id,
    trip_id,
    customer_id,
    client_id,
    organization_id,
    generated_from,
    metadata
  )
  values (
    'Checklist opérationnelle · ' || coalesce(v_booking.reference, p_booking_id::text),
    'booking',
    v_booking.id,
    v_booking.id,
    v_booking.trip_id,
    v_booking.client_id,
    v_booking.client_id,
    v_booking.agency_organization_id,
    'booking_created',
    jsonb_build_object('booking_reference', v_booking.reference)
  )
  on conflict (booking_id) where booking_id is not null and checklist_type = 'booking'
  do update set
    trip_id = excluded.trip_id,
    customer_id = excluded.customer_id,
    client_id = excluded.client_id,
    organization_id = excluded.organization_id,
    updated_at = now()
  returning id into v_checklist_id;

  for v_template in
    select *
    from public.operation_checklist_templates
    where is_active = true
      and applies_to = 'booking'
    order by sort_order, title
  loop
    if public.operation_template_matches_booking(v_template, v_booking.trip_title, v_booking.trip_destination) then
      insert into public.operation_checklist_items (
        checklist_id,
        template_id,
        title,
        description,
        category,
        priority,
        deadline,
        recurring_interval_days,
        sort_order,
        metadata
      )
      values (
        v_checklist_id,
        v_template.id,
        v_template.title,
        v_template.description,
        v_template.category,
        v_template.priority,
        case
          when v_template.default_deadline_offset_days is null then null
          else now() + make_interval(days => v_template.default_deadline_offset_days)
        end,
        v_template.recurring_interval_days,
        v_template.sort_order,
        jsonb_build_object('template_key', v_template.key, 'generated_from', 'booking_created')
      )
      on conflict (checklist_id, template_id) where template_id is not null
      do nothing;
    end if;
  end loop;

  perform public.recalculate_operation_checklist_progress(v_checklist_id);
  return v_checklist_id;
end;
$$;

create or replace function public.handle_booking_operation_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_operation_checklist_for_booking(new.id);
  return new;
end;
$$;

drop trigger if exists bookings_operation_checklist_after_insert on public.bookings;
create trigger bookings_operation_checklist_after_insert
after insert on public.bookings
for each row execute function public.handle_booking_operation_checklist();

create or replace function public.handle_operation_checklist_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_deadline timestamptz;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.operation_checklist_history (checklist_id, item_id, action, old_status, new_status, user_id, metadata)
    values (new.checklist_id, new.id, 'status_changed', old.status, new.status, auth.uid(), '{}'::jsonb);
  end if;

  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and new.status = 'completed'
     and new.recurring_interval_days is not null
     and new.recurring_interval_days > 0 then
    v_next_deadline := coalesce(new.next_due_at, new.deadline, now()) + make_interval(days => new.recurring_interval_days);
    insert into public.operation_checklist_items (
      checklist_id,
      template_id,
      title,
      description,
      category,
      priority,
      deadline,
      recurring_interval_days,
      sort_order,
      metadata
    )
    values (
      new.checklist_id,
      null,
      new.title,
      new.description,
      new.category,
      new.priority,
      v_next_deadline,
      new.recurring_interval_days,
      new.sort_order + 1,
      coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('recurring_from_item_id', new.id)
    );
  end if;

  perform public.recalculate_operation_checklist_progress(new.checklist_id);
  return new;
end;
$$;

drop trigger if exists operation_checklist_item_after_insert on public.operation_checklist_items;
create trigger operation_checklist_item_after_insert
after insert on public.operation_checklist_items
for each row execute function public.handle_operation_checklist_item_change();

drop trigger if exists operation_checklist_item_after_update on public.operation_checklist_items;
create trigger operation_checklist_item_after_update
after update on public.operation_checklist_items
for each row execute function public.handle_operation_checklist_item_change();

insert into public.operation_checklist_templates (key, title, description, category, priority, conditions, default_deadline_offset_days, sort_order)
values
  ('passport_check', 'Vérifier le passeport', 'Contrôler validité, identité et cohérence avec la réservation.', 'passport', 'high', '{"always": true}'::jsonb, 2, 10),
  ('visa_followup', 'Suivre le visa Japon', 'Vérifier que le dossier visa est lancé, complet et suivi.', 'visa', 'high', '{"destination_contains": ["japon", "japan"]}'::jsonb, 3, 20),
  ('insurance_check', 'Vérifier assurance voyage', 'Confirmer assurance ou informer le client des documents attendus.', 'insurance', 'medium', '{"always": true}'::jsonb, 7, 30),
  ('flight_reservation', 'Réserver le vol client', 'Réserver les vols, contrôler PNR et émission billet.', 'flight', 'high', '{"always": true}'::jsonb, 1, 40),
  ('jr_pass_check', 'Préparer JR Pass / transports Japon', 'Vérifier besoin JR Pass ou pass transport selon programme.', 'jr_pass', 'medium', '{"destination_contains": ["japon", "japan"]}'::jsonb, 14, 50),
  ('hotel_rooming', 'Valider hôtels et rooming', 'Contrôler affectations chambres, hôtels et demandes spéciales.', 'hotel', 'high', '{"always": true}'::jsonb, 10, 60),
  ('airport_transfer', 'Confirmer transfert aéroport', 'Vérifier horaires, point de rendez-vous et contact transfert.', 'airport_transfer', 'medium', '{"always": true}'::jsonb, 10, 70),
  ('final_documents', 'Préparer documents finaux', 'Assembler billets, vouchers, programme et consignes client.', 'final_documents', 'critical', '{"always": true}'::jsonb, 21, 80)
on conflict (key) do update set
  title = excluded.title,
  description = excluded.description,
  category = excluded.category,
  priority = excluded.priority,
  conditions = excluded.conditions,
  default_deadline_offset_days = excluded.default_deadline_offset_days,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

do $$
declare
  v_booking record;
begin
  for v_booking in select id from public.bookings loop
    perform public.ensure_operation_checklist_for_booking(v_booking.id);
  end loop;
end;
$$;

alter table public.operation_checklist_templates enable row level security;
alter table public.operation_checklists enable row level security;
alter table public.operation_checklist_items enable row level security;
alter table public.operation_checklist_history enable row level security;

drop policy if exists "staff manage operation checklist templates" on public.operation_checklist_templates;
create policy "staff manage operation checklist templates"
on public.operation_checklist_templates
for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "staff manage operation checklists" on public.operation_checklists;
create policy "staff manage operation checklists"
on public.operation_checklists
for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "assigned users read operation checklists" on public.operation_checklists;
create policy "assigned users read operation checklists"
on public.operation_checklists
for select
using (
  exists (
    select 1 from public.operation_checklist_items i
    where i.checklist_id = operation_checklists.id
      and i.assigned_to = auth.uid()
  )
);

drop policy if exists "staff manage operation checklist items" on public.operation_checklist_items;
create policy "staff manage operation checklist items"
on public.operation_checklist_items
for all
using (public.is_staff(auth.uid()))
with check (public.is_staff(auth.uid()));

drop policy if exists "assigned users update own operation checklist items" on public.operation_checklist_items;
create policy "assigned users update own operation checklist items"
on public.operation_checklist_items
for update
using (assigned_to = auth.uid())
with check (assigned_to = auth.uid());

drop policy if exists "assigned users read own operation checklist items" on public.operation_checklist_items;
create policy "assigned users read own operation checklist items"
on public.operation_checklist_items
for select
using (assigned_to = auth.uid());

drop policy if exists "staff read operation checklist history" on public.operation_checklist_history;
create policy "staff read operation checklist history"
on public.operation_checklist_history
for select
using (public.is_staff(auth.uid()));

grant execute on function public.ensure_operation_checklist_for_booking(uuid) to authenticated;
grant execute on function public.recalculate_operation_checklist_progress(uuid) to authenticated;

notify pgrst, 'reload schema';
