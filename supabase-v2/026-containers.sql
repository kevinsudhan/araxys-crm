-- ---------------------------------------------------------------------------
-- Containers the desk has booked, and putting enquiries on them.
--
-- WHY THIS EXTENDS sailings RATHER THAN ADDING A containers TABLE
--
-- `sailings` already IS this: a container of a given size, on a route, leaving
-- on a date. A second table holding the same four facts would mean the stowage
-- planner and the containers page disagreed about what space exists, and the
-- one that is wrong is always the one you are not looking at.
--
-- What it was missing is the partner — who the box is with — and the route as
-- two ends rather than one string. Both are added here.
--
-- WHY route IS KEPT
--
-- It is `not null`, the rate card is keyed on it, and the planner reads it. So
-- origin and destination become the fields a person fills in, and `route` is
-- composed from them and kept in step. One is now derived from the other rather
-- than typed twice.
--
-- WHY THE ASSIGNMENT IS A COLUMN ON enquiries
--
-- A container carries many enquiries and an enquiry travels on one container,
-- so the foreign key belongs on the many side. `placements` already links the
-- two, but it carries stowage geometry — metres from the door, pieces across —
-- which is the LCL consolidation problem and not this one. A whole 40' booked
-- against one enquiry has no geometry to record.
-- ---------------------------------------------------------------------------

alter table public.sailings
  add column if not exists origin      text,
  add column if not exists destination text,
  add column if not exists partner_id  uuid references public.partners(id) on delete set null,
  add column if not exists notes       text not null default '';

-- Existing rows carry "Chennai to Jebel Ali". Split what can be split; leave
-- anything shaped differently alone rather than guessing at it.
update public.sailings
   set origin      = btrim(split_part(route, ' to ', 1)),
       destination = btrim(split_part(route, ' to ', 2))
 where origin is null
   and route ilike '% to %';

alter table public.enquiries
  add column if not exists sailing_id text references public.sailings(id) on delete set null;

create index if not exists enquiries_sailing_idx on public.enquiries (sailing_id);
create index if not exists sailings_partner_idx  on public.sailings (partner_id);

-- ---------------------------------------------------------------------------
-- Adding a container.
--
-- The id stays short text rather than becoming a uuid, because the column is
-- text and a uuid beside a hand-readable id is worse than either alone.
--
-- It does NOT imitate the seeded rows, which are sl-cmb-1 / sl-jea-2 — a port
-- code baked into the id by the demo seeder. Reproducing that would mean
-- deriving a three-letter code from arbitrary text, and there is no correct
-- answer for "Nhava Sheva". So new ids are sl-1, sl-2, and the regex below
-- deliberately matches only that shape: the seeded ids are excluded from the
-- max, which is safe precisely because they can never collide with it.
--
-- 40GP is the default because a plain forty-foot box is what the desk books
-- unless somebody says otherwise. It is the argument's default, not a column
-- default, so the caller can always be explicit.
-- ---------------------------------------------------------------------------
create or replace function public.create_container(
  p_origin         text,
  p_destination    text,
  p_sailing_date   date,
  p_partner_id     uuid    default null,
  p_container_code text    default '40GP',
  p_carrier        text    default '',
  p_cutoff_date    date    default null,
  p_mode           text    default 'FCL',
  p_notes          text    default ''
) returns public.sailings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id   text;
  v_next int;
  v_row  public.sailings;
