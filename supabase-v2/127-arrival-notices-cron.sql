-- 127: The arrival-notices sweep, every half hour (126).
--
-- Calls supabase-v2/functions/arrival-notices with the scheduler's secret, the
-- way the live-rates run is called (101). It sends only for import consoles
-- somebody has switched on (consoles.arrival_auto), so on a day with none it
-- asks Microsoft for a token and does nothing else.

select cron.unschedule(jobid) from cron.job where jobname = 'araxys-v2-arrival-notices';

select cron.schedule(
  'araxys-v2-arrival-notices',
  '5,35 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/arrival-notices',
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'Authorization',       'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sync_anon_key'),
      'x-scheduler-secret',  (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sync_secret')
    ),
    body    := jsonb_build_object('mode', 'sweep'),
    timeout_milliseconds := 150000
  );
  $cron$
);
