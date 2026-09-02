-- Sailings and what is loaded into them.
--
-- The knowledge pack the voice agent reads is generated from these two tables,
-- so remaining space is never a number somebody kept up to date by hand.
--
-- Occupancy is deliberately NOT a column. It is derived from the placements
-- actually loaded, so the figure drawn on the space board and the figure an
-- agent quotes on a call are computed from one source and cannot drift apart.

create table if not exists public.sailings (
  id             text primary key,               -- sl-1
  route          text not null,                  -- "Chennai to Jebel Ali"
  carrier        text not null default '',
  container_code text not null,                  -- 40HC / 20GP / 40GP
  mode           text not null default 'LCL' check (mode in ('LCL','FCL')),
  sailing_date   date not null,
  cutoff_date    date,
  status         text not null default 'open' check (status in ('open','closing_soon','full','sailed')),
  created_at     timestamptz not null default now()
);

create index if not exists sailings_route_idx on public.sailings (route);
create index if not exists sailings_date_idx  on public.sailings (sailing_date);

create table if not exists public.placements (
  id             uuid primary key default gen_random_uuid(),
  sailing_id     text not null references public.sailings(id) on delete cascade,
  enquiry_ref    text references public.enquiries(ref) on delete set null,
  client_name    text not null default '',

  x_m            numeric not null default 0,     -- metres from the door
  length_m       numeric not null,               -- floor length consumed
  pieces_across  int not null default 1,
  pieces_high    int not null default 1,
  rows_count     int not null default 1,
  quantity       int not null default 0,
  piece_length_m numeric,
  piece_width_m  numeric,
  piece_height_m numeric,
  weight_kg      numeric not null default 0,

  created_at     timestamptz not null default now(),

  -- Two consignments cannot occupy the same metre of floor. Enforced here
  -- rather than in application code, because a load plan that overlaps would
  -- corrupt every availability figure downstream -- including the one an agent
  -- reads out to a customer.
  constraint placements_positive check (length_m > 0 and x_m >= 0)
);

create index if not exists placements_sailing_idx on public.placements (sailing_id);
create index if not exists placements_enquiry_idx on public.placements (enquiry_ref);

create extension if not exists btree_gist;

alter table public.placements drop constraint if exists placements_no_overlap;
alter table public.placements
  add constraint placements_no_overlap
  exclude using gist (
    sailing_id with =,
    numrange(x_m::numeric, (x_m + length_m)::numeric) with &&
  );

-- Standard container internals, so the fit maths has real numbers to work from.
create table if not exists public.container_specs (
  code           text primary key,
  length_m       numeric not null,
  width_m        numeric not null,
  height_m       numeric not null,
  max_payload_kg numeric not null
);

insert into public.container_specs (code, length_m, width_m, height_m, max_payload_kg)
values
  ('20GP',  5.90, 2.35, 2.39, 28200),
  ('40GP', 12.03, 2.35, 2.39, 26700),
  ('40HC', 12.03, 2.35, 2.69, 28600)
on conflict (code) do update
  set length_m = excluded.length_m,
      width_m = excluded.width_m,
      height_m = excluded.height_m,
      max_payload_kg = excluded.max_payload_kg;

-- ---------------------------------------------------------------------------
-- Rate card
--
-- Seeded with plausible figures so the pricing pack has something to publish,
-- and editable from the CRM. The agent quotes from whatever is in here, and the
-- rule that it may never invent a rate for a lane that is absent depends on
-- this table being the only source.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_card (
  id             uuid primary key default gen_random_uuid(),
  route          text not null unique,
  per_cbm_inr    numeric not null,
  minimum_inr    numeric not null,
  floor_inr      numeric not null,          -- lowest the agent may negotiate to
  transit_days   int,
  notes          text not null default '',
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS, matching the operational tables: internal, authenticated read/write.
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['sailings','placements','container_specs','rate_card'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)',
                   t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)',
                   t || '_update', t);
  end loop;
end $rls$;

-- ---------------------------------------------------------------------------
-- Remaining space, derived
--
-- `frontier` is the back edge of the last block, not the sum of the blocks:
-- with a gap in the stow those differ, and using the sum would drop the next
-- consignment on top of an existing one.
-- ---------------------------------------------------------------------------
create or replace view public.sailing_space as
select
  s.id,
  s.route,
  s.carrier,
  s.container_code,
  s.mode,
  s.sailing_date,
  s.cutoff_date,
  s.status,
  c.length_m       as container_length_m,
  c.width_m        as container_width_m,
  c.height_m       as container_height_m,
  c.max_payload_kg,
  coalesce(p.consignments, 0)                                   as consignments,
  coalesce(p.used_length_m, 0)                                  as used_length_m,
  coalesce(p.used_weight_kg, 0)                                 as used_weight_kg,
  coalesce(p.frontier_m, 0)                                     as frontier_m,
  round(c.length_m - coalesce(p.frontier_m, 0), 2)              as free_length_m,
  round(c.max_payload_kg - coalesce(p.used_weight_kg, 0), 0)    as free_payload_kg,
  round((c.length_m - coalesce(p.frontier_m, 0)) * c.width_m * c.height_m, 2) as free_cbm
from public.sailings s
join public.container_specs c on c.code = s.container_code
left join (
  select
    sailing_id,
    count(*)                       as consignments,
    sum(length_m)                  as used_length_m,
    sum(weight_kg)                 as used_weight_kg,
    max(x_m + length_m)            as frontier_m
  from public.placements
  group by sailing_id
) p on p.sailing_id = s.id;

grant select on public.sailing_space to authenticated;
