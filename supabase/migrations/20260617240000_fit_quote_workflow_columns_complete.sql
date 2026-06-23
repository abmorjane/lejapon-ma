-- Rattrapage complet des colonnes workflow Devis FIT.
-- Corrige les environnements où PostgREST ne voit pas encore les colonnes récentes.

alter table public.fit_quotes
  add column if not exists admin_approved_for_payment_at timestamptz,
  add column if not exists admin_approved_for_payment_by uuid references auth.users(id) on delete set null,
  add column if not exists payment_authorized_at timestamptz,
  add column if not exists payment_authorized_by uuid references auth.users(id) on delete set null,
  add column if not exists client_preapproved_at timestamptz,
  add column if not exists client_preapproved_by text,
  add column if not exists production_status text not null default 'draft',
  add column if not exists japan_request_status text not null default 'not_started',
  add column if not exists payment_status text not null default 'not_authorized',
  add column if not exists booking_status text not null default 'not_started',
  add column if not exists reservation_status text not null default 'not_started',
  add column if not exists japan_request_sent_at timestamptz,
  add column if not exists japan_request_reference text,
  add column if not exists japan_request_deadline date,
  add column if not exists japan_response_notes text,
  add column if not exists japan_confirmed_price numeric,
  add column if not exists japan_conditions text,
  add column if not exists japan_valid_until date,
  add column if not exists cancellation_conditions text,
  add column if not exists booking_conditions text,
  add column if not exists payment_conditions text,
  add column if not exists non_included_text text,
  add column if not exists production_public_note text,
  add column if not exists partner_payment_requested_at timestamptz,
  add column if not exists partner_payment_received_at timestamptz,
  add column if not exists booking_in_progress_at timestamptz,
  add column if not exists production_confirmed_at timestamptz;

alter table public.fit_quotes
  drop constraint if exists fit_quotes_production_status_check,
  add constraint fit_quotes_production_status_check check (production_status in (
    'draft',
    'sent_to_client',
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
    'cancelled',
    'expired',
    'rejected'
  ));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_payment_status_check,
  add constraint fit_quotes_payment_status_check check (payment_status in (
    'not_authorized',
    'authorized',
    'requested',
    'payment_pending',
    'deposit_received',
    'paid',
    'refunded',
    'cancelled'
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
  drop constraint if exists fit_quotes_booking_status_check,
  add constraint fit_quotes_booking_status_check check (booking_status in (
    'not_started',
    'booking_in_progress',
    'partially_confirmed',
    'confirmed',
    'cancelled'
  ));

alter table public.fit_quotes
  drop constraint if exists fit_quotes_reservation_status_check,
  add constraint fit_quotes_reservation_status_check check (reservation_status in (
    'not_started',
    'in_progress',
    'booking_in_progress',
    'partially_confirmed',
    'confirmed',
    'cancelled'
  ));

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
      client_preapproved_at = now(),
      client_preapproved_by = 'client_link',
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

grant execute on function public.fit_quote_client_preapprove(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
