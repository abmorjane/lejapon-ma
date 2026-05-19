GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove any previous version of the job (idempotent)
DO $$
DECLARE _jobid bigint;
BEGIN
  SELECT jobid INTO _jobid FROM cron.job WHERE jobname = 'visa-document-reminders-daily';
  IF _jobid IS NOT NULL THEN
    PERFORM cron.unschedule(_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'visa-document-reminders-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url:='https://nxnncbddtpjusrnhilxk.supabase.co/functions/v1/send-visa-reminders',
    headers:='{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54bm5jYmRkdHBqdXNybmhpbHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4Njk5MjEsImV4cCI6MjA5MjQ0NTkyMX0.Y5MG6Gh-opGHemlK8OSAP0quoyV9NZ1XGuQJcjDX2mE"}'::jsonb,
    body:='{"trigger":"cron"}'::jsonb
  );
  $$
);