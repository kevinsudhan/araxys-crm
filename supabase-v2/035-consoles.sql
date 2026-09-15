-- ---------------------------------------------------------------------------
-- The console: one master bill of lading, many house bills under it.
--
-- WHAT WAS MISSING
--
-- The thing the business actually is. A consolidator buys space from a carrier
-- against ONE master B/L, fills it with cargo from several unrelated shippers,
-- and issues each of them a house B/L on its own series. Until now this system
-- issued one B/L per shipment and had nowhere to record the master at all —
-- which makes it forwarding software, not consol software.
--
-- Everything downstream needs it. The overseas agent bills per master, not per
-- shipment. The IGM is filed per master. Load factor and profitability are
-- per master. "Which house bills are on MSKU9070323" is unanswerable without
-- the grouping.
--
-- WHY THE HOUSE B/L IS `shipments.bl_number` AND NOT A NEW COLUMN
--
-- Because it already is one. The nine document specs that print a B/L number
-- print the number the CUSTOMER holds, and on a consolidation that is the house
-- bill — ours, on our series. The carrier's master number belongs to the
-- console, where exactly one copy of it exists.
--
-- Adding `hbl_number` beside `bl_number` would have meant deciding which one
-- the documents print, keeping them in step, and being wrong somewhere.
--
-- WHY A CONSOLE IS NOT A SAILING
--
-- 026 made a container a sailing, correctly: a sailing is space, of a size, on
-- a route, on a date. A console is a commercial act performed against that
-- space — it has a master bill, an overseas agent, a manifest and a filing
-- reference, and it can span more than one box. One console references one
-- sailing; they are not the same row.
-- ---------------------------------------------------------------------------

