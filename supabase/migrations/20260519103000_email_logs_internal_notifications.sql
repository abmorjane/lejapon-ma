CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  subject text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read contact_messages" ON public.contact_messages;
CREATE POLICY "staff read contact_messages"
ON public.contact_messages FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  recipient text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  related_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  related_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  related_contact_id uuid REFERENCES public.contact_messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON public.email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_event_type ON public.email_logs(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON public.email_logs(status, created_at DESC);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read email_logs" ON public.email_logs;
CREATE POLICY "staff read email_logs"
ON public.email_logs FOR SELECT
USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "service manage email_logs" ON public.email_logs;
CREATE POLICY "service manage email_logs"
ON public.email_logs FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.email_logs (
  event_type,
  recipient,
  subject,
  status,
  error_message,
  metadata,
  created_at,
  sent_at
)
SELECT
  event_type,
  recipient,
  null,
  status,
  error_message,
  metadata,
  created_at,
  CASE WHEN status = 'sent' THEN created_at ELSE null END
FROM public.admin_email_logs
WHERE NOT EXISTS (
  SELECT 1
  FROM public.email_logs
  WHERE email_logs.event_type = admin_email_logs.event_type
    AND email_logs.recipient = admin_email_logs.recipient
    AND email_logs.created_at = admin_email_logs.created_at
);
