
-- Add registered trip info to clients (latest trip the client signed up for)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS last_trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_trip_label text;

-- Booking documents history (quotes & receipts)
CREATE TABLE IF NOT EXISTS public.booking_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quote','receipt')),
  number text NOT NULL,
  storage_path text NOT NULL,
  total_mad numeric,
  paid_mad numeric,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_documents_booking ON public.booking_documents(booking_id);

ALTER TABLE public.booking_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read booking_documents" ON public.booking_documents;
CREATE POLICY "staff read booking_documents" ON public.booking_documents
  FOR SELECT USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff insert booking_documents" ON public.booking_documents;
CREATE POLICY "staff insert booking_documents" ON public.booking_documents
  FOR INSERT WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin delete booking_documents" ON public.booking_documents;
CREATE POLICY "admin delete booking_documents" ON public.booking_documents
  FOR DELETE USING (public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]));

-- Private storage bucket for booking documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('booking-docs', 'booking-docs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for booking-docs (staff only)
DROP POLICY IF EXISTS "staff read booking-docs" ON storage.objects;
CREATE POLICY "staff read booking-docs" ON storage.objects
  FOR SELECT USING (bucket_id = 'booking-docs' AND public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff insert booking-docs" ON storage.objects;
CREATE POLICY "staff insert booking-docs" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'booking-docs' AND public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin delete booking-docs" ON storage.objects;
CREATE POLICY "admin delete booking-docs" ON storage.objects
  FOR DELETE USING (bucket_id = 'booking-docs' AND public.has_any_role(auth.uid(), ARRAY['super_admin','admin']::app_role[]));

-- Allow public booking form to upsert client with trip info
DROP POLICY IF EXISTS "public upsert client from booking" ON public.clients;
CREATE POLICY "public upsert client from booking" ON public.clients
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "public update client from booking" ON public.clients;
CREATE POLICY "public update client from booking" ON public.clients
  FOR UPDATE USING (true) WITH CHECK (true);
