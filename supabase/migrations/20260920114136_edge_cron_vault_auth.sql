do $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'project_url' limit 1;
  if v_id is null then
    perform vault.create_secret(
      'https://nkovgpzspprmmhorwaxl.supabase.co',
      'project_url',
      'LeJapon production Supabase project URL for scheduled Edge Function calls'
    );
  else
    perform vault.update_secret(
      v_id,
      'https://nkovgpzspprmmhorwaxl.supabase.co',
      'project_url',
      'LeJapon production Supabase project URL for scheduled Edge Function calls'
    );
  end if;

  select id into v_id from vault.secrets where name = 'edge_cron_secret' limit 1;
  if v_id is null then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'edge_cron_secret',
      'Private shared secret used only by pg_cron to authenticate internal Edge Function calls'
    );
  end if;
end $$;

create or replace function public.verify_edge_cron_secret(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_token is not null
    and length(p_token) >= 32
    and exists (
      select 1
      from vault.decrypted_secrets
      where name = 'edge_cron_secret'
        and decrypted_secret = p_token
    );
$$;

revoke all on function public.verify_edge_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_edge_cron_secret(text) to service_role;
