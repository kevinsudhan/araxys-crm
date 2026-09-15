-- ---------------------------------------------------------------------------
-- The physical boxes a shipment travels in.
--
-- WHAT WAS WRONG
--
-- `shipments.container_number` is one text column, so a booking could record
-- exactly one container. An FCL job with three boxes had two of them nowhere,
-- and the VGM declaration — which is per container, by law — had one number to
-- print however many boxes were actually stuffed.
--
-- Seal numbers, ISO codes and CFS had nowhere at all. A seal number is the
-- thing a consignee checks against the B/L before they accept delivery; it is
-- not an optional detail.
--
-- WHY A TABLE AND NOT MORE COLUMNS
--
-- Because the answer is a list. container_number_2 and container_number_3 is
-- the shape that makes somebody add container_number_4 in a year, and it makes
-- "how many boxes went to Colombo last month" unanswerable.
--
-- WHY THE BOX PARTICULARS LIVE HERE AND NOT ON `sailings`
--
-- A sailing is space the desk booked — a slot of a given size on a given
-- voyage. It is booked before anybody knows which physical box will be used,
-- and the number and seal arrive later, from the carrier. Putting them on the
-- sailing would mean a row that is half commitment and half outturn.
--
-- `sailing_id` links the two where the box is one the desk booked. It is
-- nullable because on an import nobody here booked anything.
-- ---------------------------------------------------------------------------

create table if not exists public.shipment_containers (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  text not null references public.shipments(id) on delete cascade,

  -- The booked space this box fills, where the desk booked it.
  sailing_id   text references public.sailings(id) on delete set null,

  -- Display order, which is how the desk lists them on the B/L. Creation order
  -- is not that.
  position     int  not null default 1,

  -- ------------------------------------------------------------ the box
  -- Four letters and seven digits, ISO 6346. Not constrained: a number that
  -- arrives from a carrier mistyped is still the number on the paperwork, and
  -- refusing to save it would leave the desk with nowhere to put the truth.
  container_no text not null default '',
  size_type    text not null default '',        -- 20' GP, 40' HC
  iso_code     text not null default '',        -- 2210, 45G1
  seal_type    text not null default '',        -- carrier seal, bottle seal
  seal_no      text not null default '',

  -- --------------------------------------------- what went into it, from us
  -- Per box, not per shipment. On an LCL consolidation this is our share of
  -- somebody else's container, which is exactly the number that cannot live in
  -- a single column on the shipment.
  package_count int,
  package_type  text not null default '',
  weight_kg     numeric,
  volume_cbm    numeric,
  -- Shipping marks, printed on the B/L against this box.
  marks_numbers text not null default '',

  -- ---------------------------------------------------------- where it is
  cfs          text not null default '',
  godown_no    text not null default '',

  -- ---------------------------------------------------------------- flags
  -- Shipper-owned rather than the carrier's. Decides who wears detention, so
  -- it is not cosmetic.
  is_soc       boolean not null default false,
  -- Moving empty, for repositioning.
  is_empty     boolean not null default false,
  -- Our cargo riding in another forwarder's box, or theirs in ours. This is
  -- the consolidation business and nothing in the system recorded it.
  is_coload    boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists shipcon_shipment_idx on public.shipment_containers (shipment_id, position);
create index if not exists shipcon_sailing_idx  on public.shipment_containers (sailing_id);
create index if not exists shipcon_number_idx   on public.shipment_containers (container_no);


-- ---------------------------------------------------------------------------
-- Job-level particulars that sit under the grid on the same screen.
--
-- These are one-per-booking, not one-per-box, which is why they are columns
-- here rather than fields in the table above.
-- ---------------------------------------------------------------------------
alter table public.shipments
  add column if not exists agent_code         text,
  add column if not exists mainline_no        text,
  add column if not exists cfs_clearance_date date,
  add column if not exists tsa_no             text,
  add column if not exists tsa_date           date;


-- ---------------------------------------------------------------------------
-- Keeping `shipments.container_number` true
--
-- Nine document specs print a single container number and the delivery order
-- and VGM declaration require one. Rewriting that pipeline to take a list is a
-- separate job; until then the column mirrors the first box.
--
-- This is safe specifically because the trigger is the only writer. Nothing in
-- the application writes `container_number` — it is read in six places and set
-- in none — so there is no second source to disagree with. If something ever
-- does write it by hand, this stops being a mirror and starts being a race.
-- ---------------------------------------------------------------------------
create or replace function public.sync_shipment_container_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship text := coalesce(new.shipment_id, old.shipment_id);
begin
  update public.shipments s
     set container_number = (
           select nullif(c.container_no, '')
             from public.shipment_containers c
            where c.shipment_id = v_ship
            order by c.position, c.created_at
            limit 1
         ),
         updated_at = now()
   where s.id = v_ship;

  return coalesce(new, old);
end $fn$;

drop trigger if exists shipcon_sync_number on public.shipment_containers;
create trigger shipcon_sync_number
  after insert or update or delete on public.shipment_containers
  for each row execute function public.sync_shipment_container_number();


-- ---------------------------------------------------------------------------
-- What is already recorded, carried across
--
-- Bookings that have a container number on them today become a first row, so
-- nothing that was entered before this migration disappears from the screen.
-- ---------------------------------------------------------------------------
insert into public.shipment_containers
  (shipment_id, sailing_id, position, container_no, size_type,
   package_count, package_type, weight_kg, volume_cbm)
select s.id,
       s.sailing_id,
       1,
       s.container_number,
       coalesce(s.container_type, ''),
       s.package_count,
       coalesce(s.package_type, ''),
       s.gross_weight_kg,
       s.volume_cbm
  from public.shipments s
 where coalesce(s.container_number, '') <> ''
   and not exists (
     select 1 from public.shipment_containers c where c.shipment_id = s.id
   );


-- ---------------------------------------------------------------------------
-- Totals across the boxes on a job
--
-- A view rather than columns, because it is a sum of rows that change
-- underneath it. What the desk asks of it: how many boxes, how many packages
-- altogether, and how much it weighs — the three figures a B/L totals line
-- carries.
-- ---------------------------------------------------------------------------
create or replace view public.shipment_container_totals as
  select s.id as shipment_id,
         count(c.id)                          as container_count,
         coalesce(sum(c.package_count), 0)    as package_total,
         coalesce(sum(c.weight_kg), 0)        as weight_total_kg,
         coalesce(sum(c.volume_cbm), 0)       as volume_total_cbm,
         bool_or(c.is_coload)                 as any_coload
    from public.shipments s
    left join public.shipment_containers c on c.shipment_id = s.id
   group by s.id;

grant select on public.shipment_container_totals to authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The desk's own operational records, same as everything around them. Delete
-- is granted here, unlike on invoices: a container added to the wrong booking
-- is a typo, not a document somebody has been sent.
-- ---------------------------------------------------------------------------
alter table public.shipment_containers enable row level security;

drop policy if exists shipcon_read on public.shipment_containers;
create policy shipcon_read on public.shipment_containers
  for select to authenticated using (true);

drop policy if exists shipcon_insert on public.shipment_containers;
create policy shipcon_insert on public.shipment_containers
  for insert to authenticated with check (true);

drop policy if exists shipcon_update on public.shipment_containers;
create policy shipcon_update on public.shipment_containers
  for update to authenticated using (true) with check (true);

drop policy if exists shipcon_delete on public.shipment_containers;
create policy shipcon_delete on public.shipment_containers
  for delete to authenticated using (true);

revoke all on public.shipment_containers from anon;
