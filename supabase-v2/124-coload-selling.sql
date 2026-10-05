-- 124: Selling space on our console to another forwarder (co-loading, the selling side).
--
-- ---------------------------------------------------------------------------
-- A forwarder with LCL cargo for a lane we run a box on buys space on it: they
-- are our customer like any other — an enquiry, a quotation per W/M, a booking,
-- a job put on the console — but our house B/L goes to THEM, shipper the
-- forwarder and consignee their agent at destination, and they need from us
-- what a co-loader always needs: where and by when to deliver the cargo, and
-- what to send for our B/L.
--
--   customers.forwarder   They are a freight forwarder: their cargo on our
--                         consoles is co-loaded.
--   shipments.coload_instructions_sent_at / _to
--                         When our delivery instructions (CFS, cut-off, the
--                         shipping instructions we need) went to them.
--
-- The CFS the box is stuffed at is the console's (consoles.cfs_name, 120).
-- ---------------------------------------------------------------------------

alter table public.customers add column if not exists forwarder boolean not null default false;

alter table public.shipments add column if not exists coload_instructions_sent_at timestamptz;
alter table public.shipments add column if not exists coload_instructions_sent_to text not null default '';

notify pgrst, 'reload schema';
