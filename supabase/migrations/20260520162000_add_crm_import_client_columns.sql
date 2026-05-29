-- Align public.clients with the CRM import/export mapping.
-- All columns are nullable so existing clients and partial imports remain safe.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS passport_expiring_soon boolean,
  ADD COLUMN IF NOT EXISTS passport_renewal_needed boolean,
  ADD COLUMN IF NOT EXISTS last_trip_departure_date date,
  ADD COLUMN IF NOT EXISTS client_status text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric,
  ADD COLUMN IF NOT EXISTS balance_due numeric,
  ADD COLUMN IF NOT EXISTS registered_at date;

CREATE INDEX IF NOT EXISTS idx_clients_registered_at ON public.clients (registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_clients_last_trip_departure_date ON public.clients (last_trip_departure_date DESC);
CREATE INDEX IF NOT EXISTS idx_clients_client_status ON public.clients (client_status);
