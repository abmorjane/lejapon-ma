-- FIT partner production workflow.
-- Adds the commercial preapproval -> LeJapon.ma production review -> Japan availability
-- -> payment authorization lifecycle without exposing internal costs to partners/clients.

alter table public.fit_quotes
  add column if not exists production_status text not null default 'draft',
  add column if not exists japan_request_status text not null default 'not_started',
  add column if not exists payment_status text not null default 'not_authorized',
  add column if not exists booking_status text not null default 'not_started',
  add column if not exists cancellation_conditions text,
  add column if not exists production_public_note text,
  add column if not exists japan_request_sent_at timestamptz,
  add column if not exists japan_request_reference text,
  add column if not exists japan_request_deadline date,
  add column if not exists japan_response_notes text,
  add column if not exists japan_confirmed_price numeric,
  add column if not exists japan_conditions text,
  add column if not exists japan_valid_until date,
  add column if not exists admin_approved_for_payment_at timestamptz,
  add column if not exists payment_authorized_at timestamptz,
  add column if not exists partner_payment_requested_at timestamptz,
  add column if not exists partner_payment_received_at timestamptz,
  add column if not exists booking_in_progress_at timestamptz,
  add column if not exists production_confirmed_at timestamptz;

alter table public.fit_quotes
  drop constraint if exists fit_quotes_status_check,
  add constraint fit_quotes_status_check check (status in (
    'draft',
    'sent',
    'sent_to_client',
    'accepted',
    'client_modification_requested',
    'client_preapproved',
    'pending_partner_review',
    'pending_lejapon_approval',
    'pending_lejapon_review',
    'pending_japan_availability',
    'japan_request_sent',
    'japan_quote_received',
    'admin_approved_for_payment',
    'payment_authorized',
    'partner_payment_pending',
    'partner_payment_received',
    'booking_in_progress',
    'partially_confirmed',
    'confirmed',
    'modification_requested',
    'expired',
    'cancelled',
    'rejected',
    'converted_to_booking'
  ));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_production_status_check,
  add constraint fit_quotes_production_status_check check (production_status in (
    'draft',
    'sent_to_client',
    'client_modification_requested',
    'client_preapproved',
    'pending_lejapon_review',
    'pending_japan_availability',
    'japan_request_sent',
    'japan_quote_received',
    'admin_approved_for_payment',
    'payment_authorized',
    'partner_payment_pending',
    'partner_payment_received',
    'booking_in_progress',
    'partially_confirmed',
    'confirmed',
    'cancelled',
    'expired',
    'rejected'
  ));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_japan_request_status_check,
  add constraint fit_quotes_japan_request_status_check check (japan_request_status in (
    'not_started',
    'pending',
    'sent',
    'response_received',
    'approved',
    'rejected',
    'cancelled'
  ));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_payment_status_check,
  add constraint fit_quotes_payment_status_check check (payment_status in (
    'not_authorized',
    'authorized',
    'requested',
    'deposit_received',
    'paid',
    'cancelled'
  ));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_booking_status_check,
  add constraint fit_quotes_booking_status_check check (booking_status in (
    'not_started',
    'booking_in_progress',
    'partially_confirmed',
    'confirmed',
    'cancelled'
  ));

