-- Operation task engine V2, phase 1.
--
-- This migration is deliberately additive:
-- - it does not create any automation trigger;
-- - it does not update, close, merge, or delete existing tasks;
-- - it leaves the legacy operation_checklist_* engine enabled;
-- - it prepares strict V2 helpers and a read-only dry run for later activation.

alter table public.operation_task_templates
  add column if not exists scope_type text,
  add column if not exists trigger_key text,
  add column if not exists trigger_version text,
  add column if not exists deadline_anchor text,
  add column if not exists deadline_offset_days integer,
  add column if not exists late_booking_grace_hours integer,
  add column if not exists auto_completion_key text,
  add column if not exists travel_type text,
  add column if not exists default_assignee_role text,
  add column if not exists conditions jsonb,
  add column if not exists lifecycle_phase text;

alter table public.operation_task_templates
  alter column trigger_version set default 'v2',
  alter column late_booking_grace_hours set default 24,
  alter column travel_type set default 'all',
  alter column conditions set default '{}'::jsonb,
  alter column lifecycle_phase set default 'pre_departure';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_task_templates_scope_type_check'
      and conrelid = 'public.operation_task_templates'::regclass
  ) then
    alter table public.operation_task_templates
      add constraint operation_task_templates_scope_type_check
      check (scope_type is null or scope_type in ('reservation', 'traveler', 'trip', 'visa', 'client'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_task_templates_deadline_anchor_check'
      and conrelid = 'public.operation_task_templates'::regclass
  ) then
    alter table public.operation_task_templates
      add constraint operation_task_templates_deadline_anchor_check
      check (deadline_anchor is null or deadline_anchor in ('event', 'trip_start', 'visa_event', 'payment_event'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_task_templates_travel_type_check'
      and conrelid = 'public.operation_task_templates'::regclass
  ) then
    alter table public.operation_task_templates
      add constraint operation_task_templates_travel_type_check
      check (travel_type is null or travel_type in ('organized', 'fit', 'all'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_task_templates_late_grace_check'
      and conrelid = 'public.operation_task_templates'::regclass
  ) then
    alter table public.operation_task_templates
      add constraint operation_task_templates_late_grace_check
      check (late_booking_grace_hours is null or late_booking_grace_hours >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_task_templates_conditions_object_check'
      and conrelid = 'public.operation_task_templates'::regclass
  ) then
    alter table public.operation_task_templates
      add constraint operation_task_templates_conditions_object_check
      check (conditions is null or jsonb_typeof(conditions) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_task_templates_lifecycle_phase_check'
      and conrelid = 'public.operation_task_templates'::regclass
  ) then
    alter table public.operation_task_templates
      add constraint operation_task_templates_lifecycle_phase_check
      check (lifecycle_phase is null or lifecycle_phase in ('pre_departure', 'post_departure', 'any'));
  end if;
end $$;

-- V2 task identity is stored explicitly. Existing rows remain untouched/null.
alter table public.operation_tasks
  add column if not exists template_key text,
  add column if not exists scope_type text,
  add column if not exists scope_entity_id uuid,
  add column if not exists trigger_key text,
  add column if not exists trigger_version text,
  add column if not exists participant_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_tasks_scope_type_v2_check'
      and conrelid = 'public.operation_tasks'::regclass
  ) then
    alter table public.operation_tasks
      add constraint operation_tasks_scope_type_v2_check
      check (scope_type is null or scope_type in ('reservation', 'traveler', 'trip', 'visa', 'client'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'operation_tasks_participant_id_fkey'
      and conrelid = 'public.operation_tasks'::regclass
  ) then
    alter table public.operation_tasks
      add constraint operation_tasks_participant_id_fkey
      foreign key (participant_id) references public.booking_participants(id) on delete set null;
  end if;
end $$;

create index if not exists idx_operation_task_templates_v2_active
  on public.operation_task_templates(scope_type, trigger_key, travel_type, display_order)
  where is_active = true and archived_at is null and allow_auto_trigger = true;

create index if not exists idx_operation_tasks_v2_scope_active
  on public.operation_tasks(scope_type, scope_entity_id, trigger_key, status)
  where trigger_version = 'v2' and status not in ('completed', 'cancelled');

create index if not exists idx_operation_tasks_participant
  on public.operation_tasks(participant_id, status)
  where participant_id is not null;

-- Existing flight keys are enriched, not replaced. New keys are prepared for
-- dry-run only because this migration installs no event triggers.
insert into public.operation_task_templates (
  template_key,
  title,
  description,
  priority,
  category,
  deadline_interval,
  display_order,
  is_active,
  allow_auto_trigger,
  scope_type,
  trigger_key,
  trigger_version,
  deadline_anchor,
  deadline_offset_days,
  late_booking_grace_hours,
  auto_completion_key,
  travel_type,
  default_assignee_role,
  conditions,
  lifecycle_phase,
  metadata
)
values
  (
    'passport_check_v2', 'Contrôler les informations du passeport',
    'Vérifier les informations reçues sans considérer la présence du numéro comme une validation humaine.',
    'high', 'passport', null, 110, true, true,
    'traveler', 'booking_confirmed', 'v2', 'trip_start', -90, 24, null, 'all', null,
    '{"information_received_key":"passport_number_present","human_verification_required":true}'::jsonb,
    'pre_departure', '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'visa_japan_v2', 'Suivre le visa Japon',
    'Suivre le dossier visa jusqu’à son approbation ou sa clôture.',
    'high', 'visa', null, 120, true, true,
    'visa', 'visa_application_created', 'v2', 'trip_start', -30, 24, 'visa_status_approved', 'all', null,
    '{"destination_contains":["japon","japan"],"completion_statuses":["approved","completed"]}'::jsonb,
    'pre_departure', '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'insurance_check_v2', 'Vérifier l’assurance voyage',
    'Confirmer manuellement que les informations d’assurance nécessaires sont disponibles.',
    'medium', 'insurance', null, 130, true, true,
    'reservation', 'booking_confirmed', 'v2', 'trip_start', -14, 24, null, 'all', null,
    '{}'::jsonb, 'pre_departure',
    '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'reserve_flight', 'Réserver le billet d’avion',
    'Réserver le vol client après confirmation du paiement.',
    'high', 'flight_reservation', interval '24 hours', 10, true, true,
    'reservation', 'payment_received', 'v2', 'payment_event', 1, 24, 'flight_reserved', 'all', null,
    '{"completion_statuses":["booked","reserved","partially_ticketed","ticketed","delivered","ticket_sent"]}'::jsonb,
    'pre_departure', '{"engine":"operation_tasks_v2","legacy_workflow_active":true}'::jsonb
  ),
  (
    'send_flight_ticket', 'Envoyer le billet au client',
    'Envoyer le billet au client et confirmer l’envoi.',
    'high', 'flight_ticket_delivery', interval '24 hours', 20, true, true,
    'reservation', 'flight_reserved', 'v2', 'event', 1, 24, 'flight_ticket_delivered', 'all', null,
    '{"completion_statuses":["delivered","ticket_sent"]}'::jsonb,
    'pre_departure', '{"engine":"operation_tasks_v2","legacy_workflow_active":true}'::jsonb
  ),
  (
    'hotel_confirmation_v2', 'Confirmer les hôtels du groupe',
    'Confirmer les hôtels retenus pour le voyage organisé.',
    'high', 'hotel', null, 210, true, true,
    'trip', 'trip_operational', 'v2', 'trip_start', -45, 24, null, 'organized', null,
    '{}'::jsonb, 'pre_departure',
    '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'rooming_final_v2', 'Finaliser le rooming',
    'Affecter tous les voyageurs concernés aux chambres du voyage.',
    'high', 'rooming', null, 220, true, true,
    'trip', 'trip_operational', 'v2', 'trip_start', -30, 24, 'rooming_complete', 'organized', null,
    '{}'::jsonb, 'pre_departure',
    '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'guide_confirmation_v2', 'Confirmer le guide',
    'Confirmer le guide du voyage organisé.',
    'high', 'guide', null, 230, true, true,
    'trip', 'trip_operational', 'v2', 'trip_start', -30, 24, null, 'organized', null,
    '{}'::jsonb, 'pre_departure',
    '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'group_transport_v2', 'Confirmer le transport du groupe',
    'Confirmer les transports collectifs du voyage organisé.',
    'high', 'transport', null, 240, true, true,
    'trip', 'trip_operational', 'v2', 'trip_start', -21, 24, null, 'organized', null,
    '{}'::jsonb, 'pre_departure',
    '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'airport_transfers_v2', 'Confirmer les transferts',
    'Confirmer les transferts aéroport du voyage organisé.',
    'high', 'airport_transfer', null, 250, true, true,
    'trip', 'trip_operational', 'v2', 'trip_start', -7, 24, null, 'organized', null,
    '{}'::jsonb, 'pre_departure',
    '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  ),
  (
    'final_documents_v2', 'Préparer les documents finaux',
    'Préparer les documents finaux du voyage. La clôture reste manuelle tant qu’aucune preuve structurée complète n’existe.',
    'critical', 'final_documents', null, 260, true, true,
    'trip', 'trip_operational', 'v2', 'trip_start', -7, 24, null, 'organized', null,
    '{}'::jsonb, 'pre_departure',
    '{"engine":"operation_tasks_v2","activation":"prepared_no_trigger"}'::jsonb
  )
on conflict (template_key) do update
set
  scope_type = excluded.scope_type,
  trigger_key = excluded.trigger_key,
  trigger_version = excluded.trigger_version,
  deadline_anchor = excluded.deadline_anchor,
  deadline_offset_days = excluded.deadline_offset_days,
  late_booking_grace_hours = excluded.late_booking_grace_hours,
  auto_completion_key = excluded.auto_completion_key,
  travel_type = excluded.travel_type,
  default_assignee_role = excluded.default_assignee_role,
  conditions = excluded.conditions,
  lifecycle_phase = excluded.lifecycle_phase,
  metadata = coalesce(public.operation_task_templates.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = statement_timestamp();

-- operation_task_template_defaults(text) is intentionally not replaced here.
-- Phase 1 must not change the behavior of legacy generators. The legacy
-- fallback will be hardened only in the future activation migration.

create or replace function public.operation_task_template_v2(p_template_key text)
returns table(
  template_key text,
  title text,
  description text,
  priority text,
  category text,
  scope_type text,
  trigger_key text,
  trigger_version text,
  deadline_anchor text,
  deadline_offset_days integer,
  late_booking_grace_hours integer,
  auto_completion_key text,
  travel_type text,
  default_assignee_role text,
  conditions jsonb,
  lifecycle_phase text
)
language sql
stable
set search_path = pg_catalog, public
as $$
  select
    t.template_key,
    t.title,
    t.description,
    t.priority,
    t.category,
    t.scope_type,
    t.trigger_key,
    coalesce(t.trigger_version, 'v2'),
    t.deadline_anchor,
    t.deadline_offset_days,
    coalesce(t.late_booking_grace_hours, 24),
    t.auto_completion_key,
    coalesce(t.travel_type, 'all'),
    t.default_assignee_role,
    coalesce(t.conditions, '{}'::jsonb),
    coalesce(t.lifecycle_phase, 'pre_departure')
  from public.operation_task_templates t
  where t.template_key = p_template_key
    and t.is_active = true
    and t.archived_at is null
    and t.allow_auto_trigger = true
    and t.scope_type is not null
    and t.trigger_key is not null
    and t.deadline_anchor is not null
  limit 1
$$;

create or replace function public.calculate_operation_task_deadline_v2(
  p_deadline_anchor text,
  p_deadline_offset_days integer,
  p_late_booking_grace_hours integer,
  p_trip_start date,
  p_event_at timestamptz,
  p_now timestamptz default statement_timestamp()
)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_target timestamptz;
  v_offset integer := coalesce(p_deadline_offset_days, 0);
  v_grace integer := greatest(coalesce(p_late_booking_grace_hours, 24), 0);
begin
  case p_deadline_anchor
    when 'trip_start' then
      if p_trip_start is null then
        return null;
      end if;
      v_target := p_trip_start::timestamptz + make_interval(days => v_offset);
    when 'event', 'visa_event', 'payment_event' then
      if p_event_at is null then
        return null;
      end if;
      v_target := p_event_at + make_interval(days => v_offset);
    else
      raise exception 'unsupported_operation_task_deadline_anchor'
        using errcode = '22023', detail = coalesce(p_deadline_anchor, '<null>');
  end case;

  if v_target <= p_now then
    return p_now + make_interval(hours => v_grace);
  end if;

  return v_target;
end;
$$;

create or replace function public.operation_task_deduplication_key_v2(
  p_template_key text,
  p_scope_type text,
  p_entity_id uuid,
  p_event_key text,
  p_trigger_version text default 'v2'
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_template text := lower(trim(coalesce(p_template_key, '')));
  v_scope text := lower(trim(coalesce(p_scope_type, '')));
  v_event text := lower(trim(coalesce(p_event_key, '')));
  v_version text := lower(trim(coalesce(p_trigger_version, 'v2')));
begin
  if v_template = '' or v_scope = '' or p_entity_id is null or v_event = '' or v_version = '' then
    raise exception 'operation_task_deduplication_components_required' using errcode = '22023';
  end if;
  if v_scope not in ('reservation', 'traveler', 'trip', 'visa', 'client') then
    raise exception 'invalid_operation_task_scope' using errcode = '22023', detail = v_scope;
  end if;

  return concat_ws(':', v_template, v_scope, p_entity_id::text, v_event, v_version);
end;
$$;

create or replace function public.operation_task_existing_id_v2(
  p_template_key text,
  p_deduplication_key text,
  p_booking_id uuid default null,
  p_trip_id uuid default null,
  p_visa_application_id uuid default null,
  p_participant_id uuid default null
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select t.id
  from public.operation_tasks t
  where
    t.deduplication_key = p_deduplication_key
    or coalesce(t.metadata->>'source_key', '') = p_deduplication_key
    or (
      p_template_key = 'reserve_flight'
      and p_booking_id is not null
      and t.booking_id = p_booking_id
      and t.category = 'flight_reservation'
    )
    or (
      p_template_key = 'send_flight_ticket'
      and p_booking_id is not null
      and t.booking_id = p_booking_id
      and t.category = 'flight_ticket_delivery'
    )
    or (
      t.template_key = p_template_key
      and t.booking_id is not distinct from p_booking_id
      and t.trip_id is not distinct from p_trip_id
      and t.visa_application_id is not distinct from p_visa_application_id
      and t.participant_id is not distinct from p_participant_id
    )
  order by
    case when t.status not in ('completed', 'cancelled') then 0 else 1 end,
    t.created_at,
    t.id
  limit 1
$$;

create or replace function public.ensure_operation_task_v2(
  p_template_key text,
  p_entity_id uuid,
  p_event_key text,
  p_event_at timestamptz default statement_timestamp(),
  p_booking_id uuid default null,
  p_participant_id uuid default null,
  p_trip_id uuid default null,
  p_visa_application_id uuid default null,
  p_customer_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_template record;
  v_booking public.bookings%rowtype;
  v_participant public.booking_participants%rowtype;
  v_visa public.visa_applications%rowtype;
  v_trip_start date;
  v_travel_type text := 'all';
  v_dedup text;
  v_existing_id uuid;
  v_task_id uuid;
  v_deadline timestamptz;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_template
  from public.operation_task_template_v2(p_template_key)
  limit 1;

  -- Disabled, archived, legacy-only, or incomplete templates create nothing.
  if not found then
    return null;
  end if;

  if p_event_key is distinct from v_template.trigger_key then
    raise exception 'operation_task_trigger_mismatch'
      using errcode = '22023', detail = concat(p_event_key, ' <> ', v_template.trigger_key);
  end if;

  case v_template.scope_type
    when 'reservation' then
      if p_entity_id is distinct from p_booking_id and p_booking_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      select * into v_booking from public.bookings where id = p_entity_id;
      p_booking_id := p_entity_id;
    when 'traveler' then
      if p_entity_id is distinct from p_participant_id and p_participant_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      select * into v_participant from public.booking_participants where id = p_entity_id;
      if not found then raise exception 'operation_task_scope_entity_not_found' using errcode = 'P0002'; end if;
      p_participant_id := p_entity_id;
      p_booking_id := coalesce(p_booking_id, v_participant.booking_id);
      p_trip_id := coalesce(p_trip_id, v_participant.trip_id);
      p_customer_id := coalesce(p_customer_id, v_participant.client_id);
      select * into v_booking from public.bookings where id = p_booking_id;
    when 'trip' then
      if p_entity_id is distinct from p_trip_id and p_trip_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      p_trip_id := p_entity_id;
    when 'visa' then
      if p_entity_id is distinct from p_visa_application_id and p_visa_application_id is not null then
        raise exception 'operation_task_scope_entity_mismatch' using errcode = '22023';
      end if;
      select * into v_visa from public.visa_applications where id = p_entity_id;
      if not found then raise exception 'operation_task_scope_entity_not_found' using errcode = 'P0002'; end if;
      p_visa_application_id := p_entity_id;
      p_booking_id := coalesce(p_booking_id, v_visa.booking_id);
      p_trip_id := coalesce(p_trip_id, v_visa.selected_trip_id, v_visa.document_trip_id);
      p_customer_id := coalesce(p_customer_id, v_visa.client_id, v_visa.linked_client_id);
      if p_booking_id is not null then
        select * into v_booking from public.bookings where id = p_booking_id;
      end if;
    when 'client' then
      p_customer_id := p_entity_id;
    else
      raise exception 'unsupported_operation_task_scope' using errcode = '22023';
  end case;

  if v_template.scope_type = 'reservation' and not found then
    raise exception 'operation_task_scope_entity_not_found' using errcode = 'P0002';
  end if;

  if p_booking_id is not null and v_booking.id is null then
    select * into v_booking from public.bookings where id = p_booking_id;
  end if;

  p_trip_id := coalesce(p_trip_id, v_booking.trip_id);
  p_customer_id := coalesce(p_customer_id, v_booking.client_id);

  select t.start_date into v_trip_start
  from public.trips t
  where t.id = p_trip_id;
  v_trip_start := coalesce(v_trip_start, v_booking.travel_start_date);

  v_travel_type := case
    when v_template.scope_type = 'trip' then 'organized'
    when v_booking.originating_fit_quote_id is not null or v_booking.fit_quote_acceptance_id is not null then 'fit'
    when p_trip_id is not null then 'organized'
    else 'fit'
  end;

  if v_template.travel_type not in ('all', v_travel_type) then
    return null;
  end if;

  v_dedup := public.operation_task_deduplication_key_v2(
    p_template_key,
    v_template.scope_type,
    p_entity_id,
    p_event_key,
    v_template.trigger_version
  );

  v_existing_id := public.operation_task_existing_id_v2(
    p_template_key,
    v_dedup,
    p_booking_id,
    p_trip_id,
    p_visa_application_id,
    p_participant_id
  );
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  v_deadline := public.calculate_operation_task_deadline_v2(
    v_template.deadline_anchor,
    v_template.deadline_offset_days,
    v_template.late_booking_grace_hours,
    v_trip_start,
    p_event_at,
    statement_timestamp()
  );

  insert into public.operation_tasks (
    title, description, priority, status, assigned_to,
    reservation_id, booking_id, participant_id, trip_id,
    visa_application_id, customer_id, category, deadline,
    created_by, deduplication_key, template_key, scope_type,
    scope_entity_id, trigger_key, trigger_version, metadata
  )
  values (
    v_template.title, v_template.description, v_template.priority, 'todo', null,
    p_booking_id, p_booking_id, p_participant_id, p_trip_id,
    p_visa_application_id, p_customer_id, v_template.category, v_deadline,
    auth.uid(), v_dedup, p_template_key, v_template.scope_type,
    p_entity_id, p_event_key, v_template.trigger_version,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'engine', 'operation_tasks_v2',
      'deadline_anchor', v_template.deadline_anchor,
      'default_assignee_role', v_template.default_assignee_role
    )
  )
  on conflict (deduplication_key) where deduplication_key is not null
  do nothing
  returning id into v_task_id;

  if v_task_id is null then
    select id into v_task_id
    from public.operation_tasks
    where deduplication_key = v_dedup
    limit 1;
    return v_task_id;
  end if;

  perform public.log_operation_task_history(
    v_task_id,
    'created_v2',
    null,
    'todo',
    jsonb_build_object('template_key', p_template_key, 'trigger_key', p_event_key)
  );
  return v_task_id;
end;
$$;

create or replace function public.operation_task_auto_completion_satisfied_v2(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task public.operation_tasks%rowtype;
  v_completion_key text;
  v_participant_count integer;
  v_assigned_count integer;
begin
  select * into v_task from public.operation_tasks where id = p_task_id;
  if not found then return false; end if;

  select t.auto_completion_key into v_completion_key
  from public.operation_task_templates t
  where t.template_key = v_task.template_key;

  if v_completion_key = 'flight_reserved' then
    return exists (
      select 1 from public.booking_flight_reservations f
      where f.booking_id = v_task.booking_id
        and f.status in ('booked', 'reserved', 'partially_ticketed', 'ticketed', 'delivered', 'ticket_sent')
    );
  elsif v_completion_key = 'flight_ticket_delivered' then
    return exists (
      select 1 from public.booking_flight_reservations f
      where f.booking_id = v_task.booking_id
        and (f.ticket_sent_to_customer = true or f.status in ('delivered', 'ticket_sent'))
    );
  elsif v_completion_key = 'visa_status_approved' then
    return exists (
      select 1 from public.visa_applications v
      where v.id = v_task.visa_application_id
        and v.status::text in ('approved', 'completed')
    );
  elsif v_completion_key = 'rooming_complete' then
    select
      count(distinct bp.id),
      count(distinct ra.participant_id) filter (where ra.id is not null)
    into v_participant_count, v_assigned_count
    from public.booking_participants bp
    join public.bookings b on b.id = bp.booking_id
    left join public.trip_hotels th on th.trip_id = v_task.trip_id
    left join public.trip_rooms tr on tr.trip_hotel_id = th.id
    left join public.room_assignments ra
      on ra.room_id = tr.id and ra.participant_id = bp.id
    where bp.trip_id = v_task.trip_id
      and b.status::text in ('confirmed', 'paid');

    return coalesce(v_participant_count, 0) > 0
      and v_assigned_count = v_participant_count;
  end if;

  return false;
end;
$$;

create or replace function public.complete_operation_task_if_satisfied_v2(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old_status text;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if not public.operation_task_auto_completion_satisfied_v2(p_task_id) then
    return false;
  end if;

  select status into v_old_status
  from public.operation_tasks
  where id = p_task_id
    and status not in ('completed', 'cancelled')
  for update;

  if not found then return false; end if;

  update public.operation_tasks
  set status = 'completed',
      completed_at = statement_timestamp(),
      completed_by = auth.uid(),
      updated_at = statement_timestamp(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('auto_completed_by', 'operation_tasks_v2')
  where id = p_task_id;

  perform public.log_operation_task_history(
    p_task_id,
    'auto_completed_v2',
    v_old_status,
    'completed',
    '{}'::jsonb
  );
  return true;
end;
$$;

-- Prepared lifecycle handler. It is intentionally not attached to bookings or
-- trips in phase 1 and only targets future V2 task instances.
create or replace function public.cancel_operation_tasks_for_lifecycle_v2(
  p_event_key text,
  p_booking_id uuid default null,
  p_trip_id uuid default null,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_task record;
  v_count integer := 0;
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_event_key not in ('booking_cancelled', 'booking_completed', 'trip_archived', 'trip_completed') then
    raise exception 'unsupported_operation_task_lifecycle_event' using errcode = '22023';
  end if;

  for v_task in
    select ot.id, ot.status
    from public.operation_tasks ot
    left join public.operation_task_templates tt on tt.template_key = ot.template_key
    where ot.trigger_version = 'v2'
      and ot.status in ('todo', 'in_progress', 'waiting')
      and (
        (p_event_key = 'booking_cancelled' and p_booking_id is not null and ot.booking_id = p_booking_id)
        or (
          p_event_key = 'booking_completed'
          and p_booking_id is not null
          and ot.booking_id = p_booking_id
          and coalesce(tt.lifecycle_phase, 'pre_departure') = 'pre_departure'
        )
        or (
          p_event_key in ('trip_archived', 'trip_completed')
          and p_trip_id is not null
          and ot.trip_id = p_trip_id
          and coalesce(tt.lifecycle_phase, 'pre_departure') = 'pre_departure'
        )
      )
    for update of ot
  loop
    update public.operation_tasks
    set status = 'cancelled',
        completed_at = null,
        completed_by = null,
        updated_at = statement_timestamp(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'lifecycle_event', p_event_key,
          'lifecycle_reason', nullif(trim(coalesce(p_reason, '')), '')
        )
    where id = v_task.id;

    perform public.log_operation_task_history(
      v_task.id,
      'lifecycle_cancelled_v2',
      v_task.status,
      'cancelled',
      jsonb_build_object('event_key', p_event_key, 'reason', nullif(trim(coalesce(p_reason, '')), ''))
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Read-only projection. It computes the candidates which V2 would create for
-- active reservations, visa files, and future organized trips. No DML occurs.
create or replace function public.dry_run_operation_tasks_v2(
  p_as_of timestamptz default statement_timestamp()
)
returns table(
  template_key text,
  template_title text,
  scope_type text,
  entity_id uuid,
  entity_label text,
  trigger_key text,
  deadline timestamptz,
  priority text,
  existing_task boolean,
  completion_satisfied boolean,
  would_create boolean,
  deduplication_key text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null and not public.v2_is_staff(auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
  with active_templates as (
    select t.*
    from public.operation_task_templates t
    where t.is_active = true
      and t.archived_at is null
      and t.allow_auto_trigger = true
      and t.scope_type is not null
      and t.trigger_key is not null
      and t.deadline_anchor is not null
      and coalesce(t.trigger_version, 'v2') = 'v2'
  ),
  active_bookings as (
    select
      b.*,
      coalesce(tr.start_date, b.travel_start_date) as effective_start_date,
      case
        when b.originating_fit_quote_id is not null or b.fit_quote_acceptance_id is not null then 'fit'
        when b.trip_id is not null then 'organized'
        else 'fit'
      end as effective_travel_type
    from public.bookings b
    left join public.trips tr on tr.id = b.trip_id
    where b.status::text in ('confirmed', 'paid')
      and (tr.id is null or tr.archived_at is null)
  ),
  candidates as (
    select
      t.template_key, t.title, t.priority, t.scope_type, t.trigger_key,
      coalesce(t.trigger_version, 'v2') as trigger_version,
      t.deadline_anchor, t.deadline_offset_days,
      coalesce(t.late_booking_grace_hours, 24) as late_booking_grace_hours,
      bp.id as entity_id,
      concat_ws(' · ', nullif(trim(concat_ws(' ', bp.first_name, bp.last_name)), ''), b.reference) as entity_label,
      b.id as booking_id, bp.id as participant_id, b.trip_id,
      null::uuid as visa_application_id,
      b.updated_at as event_at,
      false as completion_satisfied
    from active_templates t
    join active_bookings b on t.scope_type = 'traveler' and t.trigger_key = 'booking_confirmed'
    join public.booking_participants bp on bp.booking_id = b.id
    where coalesce(t.travel_type, 'all') in ('all', b.effective_travel_type)

    union all

    select
      t.template_key, t.title, t.priority, t.scope_type, t.trigger_key,
      coalesce(t.trigger_version, 'v2'), t.deadline_anchor, t.deadline_offset_days,
      coalesce(t.late_booking_grace_hours, 24),
      b.id, concat_ws(' · ', b.reference, b.contact_name),
      b.id, null::uuid, b.trip_id, null::uuid, b.updated_at, false
    from active_templates t
    join active_bookings b on t.scope_type = 'reservation' and t.trigger_key = 'booking_confirmed'
    where coalesce(t.travel_type, 'all') in ('all', b.effective_travel_type)

    union all

    select
      t.template_key, t.title, t.priority, t.scope_type, t.trigger_key,
      coalesce(t.trigger_version, 'v2'), t.deadline_anchor, t.deadline_offset_days,
      coalesce(t.late_booking_grace_hours, 24),
      b.id, concat_ws(' · ', b.reference, b.contact_name),
      b.id, null::uuid, b.trip_id, null::uuid,
      coalesce(p.last_paid_at, b.updated_at),
      exists (
        select 1 from public.booking_flight_reservations f
        where f.booking_id = b.id
          and f.status in ('booked', 'reserved', 'partially_ticketed', 'ticketed', 'delivered', 'ticket_sent')
      )
    from active_templates t
    join active_bookings b on t.scope_type = 'reservation' and t.trigger_key = 'payment_received'
    join lateral (
      select max(coalesce(pay.paid_at, pay.created_at)) as last_paid_at
      from public.payments pay
      where pay.booking_id = b.id and pay.status::text in ('received', 'paid', 'completed')
    ) p on p.last_paid_at is not null
    where coalesce(t.travel_type, 'all') in ('all', b.effective_travel_type)

    union all

    select
      t.template_key, t.title, t.priority, t.scope_type, t.trigger_key,
      coalesce(t.trigger_version, 'v2'), t.deadline_anchor, t.deadline_offset_days,
      coalesce(t.late_booking_grace_hours, 24),
      b.id, concat_ws(' · ', b.reference, b.contact_name),
      b.id, null::uuid, b.trip_id, null::uuid,
      f.updated_at,
      (f.ticket_sent_to_customer = true or f.status in ('delivered', 'ticket_sent'))
    from active_templates t
    join active_bookings b on t.scope_type = 'reservation' and t.trigger_key = 'flight_reserved'
    join lateral (
      select fr.*
      from public.booking_flight_reservations fr
      where fr.booking_id = b.id
        and fr.status in ('booked', 'reserved', 'partially_ticketed', 'ticketed', 'delivered', 'ticket_sent')
      order by fr.updated_at desc, fr.id
      limit 1
    ) f on true
    where coalesce(t.travel_type, 'all') in ('all', b.effective_travel_type)

    union all

    select
      t.template_key, t.title, t.priority, t.scope_type, t.trigger_key,
      coalesce(t.trigger_version, 'v2'), t.deadline_anchor, t.deadline_offset_days,
      coalesce(t.late_booking_grace_hours, 24),
      v.id, concat_ws(' · ', v.reference, trim(concat_ws(' ', v.given_names, v.surname))),
      v.booking_id, v.booking_participant_id,
      coalesce(v.selected_trip_id, v.document_trip_id, b.trip_id), v.id,
      v.created_at,
      v.status::text in ('approved', 'completed')
    from active_templates t
    join public.visa_applications v on t.scope_type = 'visa' and t.trigger_key = 'visa_application_created'
    left join public.bookings b on b.id = v.booking_id
    left join public.trips tr on tr.id = coalesce(v.selected_trip_id, v.document_trip_id, b.trip_id)
    where v.status::text not in ('approved', 'completed')
      and tr.id is not null
      and tr.archived_at is null
      and tr.start_date is not null
      and lower(coalesce(tr.title, '') || ' ' || coalesce(tr.destination, '')) ~ '(japon|japan)'

    union all

    select
      t.template_key, t.title, t.priority, t.scope_type, t.trigger_key,
      coalesce(t.trigger_version, 'v2'), t.deadline_anchor, t.deadline_offset_days,
      coalesce(t.late_booking_grace_hours, 24),
      tr.id, tr.title,
      null::uuid, null::uuid, tr.id, null::uuid,
      tr.updated_at,
      case
        when t.auto_completion_key = 'rooming_complete' then
          exists (
            select 1 from public.booking_participants bp
            join public.bookings b on b.id = bp.booking_id
            where bp.trip_id = tr.id and b.status::text in ('confirmed', 'paid')
          )
          and not exists (
            select 1
            from public.booking_participants bp
            join public.bookings b on b.id = bp.booking_id
            where bp.trip_id = tr.id
              and b.status::text in ('confirmed', 'paid')
              and not exists (
                select 1
                from public.room_assignments ra
                join public.trip_rooms room on room.id = ra.room_id
                join public.trip_hotels hotel on hotel.id = room.trip_hotel_id
                where ra.participant_id = bp.id and hotel.trip_id = tr.id
              )
          )
        else false
      end
    from active_templates t
    join public.trips tr on t.scope_type = 'trip' and t.trigger_key = 'trip_operational'
    where coalesce(t.travel_type, 'all') in ('all', 'organized')
      and tr.archived_at is null
      and tr.status::text in ('open', 'closed')
      and tr.start_date >= p_as_of::date
  ),
  prepared as (
    select
      c.*,
      public.operation_task_deduplication_key_v2(
        c.template_key, c.scope_type, c.entity_id, c.trigger_key, c.trigger_version
      ) as deduplication_key,
      public.calculate_operation_task_deadline_v2(
        c.deadline_anchor,
        c.deadline_offset_days,
        c.late_booking_grace_hours,
        coalesce(tr.start_date, b.travel_start_date),
        c.event_at,
        p_as_of
      ) as calculated_deadline
    from candidates c
    left join public.bookings b on b.id = c.booking_id
    left join public.trips tr on tr.id = c.trip_id
  ),
  evaluated as (
    select
      p.*,
      public.operation_task_existing_id_v2(
        p.template_key,
        p.deduplication_key,
        p.booking_id,
        p.trip_id,
        p.visa_application_id,
        p.participant_id
      ) is not null as existing_task
    from prepared p
  )
  select
    e.template_key,
    e.title,
    e.scope_type,
    e.entity_id,
    e.entity_label,
    e.trigger_key,
    e.calculated_deadline,
    e.priority,
    e.existing_task,
    e.completion_satisfied,
    not e.existing_task and not e.completion_satisfied as would_create,
    e.deduplication_key
  from evaluated e
  order by e.calculated_deadline nulls last, e.priority desc, e.template_key, e.entity_label;
end;
$$;

comment on column public.operation_task_templates.auto_completion_condition is
  'Legacy display-only field. V2 automation uses the allowlisted auto_completion_key column.';

comment on function public.operation_task_template_v2(text) is
  'Strict V2 lookup: returns only active, non-archived, auto-trigger-enabled, structurally complete templates. No fallback.';

comment on function public.dry_run_operation_tasks_v2(timestamptz) is
  'Read-only V2 candidate projection. It never inserts, updates, completes, cancels, or deletes a task.';

revoke all on function public.operation_task_template_v2(text) from public, anon;
revoke all on function public.calculate_operation_task_deadline_v2(text, integer, integer, date, timestamptz, timestamptz) from public, anon;
revoke all on function public.operation_task_deduplication_key_v2(text, text, uuid, text, text) from public, anon;
revoke all on function public.operation_task_existing_id_v2(text, text, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.ensure_operation_task_v2(text, uuid, text, timestamptz, uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.operation_task_auto_completion_satisfied_v2(uuid) from public, anon;
revoke all on function public.complete_operation_task_if_satisfied_v2(uuid) from public, anon;
revoke all on function public.cancel_operation_tasks_for_lifecycle_v2(text, uuid, uuid, text) from public, anon;
revoke all on function public.dry_run_operation_tasks_v2(timestamptz) from public, anon;

grant execute on function public.operation_task_template_v2(text) to authenticated, service_role;
grant execute on function public.calculate_operation_task_deadline_v2(text, integer, integer, date, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.operation_task_deduplication_key_v2(text, text, uuid, text, text) to authenticated, service_role;
grant execute on function public.operation_task_existing_id_v2(text, text, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.ensure_operation_task_v2(text, uuid, text, timestamptz, uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.operation_task_auto_completion_satisfied_v2(uuid) to service_role;
grant execute on function public.complete_operation_task_if_satisfied_v2(uuid) to authenticated, service_role;
grant execute on function public.cancel_operation_tasks_for_lifecycle_v2(text, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.dry_run_operation_tasks_v2(timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
