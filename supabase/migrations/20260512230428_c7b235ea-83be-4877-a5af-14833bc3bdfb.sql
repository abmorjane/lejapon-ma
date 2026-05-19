CREATE TABLE public.booking_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  user_id uuid,
  user_email text,
  field text NOT NULL,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_audit_booking ON public.booking_audit_log(booking_id, created_at DESC);

ALTER TABLE public.booking_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read booking_audit_log"
ON public.booking_audit_log FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE POLICY "staff insert booking_audit_log"
ON public.booking_audit_log FOR INSERT
WITH CHECK (public.is_staff(auth.uid()));