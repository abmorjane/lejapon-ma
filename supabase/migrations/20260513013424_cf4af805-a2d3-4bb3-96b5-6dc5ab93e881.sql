-- Add 'sending' to recipient_status enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'recipient_status' AND e.enumlabel = 'sending'
  ) THEN
    ALTER TYPE recipient_status ADD VALUE 'sending' BEFORE 'sent';
  END IF;
END $$;

-- Indexes for queue dispatcher
CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign_status
  ON public.email_campaign_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_status_sched
  ON public.email_campaigns (status, scheduled_at);
