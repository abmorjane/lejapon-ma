do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'process-marketing-queue-every-minute';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'process-marketing-queue-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/process-marketing-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_cron_secret')
    ),
    body := '{"trigger":"cron"}'::jsonb
  );
  $$
);