create table if not exists public.consoles (
  id            uuid primary key default gen_random_uuid(),

  -- Ours, allocated on opening. Unlike an invoice number this is not a
  -- statutory series, but it is quoted to agents and printed on a manifest, so
  -- it comes from the same locked counter rather than from a max()+1.
  console_no    text unique,
  fy            text,

  direction     text not null default 'export'
                  check (direction in ('export','import','cross_trade')),
  mode          text not null default 'LCL'
                  check (mode in ('LCL','FCL')),

  -- open    — accepting cargo
  -- closed  — past cut-off, no more cargo
  -- sailed  — gone
  -- arrived — at destination
  status        text not null default 'open'
                  check (status in ('open','closed','sailed','arrived','cancelled')),

  -- ------------------------------------------------------- the master bill
  mbl_number    text,
  mbl_date      date,
  -- Who issued it. A carrier direct, or another consolidator we co-loaded with.
  carrier       text not null default '',
  carrier_id    uuid references public.partners(id) on delete set null,
  -- Who receives it at the far end and bills us for their half of the job.
  agent_id      uuid references public.partners(id) on delete set null,

  -- ---------------------------------------------------------------- voyage
  -- The ship the master is on. "Mother vessel" on a transhipment, where the
  -- feeder that leaves Chennai is not the ship that arrives at destination.
  vessel        text not null default '',
  voyage        text not null default '',
  mother_vessel text not null default '',

  -- The booked space this console fills, where the desk booked it here.
  sailing_id    text references public.sailings(id) on delete set null,

  -- ----------------------------------------------------------------- ports
  -- Both the name and the UN/LOCODE. The code is what a filing wants; the name
  -- is what a person reads, and deriving either from the other is a lookup
  -- table this system does not have.
  pol           text not null default '',
  pol_code      text not null default '',
  pod           text not null default '',
  pod_code      text not null default '',
  place_of_delivery text not null default '',
  delivery_code text not null default '',

  etd           date,
  eta           date,
  cutoff_date   date,

  -- --------------------------------------------------------------- filings
  -- Main Line Operator, the carrier's own code in Indian customs filings.
  mlo_code      text not null default '',
  igm_no        text not null default '',
  igm_date      date,
  csn_no        text not null default '',
  csn_date      date,
  cin_type      text not null default '',
  cargo_identification_no text not null default '',

  remarks       text not null default '',

  opened_by     uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists consoles_status_idx  on public.consoles (status, etd);
create index if not exists consoles_mbl_idx     on public.consoles (mbl_number);
create index if not exists consoles_sailing_idx on public.consoles (sailing_id);


-- ---------------------------------------------------------------------------
-- Which console a shipment's house bill sits under
--
-- Nullable. A straight FCL job the desk moves under the carrier's own bill has
-- no console, and forcing a console of one would put a master bill number on a
-- shipment that does not have one.
-- ---------------------------------------------------------------------------
alter table public.shipments
  add column if not exists console_id uuid references public.consoles(id) on delete set null;

create index if not exists shipments_console_idx on public.shipments (console_id);

-- A box belongs to the console that booked it, where there is one. Left null
-- on a direct FCL job, where the box belongs to the shipment alone.
alter table public.shipment_containers
  add column if not exists console_id uuid references public.consoles(id) on delete set null;

create index if not exists shipcon_console_idx on public.shipment_containers (console_id);


-- ---------------------------------------------------------------------------
-- Opening one
--
-- From a sailing where there is one, because the sailing already knows the
-- route, the carrier, the box size and the dates — which is four fields nobody
-- should retype onto a console covering that exact space.
-- ---------------------------------------------------------------------------
create or replace function public.open_console(
  p_sailing_id text default null,
  p_direction  text default 'export',
  p_mode       text default null
)
returns public.consoles
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sail public.sailings;
  v_row  public.consoles;
begin
  if p_sailing_id is not null then
    select * into v_sail from public.sailings where id = p_sailing_id;
    if not found then
      raise exception 'No sailing %', p_sailing_id;
    end if;
  end if;

  insert into public.consoles (
    console_no, fy, direction, mode, sailing_id, carrier,
    pol, pod, etd, cutoff_date, opened_by
  ) values (
    public.allocate_invoice_number('CON', current_date),
    public.fy_of(current_date),
    p_direction,
    coalesce(p_mode, v_sail.mode, 'LCL'),
    p_sailing_id,
    coalesce(v_sail.carrier, ''),
    coalesce(v_sail.origin, ''),
    coalesce(v_sail.destination, ''),
    v_sail.sailing_date,
    v_sail.cutoff_date,
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- Putting a shipment on a console, and taking it off
--
-- Allocating the house bill is deliberately NOT part of attaching. Cargo goes
-- on and comes off a console while it is open — a shipper misses the cut-off,
-- a box turns out to be full — and a house bill number that had been spent on
-- a shipment that left again is a gap in the series nobody can explain.
-- ---------------------------------------------------------------------------
create or replace function public.attach_to_console(p_shipment text, p_console uuid)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_con  public.consoles;
  v_row  public.shipments;
begin
  select * into v_con from public.consoles where id = p_console;
  if not found then
    raise exception 'No console %', p_console;
  end if;
  if v_con.status in ('sailed','arrived','cancelled') then
    raise exception 'Console % has already %', v_con.console_no, v_con.status
      using hint = 'Cargo cannot be added to a console that has gone.';
  end if;

  update public.shipments
     set console_id = p_console,
         -- The console knows the voyage. Carried across so the shipment's own
         -- documents read the same as the manifest rather than being filled in
         -- twice and disagreeing.
         vessel     = coalesce(nullif(v_con.vessel, ''), vessel),
         voyage     = coalesce(nullif(v_con.voyage, ''), voyage),
         carrier    = coalesce(nullif(v_con.carrier, ''), carrier),
         etd        = coalesce(v_con.etd, etd),
         eta        = coalesce(v_con.eta, eta),
         updated_at = now()
   where id = p_shipment
  returning * into v_row;

  if not found then
    raise exception 'No shipment %', p_shipment;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'console_attached',
          format('Put on console %s', v_con.console_no),
          jsonb_build_object('console_id', p_console, 'console_no', v_con.console_no),
          auth.uid());

  return v_row;
end $fn$;

create or replace function public.detach_from_console(p_shipment text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.shipments;
begin
  update public.shipments
     set console_id = null, updated_at = now()
   where id = p_shipment
  returning * into v_row;

  if not found then
    raise exception 'No shipment %', p_shipment;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
  values (v_row.enquiry_ref, 'console_detached', 'Taken off its console', auth.uid());

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- Issuing the house bill
--
-- Our number, on our series, for the shipper who handed us this cargo. The
-- master belongs to the carrier and covers the whole box; this is the document
-- our customer actually holds and presents at destination.
--
-- Refuses to overwrite one that already exists. A B/L number that changes after
-- it has been sent is the single most expensive kind of correction in this
-- business, and "press it twice" must not be how it happens.
-- ---------------------------------------------------------------------------
create or replace function public.issue_house_bl(p_shipment text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.shipments;
begin
  select * into v_row from public.shipments where id = p_shipment;
  if not found then
    raise exception 'No shipment %', p_shipment;
  end if;

  if coalesce(v_row.bl_number, '') <> '' then
    raise exception 'This shipment already carries B/L %', v_row.bl_number
      using hint = 'Clear it first if it genuinely has to change.';
  end if;

  if v_row.consignee_name is null or v_row.consignee_name = '' then
    raise exception 'There is no consignee on this shipment'
      using hint = 'A bill of lading names who the cargo is consigned to.';
  end if;

  update public.shipments
     set bl_number  = public.allocate_invoice_number('HBL', current_date),
         updated_at = now()
   where id = p_shipment
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'hbl_issued',
          format('House B/L %s issued', v_row.bl_number),
          jsonb_build_object('bl_number', v_row.bl_number), auth.uid());

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- What is on a console
--
-- The manifest totals, and the load. `container_count` counts DISTINCT boxes,
-- because on an LCL consolidation six shipments name the same container and
-- counting the rows would say six.
-- ---------------------------------------------------------------------------
create or replace view public.console_summary as
  select c.id as console_id,

         (select count(*) from public.shipments s
           where s.console_id = c.id) as house_bills,

         (select count(*) from public.shipments s
           where s.console_id = c.id and coalesce(s.bl_number, '') <> '') as issued_bills,

         -- DISTINCT boxes. On an LCL consolidation six house bills name the
         -- same container, and counting the rows would report six containers.
         (select count(distinct nullif(sc.container_no, ''))
            from public.shipment_containers sc
            join public.shipments s on s.id = sc.shipment_id
           where s.console_id = c.id) as container_count,

         (select coalesce(sum(sc.package_count), 0)
            from public.shipment_containers sc
            join public.shipments s on s.id = sc.shipment_id
           where s.console_id = c.id) as packages,

         (select coalesce(sum(s.gross_weight_kg), 0) from public.shipments s
           where s.console_id = c.id) as gross_weight_kg,

         (select coalesce(sum(s.volume_cbm), 0) from public.shipments s
           where s.console_id = c.id) as volume_cbm

    from public.consoles c;

grant select on public.console_summary to authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The desk's own records, same as everything around them. No delete: a console
-- that came to nothing is cancelled, because the master bill number and the
-- filings against it are a record of what was declared to customs.
-- ---------------------------------------------------------------------------
alter table public.consoles enable row level security;

drop policy if exists consoles_read on public.consoles;
create policy consoles_read on public.consoles for select to authenticated using (true);

drop policy if exists consoles_insert on public.consoles;
create policy consoles_insert on public.consoles for insert to authenticated with check (true);

drop policy if exists consoles_update on public.consoles;
create policy consoles_update on public.consoles for update to authenticated using (true) with check (true);

revoke all on public.consoles from anon;

grant execute on function public.open_console(text, text, text)    to authenticated;
grant execute on function public.attach_to_console(text, uuid)     to authenticated;
grant execute on function public.detach_from_console(text)         to authenticated;
grant execute on function public.issue_house_bl(text)              to authenticated;
