-- Server-side audit log for sensitive CRM exports.

CREATE TABLE IF NOT EXISTS public.crm_export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  ip_address text,
  exported_count integer NOT NULL DEFAULT 0,
  export_type text NOT NULL CHECK (export_type IN ('CSV', 'XLSX')),
  scope text,
  include_passport_data boolean NOT NULL DEFAULT false,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'denied', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_export_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin read crm export logs" ON public.crm_export_logs;
CREATE POLICY "super_admin read crm export logs"
ON public.crm_export_logs
FOR SELECT
USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "super_admin insert crm export logs" ON public.crm_export_logs;
CREATE POLICY "super_admin insert crm export logs"
ON public.crm_export_logs
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_crm_export_logs_user_id ON public.crm_export_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_export_logs_created_at ON public.crm_export_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_export_logs_status ON public.crm_export_logs(status);
