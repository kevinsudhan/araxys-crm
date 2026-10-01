-- 117: The Sunday rate requests go at 8:30 pm IST, not 10:30 pm.
--
-- ---------------------------------------------------------------------------
-- The user's instruction (1 Oct 2026). 8:30 pm IST is 15:00 GMT, pg_cron's
-- clock here; the job still re-runs every ten minutes to 9:20 pm for anything
-- not yet sent, and a partner is still claimed once per Sunday (101), so the
-- move cannot mail anyone twice.
--
-- Only the schedule changes. alter_job keeps the job's command exactly as 101
-- wrote it (the function's address, and the scheduler's credentials read from
-- Vault when it runs), rather than restating it here.
-- ---------------------------------------------------------------------------

select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'araxys-v2-live-rates'),
  schedule := '0,10,20,30,40,50 15 * * 0'
);
