-- ---------------------------------------------------------------------------
-- Stop the voice desk's scheduled jobs.
--
-- WHAT WENT WRONG
--
-- The voice features were taken out of the interface and the call-derived
-- records were deleted, but two cron jobs were left running. One polls
-- SnapServe every two minutes and creates a customer and an enquiry for every
-- call it finds; the other republishes the agents' knowledge pack every five.
--
-- So the deletion did not hold. Within two minutes the ingest re-imported the
-- same calls and rebuilt the same customer and enquiry, and it would have kept
-- doing so forever. Removing a feature's screens is not removing the feature
-- while something on a timer is still writing its data.
--
-- WHY UNSCHEDULE RATHER THAN DROP
--
-- The edge functions stay deployed and the jobs can be put back with one
-- statement each, because the voice desk was removed "for now". What stops is
-- the writing. A function nobody invokes changes nothing.
-- ---------------------------------------------------------------------------

do $stop$
declare
  j record;
begin
  for j in
    select jobname from cron.job
     where jobname in ('araxys-v2-ingest-calls', 'araxys-v2-kb-sync')
  loop
    perform cron.unschedule(j.jobname);
    raise notice 'unscheduled %', j.jobname;
  end loop;
end $stop$;

-- What is left running, so the result of this migration is legible.
select jobid, jobname, schedule, active from cron.job order by jobid;
