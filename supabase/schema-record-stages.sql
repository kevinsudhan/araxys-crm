-- Araxys — a real record now has three stages, not two
--
-- Records captured from calls went straight to 'processing' and appeared on the in-process
-- shipments page, alongside shipments that are actually booked and sailing. That was wrong
-- in both directions: a two-minute enquiry where somebody asked a rate is not an in-process
-- shipment, and the inbound requests page — the one place a desk looks for new business —
-- showed only seeded demo rows and never the real callers.
--
--   enquiry     someone rang, we captured what they said. Lives on Inbound requests.
--   processing  the desk confirmed a sailing date and started the booking. In-process.
--   processed   delivered. Completed.
--
-- The move from enquiry to processing is deliberately a human action rather than something
-- inferred from the transcript. An agent hearing "yes, book it" is not the same as the desk
-- having space, a rate and a date it will stand behind.

alter table public.real_records
  drop constraint if exists real_records_stage_check;

alter table public.real_records
  add constraint real_records_stage_check
  check (stage in ('enquiry', 'processing', 'processed'));

alter table public.real_records
  alter column stage set default 'enquiry';

-- Every existing record predates the distinction and is, in fact, an enquiry: none has a
-- confirmed sailing date, and none was moved to in-process by a person deciding it should
-- be. Records that have a sailing date on file keep 'processing', since something did
-- commit them.
update public.real_records
   set stage = 'enquiry'
 where stage = 'processing'
   and coalesce(sailing_date, '') = '';

-- When the desk started the booking, so the in-process list can be ordered by it and a
-- record can show how long it has been sitting.
alter table public.real_records
  add column if not exists processing_started_at timestamptz;
