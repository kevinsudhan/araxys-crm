-- Araxys — container space, moved from process memory into Postgres.
--
-- The space engine previously held slots and placements in memory, which meant every
-- backend restart silently reset bookings to seed data. On Edge Functions that would be
-- worse still: each invocation is a fresh process, so a booking made on one request would
-- not exist on the next. Persisting it fixes both.
--
-- Occupancy stays DERIVED from placements rather than stored as a total, so the load plan
-- drawn on screen and the remaining-space figure quoted on a call cannot drift apart.

create table if not exists public.space_slots (
  id             text primary key,          -- sl-1, sl-2, ...
  route          text not null,
  carrier        text not null,
  sailing_date   text not null,
  cutoff_date    text not null,
  container_code text not null,             -- 20GP, 40GP, 40HC, ...
  mode           text not null check (mode in ('LCL','FCL')),
  status         text not null default 'open'
                   check (status in ('open','closing_soon','full')),
  created_at     timestamptz not null default now()
);

create index if not exists space_slots_route_idx on public.space_slots (route);
create index if not exists space_slots_date_idx  on public.space_slots (sailing_date);

create table if not exists public.space_placements (
  id               text primary key,
  slot_id          text not null references public.space_slots(id) on delete cascade,
  client_name      text not null,
  reference        text not null,
  -- Metres from the container's back wall to the start of this consignment.
  x_m              numeric not null,
  length_m         numeric not null,
  pieces_across    integer not null,
  pieces_high      integer not null,
  rows_count       integer not null,
  quantity         integer not null,
  piece_length_m   numeric not null,
  piece_width_m    numeric not null,
  piece_height_m   numeric not null,
  weight_kg        numeric not null,
  color_index      integer not null default 0,
  source           text not null default 'crm'
                     check (source in ('seed','crm','voice_agent')),
  created_at       timestamptz not null default now()
);

create index if not exists space_placements_slot_idx on public.space_placements (slot_id);

-- Same posture as the customer tables: no public policies, so the anon key reads nothing.
-- Everything goes through the service_role key server-side.
alter table public.space_slots      enable row level security;
alter table public.space_placements enable row level security;
