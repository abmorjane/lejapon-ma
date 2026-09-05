-- Operation task templates admin layer.
-- Makes standard operation task templates editable without changing historical
-- operation_tasks rows or manual checklist/task behavior.

create table if not exists public.operation_task_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  title text not null,
  description text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  category text not null,
  deadline_interval interval,
  display_order integer not null default 100,
  is_active boolean not null default true,
  allow_auto_trigger boolean not null default true,
  auto_completion_condition text,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_operation_task_templates_active_order
  on public.operation_task_templates (is_active, display_order, template_key);

insert into public.operation_task_templates (
  template_key,
  title,
  description,
  priority,
  category,
  deadline_interval,
  display_order,
  allow_auto_trigger,
  auto_completion_condition,
  metadata
)
values
  ('reserve_flight', 'Réserver le billet d’avion', 'Réserver le vol client après confirmation du paiement.', 'high', 'flight_reservation', interval '24 hours', 10, true, 'flight_status_booked_or_ticket_sent', '{"source":"migration_defaults"}'::jsonb),
  ('send_flight_ticket', 'Envoyer le billet au client', 'Envoyer le billet PDF au client et confirmer l’envoi.', 'high', 'flight_ticket_delivery', interval '24 hours', 20, true, 'flight_ticket_sent_to_customer', '{"source":"migration_defaults"}'::jsonb),
  ('verify_passport', 'Vérifier la validité du passeport', 'Contrôler la validité du passeport et les informations voyageur.', 'high', 'passport_verification', interval '24 hours', 30, true, 'passport_verified', '{"source":"migration_defaults"}'::jsonb),
  ('visa_approved_next_action', 'Finaliser le dossier visa approuvé', 'Préparer la suite après approbation du visa.', 'medium', 'visa_followup', interval '24 hours', 40, true, 'visa_followup_completed', '{"source":"migration_defaults"}'::jsonb),
  ('prepare_final_documents', 'Préparer les documents finaux du voyage', 'Préparer et publier les documents finaux du voyage.', 'high', 'final_documents', interval '48 hours', 50, true, 'final_documents_published', '{"source":"migration_defaults"}'::jsonb),
  ('send_jr_pass', 'Envoyer / remettre le JR Pass', 'Envoyer ou remettre le JR Pass au voyageur.', 'medium', 'jr_pass', interval '24 hours', 60, true, 'jr_pass_sent', '{"source":"migration_defaults"}'::jsonb)
on conflict (template_key) do update
set
  title = coalesce(public.operation_task_templates.title, excluded.title),
  description = coalesce(public.operation_task_templates.description, excluded.description),
  priority = coalesce(public.operation_task_templates.priority, excluded.priority),
  category = coalesce(public.operation_task_templates.category, excluded.category),
  deadline_interval = coalesce(public.operation_task_templates.deadline_interval, excluded.deadline_interval),
  display_order = coalesce(public.operation_task_templates.display_order, excluded.display_order),
  allow_auto_trigger = coalesce(public.operation_task_templates.allow_auto_trigger, excluded.allow_auto_trigger),
  auto_completion_condition = coalesce(public.operation_task_templates.auto_completion_condition, excluded.auto_completion_condition),
  metadata = coalesce(public.operation_task_templates.metadata, '{}'::jsonb) || jsonb_build_object('migration_seen_at', now()),
  updated_at = now();

drop trigger if exists operation_task_templates_updated_at on public.operation_task_templates;
create trigger operation_task_templates_updated_at
before update on public.operation_task_templates
for each row execute function public.set_updated_at();

create or replace function public.operation_task_template_defaults(p_template_key text)
returns table(title text, description text, priority text, category text, deadline_interval interval)
language plpgsql
stable
set search_path = public
as $$
begin
  return query
  select
    t.title,
    coalesce(t.description, '') as description,
    t.priority,
    t.category,
    t.deadline_interval
  from public.operation_task_templates t
  where t.template_key = p_template_key
    and t.is_active = true
    and t.archived_at is null
    and t.allow_auto_trigger = true
  limit 1;

  if found then
    return;
  end if;

  return query
  select fallback.title, fallback.description, fallback.priority, fallback.category, fallback.deadline_interval
  from (values
    ('reserve_flight', 'Réserver le billet d’avion', 'Réserver le vol client après confirmation du paiement.', 'high', 'flight_reservation', interval '24 hours'),
    ('send_flight_ticket', 'Envoyer le billet au client', 'Envoyer le billet PDF au client et confirmer l’envoi.', 'high', 'flight_ticket_delivery', interval '24 hours'),
    ('verify_passport', 'Vérifier la validité du passeport', 'Contrôler la validité du passeport et les informations voyageur.', 'high', 'passport_verification', interval '24 hours'),
    ('visa_approved_next_action', 'Finaliser le dossier visa approuvé', 'Préparer la suite après approbation du visa.', 'medium', 'visa_followup', interval '24 hours'),
    ('prepare_final_documents', 'Préparer les documents finaux du voyage', 'Préparer et publier les documents finaux du voyage.', 'high', 'final_documents', interval '48 hours'),
    ('send_jr_pass', 'Envoyer / remettre le JR Pass', 'Envoyer ou remettre le JR Pass au voyageur.', 'medium', 'jr_pass', interval '24 hours')
  ) as fallback(template_key, title, description, priority, category, deadline_interval)
  where fallback.template_key = p_template_key;
end;
$$;

alter table public.operation_task_templates enable row level security;

drop policy if exists "staff read operation task templates" on public.operation_task_templates;
create policy "staff read operation task templates"
on public.operation_task_templates
for select
using (public.v2_is_staff(auth.uid()));

drop policy if exists "admin manage operation task templates" on public.operation_task_templates;
create policy "admin manage operation task templates"
on public.operation_task_templates
for all
using (public.v2_is_admin(auth.uid()))
with check (public.v2_is_admin(auth.uid()));

grant select on public.operation_task_templates to authenticated;
grant insert, update, delete on public.operation_task_templates to authenticated;
grant execute on function public.operation_task_template_defaults(text) to authenticated;

notify pgrst, 'reload schema';
