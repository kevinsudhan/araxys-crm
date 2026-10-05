-- 126: Deconsolidation at destination — arrival notices, the outturn, the release.
--
-- ---------------------------------------------------------------------------
-- On an import console, once the box is on its way and then out at the CFS,
-- every house's consignee has to hear that their cargo is arriving and what
-- they need to take delivery; what came out of the box, house by house, goes
-- back to the origin agent as the outturn report; and each house's delivery
-- order waits for its release (088, 120).
--
-- ARRIVAL NOTICES
--
--   shipments.arrival_notice_sent_at / _to / _via
--                         When each house's notice went, to whom, and whether
--                         the scheduler sent it ('auto') or the desk ('desk').
--   consoles.arrival_auto / arrival_from / arrival_days
--                         Whether the scheduler sends them for this console,
--                         from which desk mailbox, and how many days before
--                         the ETA. Off until somebody turns it on.
--   arrival_notice_sends  Every send the scheduler made or was refused, as
--                         live_rate_sends is for live rates (101).
--
-- The scheduler (supabase-v2/functions/arrival-notices, pg_cron every half
-- hour) claims a house by setting its sent_at before the mail goes, so no
-- consignee gets two; a refusal puts the claim back and is logged.
--
-- THE OUTTURN
--
-- What came out of the box for each house is its warehouse receipt (068),
-- recorded at destuffing. consoles.outturn_sent_at / _to: when the report
-- went to the origin agent.
-- ---------------------------------------------------------------------------

alter table public.shipments add column if not exists arrival_notice_sent_at timestamptz;
alter table public.shipments add column if not exists arrival_notice_sent_to text not null default '';
alter table public.shipments add column if not exists arrival_notice_via text;
alter table public.shipments drop constraint if exists shipments_arrival_notice_via_check;
alter table public.shipments add constraint shipments_arrival_notice_via_check check (arrival_notice_via is null or arrival_notice_via in ('auto', 'desk'));

alter table public.consoles add column if not exists arrival_auto boolean not null default false;
alter table public.consoles add column if not exists arrival_from text not null default '';
alter table public.consoles add column if not exists arrival_days int not null default 2;
alter table public.consoles drop constraint if exists consoles_arrival_days_check;
alter table public.consoles add constraint consoles_arrival_days_check check (arrival_days between 0 and 10);
-- Sending on its own needs somewhere to send from.
alter table public.consoles drop constraint if exists consoles_arrival_auto_from_check;
alter table public.consoles add constraint consoles_arrival_auto_from_check check (not arrival_auto or btrim(arrival_from) <> '');
alter table public.consoles add column if not exists outturn_sent_at timestamptz;
alter table public.consoles add column if not exists outturn_sent_to text not null default '';

create table if not exists public.arrival_notice_sends (
  id            uuid primary key default gen_random_uuid(),
  console_id    uuid references public.consoles(id) on delete cascade,
  shipment_id   text references public.shipments(id) on delete cascade,
  from_mailbox  text not null default '',
  to_addresses  text[] not null default '{}',
  subject       text not null default '',
  status        text not null check (status in ('sent', 'failed', 'skipped')),
  error         text,
  sent_by       uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists arrival_notice_sends_console_idx on public.arrival_notice_sends (console_id, created_at desc);
create index if not exists arrival_notice_sends_shipment_idx on public.arrival_notice_sends (shipment_id);

alter table public.arrival_notice_sends enable row level security;
drop policy if exists arrival_notice_sends_read on public.arrival_notice_sends;
create policy arrival_notice_sends_read on public.arrival_notice_sends for select to authenticated using (true);
-- Written by the function with the service role only.

notify pgrst, 'reload schema';