begin
  if coalesce(btrim(p_origin), '') = '' or coalesce(btrim(p_destination), '') = '' then
    raise exception 'a container needs both ends of its route';
  end if;
  if p_sailing_date is null then
    raise exception 'a container needs a sailing date';
  end if;
  if p_cutoff_date is not null and p_cutoff_date > p_sailing_date then
    raise exception 'the cut-off cannot be after the sailing date';
  end if;
  if not exists (select 1 from public.container_specs where code = p_container_code) then
    raise exception 'unknown container type %', p_container_code;
  end if;

  -- Next free number in the existing sequence. Taken under a lock on the table
  -- so two people adding a container at once cannot both read the same max.
  lock table public.sailings in share row exclusive mode;
  select coalesce(max(nullif(regexp_replace(id, '\D', '', 'g'), '')::int), 0) + 1
    into v_next
    from public.sailings
   where id ~ '^sl-\d+$';
  v_id := 'sl-' || v_next;

  insert into public.sailings
    (id, route, carrier, container_code, mode, sailing_date, cutoff_date,
     origin, destination, partner_id, notes, status)
  values
    (v_id,
     btrim(p_origin) || ' to ' || btrim(p_destination),
     coalesce(p_carrier, ''),
     p_container_code,
     p_mode,
     p_sailing_date,
     p_cutoff_date,
     btrim(p_origin),
     btrim(p_destination),
     p_partner_id,
     coalesce(p_notes, ''),
     'open')
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function
  public.create_container(text, text, date, uuid, text, text, date, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Editing one, and retiring one.
--
-- Sailed containers are not deleted: an enquiry that travelled on one has to
-- stay resolvable, which is the same rule partners follow.
-- ---------------------------------------------------------------------------
create or replace function public.update_container(
  p_id             text,
  p_origin         text default null,
  p_destination    text default null,
  p_sailing_date   date default null,
  p_partner_id     uuid default null,
  p_container_code text default null,
  p_carrier        text default null,
  p_cutoff_date    date default null,
  p_status         text default null,
  p_notes          text default null
) returns public.sailings
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.sailings;
  v_o   text;
  v_d   text;
begin
  select * into v_row from public.sailings where id = p_id for update;
  if not found then
    raise exception 'no container %', p_id;
  end if;

  v_o := coalesce(nullif(btrim(coalesce(p_origin, '')), ''), v_row.origin);
  v_d := coalesce(nullif(btrim(coalesce(p_destination, '')), ''), v_row.destination);

  update public.sailings
     set origin         = v_o,
         destination    = v_d,
         -- Recomposed whenever either end moves, so the two never disagree.
         route          = case
                            when v_o is not null and v_d is not null then v_o || ' to ' || v_d
                            else route
                          end,
         sailing_date   = coalesce(p_sailing_date, sailing_date),
         partner_id     = coalesce(p_partner_id, partner_id),
         container_code = coalesce(p_container_code, container_code),
         carrier        = coalesce(p_carrier, carrier),
         cutoff_date    = coalesce(p_cutoff_date, cutoff_date),
         status         = coalesce(p_status, status),
         notes          = coalesce(p_notes, notes)
   where id = p_id
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function
  public.update_container(text, text, text, date, uuid, text, text, date, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Putting an enquiry on a container.
--
-- Both directions are one function with a null, rather than two that could
-- drift: passing no container takes the enquiry off whatever it was on.
--
-- Every move writes a timeline entry, because "which box did this go on, and
-- who decided" is exactly the question asked three weeks later when a customer
-- rings about a shipment nobody present remembers.
-- ---------------------------------------------------------------------------
create or replace function public.assign_container(
  p_ref        text,
  p_sailing_id text default null
) returns public.enquiries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_enq  public.enquiries;
  v_sail public.sailings;
  v_me   uuid := auth.uid();
begin
  select * into v_enq from public.enquiries where ref = p_ref for update;
  if not found then
    raise exception 'no enquiry %', p_ref;
  end if;

  if p_sailing_id is not null then
    select * into v_sail from public.sailings where id = p_sailing_id;
    if not found then
      raise exception 'no container %', p_sailing_id;
    end if;
    if v_sail.status = 'sailed' then
      raise exception 'that container has already sailed';
    end if;
  end if;

  -- Pressing it twice is a question, not a second booking.
  if coalesce(v_enq.sailing_id, '') = coalesce(p_sailing_id, '') then
    return v_enq;
  end if;

  update public.enquiries
     set sailing_id = p_sailing_id
   where ref = p_ref
  returning * into v_enq;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    p_ref,
    case when p_sailing_id is null then 'container_cleared' else 'container_assigned' end,
    case
      when p_sailing_id is null then 'Taken off its container'
      else format('Put on %s %s, sailing %s',
                  v_sail.container_code, v_sail.route,
                  to_char(v_sail.sailing_date, 'DD Mon YYYY'))
    end,
    jsonb_build_object(
      'sailing_id', p_sailing_id,
      'previous_sailing_id', v_enq.sailing_id,
      'container_code', v_sail.container_code,
      'route', v_sail.route,
      'sailing_date', v_sail.sailing_date
    ),
    v_me
  );

  return v_enq;
end $fn$;

grant execute on function public.assign_container(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What is on each container, counted by the database.
--
-- A view rather than a count done in the browser: the page lists containers and
-- wants a number against each, and doing that client-side is one request per
-- container or a second full table read.
-- ---------------------------------------------------------------------------
create or replace view public.container_load as
select
  s.id,
  count(e.ref)                                   as enquiry_count,
  coalesce(sum(e.volume_cbm), 0)                 as booked_cbm,
  coalesce(sum(e.gross_weight_kg), 0)            as booked_kg
from public.sailings s
left join public.enquiries e on e.sailing_id = s.id
group by s.id;

grant select on public.container_load to authenticated;

-- RLS: sailings is already readable by the desk from 006. The new column on
-- enquiries inherits that table's existing policies, so nothing is opened here.
