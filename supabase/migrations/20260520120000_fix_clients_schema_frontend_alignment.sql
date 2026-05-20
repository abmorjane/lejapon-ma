-- Fix public.clients so it matches the current admin CRM frontend exactly.
--
-- Frontend sources audited:
-- - src/admin/pages/Clients.tsx
-- - src/admin/components/ClientsImportDialog.tsx
-- - src/pages/Booking.tsx
-- - src/admin/components/CreateBookingDialog.tsx
-- - src/admin/components/LinkExistingClientDialog.tsx
--
-- Fields inserted by Admin > Clients > Ajouter client:
-- full_name, email, phone, city, country, source,
-- passport_number, passport_expiry, passport_issue_date, birthdate,
-- nationality, sex, passport_file_path
--
-- Fields selected/updated by the CRM client list/detail:
-- id, full_name, email, phone, city, country, source,
-- passport_number, passport_expiry, passport_issue_date, birthdate,
-- nationality, sex, passport_file_path, last_trip_label,
-- loyalty_tier, is_returning, trips_completed, rewards_used, created_at

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  city text,
  country text DEFAULT 'Maroc',
  source text,
  passport_number text,
  passport_expiry date,
  passport_issue_date date,
  birthdate date,
  nationality text,
  sex text,
  passport_file_path text,
  last_trip_label text,
  loyalty_tier text NOT NULL DEFAULT 'none',
  is_returning boolean NOT NULL DEFAULT false,
  trips_completed integer NOT NULL DEFAULT 0,
  rewards_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'Maroc',
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS passport_number text,
  ADD COLUMN IF NOT EXISTS passport_expiry date,
  ADD COLUMN IF NOT EXISTS passport_issue_date date,
  ADD COLUMN IF NOT EXISTS birthdate date,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS passport_file_path text,
  ADD COLUMN IF NOT EXISTS last_trip_label text,
  ADD COLUMN IF NOT EXISTS loyalty_tier text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS is_returning boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trips_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rewards_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.clients
SET
  country = COALESCE(country, 'Maroc'),
  loyalty_tier = COALESCE(loyalty_tier, 'none'),
  is_returning = COALESCE(is_returning, false),
  trips_completed = COALESCE(trips_completed, 0),
  rewards_used = COALESCE(rewards_used, 0),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, now());

CREATE INDEX IF NOT EXISTS idx_clients_email_lower ON public.clients (lower(email));
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_passport_number ON public.clients (passport_number);
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON public.clients (created_at DESC);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

