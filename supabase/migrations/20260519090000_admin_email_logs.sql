CREATE TABLE IF NOT EXISTS public.admin_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_email_logs_created_at
  ON public.admin_email_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_email_logs_event_type
  ON public.admin_email_logs(event_type, created_at DESC);

ALTER TABLE public.admin_email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read admin_email_logs" ON public.admin_email_logs;
CREATE POLICY "staff read admin_email_logs"
ON public.admin_email_logs FOR SELECT
USING (public.is_staff(auth.uid()));
