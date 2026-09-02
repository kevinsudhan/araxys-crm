-- Republish v2's knowledge packs on a schedule.
--
-- The agent's knowledge should never be older than the last thing that changed
-- it. A customer who accepts a quote at 14:02 and rings back at 14:06 should
-- find the desk already knows -- so this runs every five minutes rather than
-- nightly.
--
-- Five minutes is a floor, not the mechanism. The CRM also calls kb-sync
-- directly after an acceptance, so the common case is immediate and the cron is
-- what catches anything that failed or happened outside the app.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Anon key, not service_role. kb-sync runs with verify_jwt off and holds its own
-- privileged keys as function secrets; sending service_role over the wire here
-- would put a key that bypasses RLS into a cron job's arguments for no gain.
select cron.unschedule('araxys-v2-kb-sync')
  where exists (select 1 from cron.job where jobname = 'araxys-v2-kb-sync');

select cron.schedule(
  'araxys-v2-kb-sync',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url     := 'https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/kb-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('trigger', 'cron')
  );
  $cron$
);
