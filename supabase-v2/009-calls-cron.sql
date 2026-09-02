-- Poll SnapServe for v2's calls.
--
-- Two minutes rather than five: a caller who hangs up and rings straight back
-- should not find the desk unaware of the conversation they just had. The
-- ingest triggers a knowledge refresh itself when it finds anything, so this
-- is the only schedule the call path needs.
select cron.unschedule('araxys-v2-ingest-calls')
  where exists (select 1 from cron.job where jobname = 'araxys-v2-ingest-calls');

select cron.schedule(
  'araxys-v2-ingest-calls',
  '*/2 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/ingest-calls',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('trigger', 'cron')
  );
  $cron$
);
