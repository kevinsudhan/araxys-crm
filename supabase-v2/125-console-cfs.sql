-- 125: The console at the CFS — the box, the stuffing, the report.
--
-- ---------------------------------------------------------------------------
-- What the CFS measures against what was declared is the warehouse receipts
-- on each job (068); applying it moves the job's own figures. What is new is
-- on the console:
--
--   box_type             20GP / 40GP / 40HC: the box the load plan is drawn
--                        for, when the console was not opened against a
--                        sailing that says.
--   stuffed_on           The day the box was stuffed at the CFS.
--   stuffing_report_sent_at / _to
--                        When the stuffing report (each box, its seal, each
--                        house in it, declared against received) went out,
--                        and to whom.
-- ---------------------------------------------------------------------------

alter table public.consoles add column if not exists box_type text;
alter table public.consoles drop constraint if exists consoles_box_type_check;
alter table public.consoles add constraint consoles_box_type_check check (box_type is null or box_type in ('20GP', '40GP', '40HC'));
alter table public.consoles add column if not exists stuffed_on date;
alter table public.consoles add column if not exists stuffing_report_sent_at timestamptz;
alter table public.consoles add column if not exists stuffing_report_sent_to text not null default '';

notify pgrst, 'reload schema';