update public.fit_quotes
set cancellation_conditions = coalesce(cancellation_conditions, $conditions$
Cette proposition est établie sous réserve de disponibilité au moment de la confirmation. Aucune réservation ferme n’est effectuée avant validation finale, réception de l’acompte demandé et confirmation des prestataires.

1. Hôtels
À partir de 90 jours avant le départ, les hôtels peuvent appliquer des frais d’annulation partiels ou totaux selon les conditions de chaque établissement. Certains hôtels, périodes de haute saison, chambres familiales ou groupes peuvent être non remboursables dès confirmation.

2. Vols
Les billets d’avion sont soumis aux conditions de la compagnie aérienne. Une fois émis, les billets peuvent être non remboursables, non modifiables ou modifiables avec frais selon la classe tarifaire.

3. Trains, visites, musées et activités
Les billets de train, musées, parcs, visites guidées, expériences, activités spéciales et entrées déjà émis peuvent être non remboursables et non modifiables.

4. Guides, transferts et transports privés
Les guides, transferts et transports privés peuvent entraîner des frais d’annulation après confirmation, selon les délais imposés par les prestataires locaux.

5. Frais de service
Les frais de traitement, de préparation, de conseil, de coordination et de réservation peuvent rester dus après validation du dossier.

6. Modification du programme
Toute modification après validation peut entraîner une révision du prix, des frais supplémentaires ou une indisponibilité de certaines prestations.

7. Délais
Plus la date de départ est proche, plus les conditions d’annulation peuvent être strictes. À moins de 90 jours du départ, certaines prestations peuvent devenir partiellement ou totalement non remboursables.

8. Acceptation
Le paiement de l’acompte ou la validation écrite du devis implique l’acceptation des conditions de réservation, de modification et d’annulation.
$conditions$);

create or replace function public.fit_quote_client_preapprove(_share_token text, _client_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_row public.fit_quotes%rowtype;
  next_status text;
  next_production text;
begin
  select * into quote_row
  from public.fit_quotes
  where share_token = _share_token
    and share_enabled = true
  limit 1;

  if not found then
    raise exception 'quote not found';
  end if;

  if quote_row.quote_channel = 'partner' then
    next_status := 'client_preapproved';
    next_production := 'pending_lejapon_review';
  else
    next_status := 'accepted';
    next_production := coalesce(quote_row.production_status, 'client_preapproved');
  end if;

  update public.fit_quotes
  set status = next_status,
      production_status = next_production,
      japan_request_status = case when quote_row.quote_channel = 'partner' then 'pending' else japan_request_status end,
      client_notes = _client_notes,
      accepted_at = now(),
      updated_at = now()
  where id = quote_row.id;

  insert into public.quote_audit_logs (quote_id, organization_id, user_id, action_type, payload)
  values (
    quote_row.id,
    quote_row.partner_organization_id,
    null,
    case when quote_row.quote_channel = 'partner' then 'client_preapproved' else 'client_accepted' end,
    jsonb_build_object('client_notes', _client_notes, 'source', 'public_quote')
  );

  return jsonb_build_object('ok', true, 'status', next_status, 'production_status', next_production);
end;
$$;

create or replace function public.fit_quote_client_request_modification(_share_token text, _client_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_row public.fit_quotes%rowtype;
  next_status text;
begin
  select * into quote_row
  from public.fit_quotes
  where share_token = _share_token
    and share_enabled = true
  limit 1;

  if not found then
    raise exception 'quote not found';
  end if;

  next_status := case when quote_row.quote_channel = 'partner' then 'client_modification_requested' else 'sent' end;

  update public.fit_quotes
  set status = next_status,
      production_status = case when quote_row.quote_channel = 'partner' then 'client_modification_requested' else production_status end,
      client_notes = _client_notes,
      requested_changes_at = now(),
      updated_at = now()
  where id = quote_row.id;

  insert into public.quote_audit_logs (quote_id, organization_id, user_id, action_type, payload)
  values (
    quote_row.id,
    quote_row.partner_organization_id,
    null,
    'client_modification_requested',
    jsonb_build_object('client_notes', _client_notes, 'source', 'public_quote')
  );

  return jsonb_build_object('ok', true, 'status', next_status);
end;
$$;

grant execute on function public.fit_quote_client_preapprove(text, text) to anon, authenticated;
grant execute on function public.fit_quote_client_request_modification(text, text) to anon, authenticated;

grant select (
  quote_channel,
  partner_organization_id,
  partner_branding_mode,
  partner_contact_name,
  production_status,
  payment_status,
  booking_status,
  cancellation_conditions,
  production_public_note
) on public.fit_quotes to anon;

notify pgrst, 'reload schema';
