-- ---------------------------------------------------------------------------
-- Drop what the voice desk left behind.
--
-- 023 unscheduled the cron jobs and the pages went with them, but the tables
-- stayed — empty, unread, and still showing up in every schema listing and
-- every RLS review as though they were part of the product.
--
-- WHY THIS IS SAFE TO DROP RATHER THAN KEEP
--
-- `calls` and `suppressed_calls` hold nothing. They were checked immediately
-- before this migration was written: zero rows in both, no cron job referencing
-- them, and no column anywhere else pointing at them. Nothing is lost.
--
-- Had there been transcripts in them the answer would have been different —
-- they would be real customer conversations, and the right move would have been
-- to export them before dropping rather than to decide on somebody's behalf.
--
-- WHY THE MIGRATIONS THAT CREATED THEM STAY IN THE REPOSITORY
--
-- 007, 008, 009 and 011 are the record of what was done to this database and
-- when. Deleting the files would make the numbering lie about its own history
-- and leave 010 sitting next to 012 with nothing to explain the gap. They ran;
-- this undoes them; both facts belong in the sequence.
-- ---------------------------------------------------------------------------

-- Cron first: a job referencing a dropped table fails on every tick and fills
-- the log with something nobody will connect to this change. 023 unscheduled
-- these already; this is belt and braces for a database that took 023 before
-- the jobs were re-created by a re-run of an older script.
do $$
declare j record;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    for j in execute
      'select jobname from cron.job where jobname in (''ingest-calls'', ''kb-sync'')'
    loop
      execute format('select cron.unschedule(%L)', j.jobname);
    end loop;
  end if;
end $$;

drop table if exists public.suppressed_calls cascade;
drop table if exists public.calls cascade;

-- Helpers that existed only to serve the two tables above.
drop function if exists public.claim_call(text) cascade;
drop function if exists public.suppress_call(text, text) cascade;
drop function if exists public.link_call_to_enquiry(text, text) cascade;
