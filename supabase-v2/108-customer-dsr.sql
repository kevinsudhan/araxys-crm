-- 108: The customer's DSR (daily status report): every live shipment of theirs
-- on one sheet, seen on the customer's page and mailed to them from there.
--
-- Nearly every column is read from what the job already holds — references,
-- milestones, vessel, dates. Two are the desk's own words, per shipment:
--
--   shipment_dsr_notes   the REASON (what is happening) and the STATUS (what
--                        is awaited), as the customer reads them. Its own
--                        table, not shipment columns: a shipment signed off
--                        is locked (072), and its DSR line must still be
--                        kept current until it drops off the report.
--   customer_dsr_sends   every DSR mailed: to whom, by whom, which shipments.
--                        The page shows the last one.

create table if not exists public.shipment_dsr_notes (
  shipment_id  text primary key references public.shipments (id) on delete cascade,
  remark       text not null default '' check (length(remark) <= 1000),
  status       text not null default '' check (length(status) <= 500),
  updated_by   uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at   timestamptz not null default now()
);

create or replace function public.shipment_dsr_notes_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.remark := btrim(new.remark);
  new.status := btrim(new.status);
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.shipment_dsr_notes_touch() from public, anon, authenticated;

drop trigger if exists shipment_dsr_notes_touch on public.shipment_dsr_notes;
create trigger shipment_dsr_notes_touch
  before insert or update on public.shipment_dsr_notes
  for each row execute function public.shipment_dsr_notes_touch();

create table if not exists public.customer_dsr_sends (
  id            bigserial primary key,
  customer_id   text not null references public.customers (id) on delete cascade,
  sent_by       uuid references auth.users (id) on delete set null default auth.uid(),
  sent_from     text not null default '',
  to_addresses  text[] not null default '{}',
  cc_addresses  text[] not null default '{}',
  subject       text not null default '' check (length(subject) <= 400),
  shipment_ids  text[] not null default '{}',
  sent_at       timestamptz not null default now()
);
create index if not exists customer_dsr_sends_customer_idx on public.customer_dsr_sends (customer_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Staff read and write the notes (as shipments, 013). The send log is added
-- to, as the sender, and never rewritten.
-- ---------------------------------------------------------------------------
alter table public.shipment_dsr_notes enable row level security;
alter table public.customer_dsr_sends enable row level security;

revoke all on public.shipment_dsr_notes, public.customer_dsr_sends from public, anon;
revoke all on sequence public.customer_dsr_sends_id_seq from public, anon;
grant select, insert, update on public.shipment_dsr_notes to authenticated;
revoke delete, truncate, references, trigger on public.shipment_dsr_notes from authenticated;
grant select, insert on public.customer_dsr_sends to authenticated;
revoke update, delete, truncate, references, trigger on public.customer_dsr_sends from authenticated;
grant usage on sequence public.customer_dsr_sends_id_seq to authenticated;
grant all on public.shipment_dsr_notes, public.customer_dsr_sends to service_role;
grant usage, select on sequence public.customer_dsr_sends_id_seq to service_role;

drop policy if exists shipment_dsr_notes_read on public.shipment_dsr_notes;
create policy shipment_dsr_notes_read on public.shipment_dsr_notes
  for select to authenticated using (true);
drop policy if exists shipment_dsr_notes_write on public.shipment_dsr_notes;
create policy shipment_dsr_notes_write on public.shipment_dsr_notes
  for insert to authenticated with check (true);
drop policy if exists shipment_dsr_notes_update on public.shipment_dsr_notes;
create policy shipment_dsr_notes_update on public.shipment_dsr_notes
  for update to authenticated using (true) with check (true);

drop policy if exists customer_dsr_sends_read on public.customer_dsr_sends;
create policy customer_dsr_sends_read on public.customer_dsr_sends
  for select to authenticated using (true);
drop policy if exists customer_dsr_sends_add on public.customer_dsr_sends;
create policy customer_dsr_sends_add on public.customer_dsr_sends
  for insert to authenticated with check (sent_by = auth.uid());

-- Changed by anybody, read again on every open page (084).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.shipment_dsr_notes;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.customer_dsr_sends;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
