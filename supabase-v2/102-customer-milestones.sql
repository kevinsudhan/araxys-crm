-- 102: The customer's tracking page shows what the desk records, and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
--
-- The page a customer opens from their tracking link (069, 072, 074, 079) was
-- assembled from everything on the job as it happened: steps ticked on the
-- workflow bar, and ticked on their own by a warehouse receipt (068), a
-- delivery recorded on Pickup & delivery (079) or a carrier's container event
-- (072); the airline's revised ETA; a ship's AIS position on a map; the
-- carrier's own lines; the internal follow-ups with the dates the rules
-- worked out for them ("Document follow-up — expected 24 Sep"). Nobody
-- decided what the customer was told; the page said whatever the records said.
--
-- THE MODEL
--
-- Each job has its own list of customer milestones — booking confirmed,
-- picked up, received at the CFS, export customs cleared, sailed, arrived,
-- import customs cleared, out for delivery, delivered, per mode — and the
-- page shows those and the booking's own details, nothing more. A milestone is
-- reached only when somebody records it on the job's Tracking tab: the date,
-- the time if known, where, and a note for the customer. The desk can also add
-- an update of its own ("Transhipped at Colombo") and hide a milestone that
-- is not part of this job (delivery on an FOB export).
--
-- The job's stage follows the same record. The milestones that mark a stage
-- (booked, received, stuffed, gated in, sailed, arrived, delivered) tick the
-- workflow step for it, and that step can be ticked no other way — so the
-- header, the boards and the customer can never say different things. Other
-- records (a receipt, a delivery's POD, the LEO date, a carrier's event) are
-- offered on the Tracking tab as "use this", and change nothing on their own.
--
-- WHAT THE PUBLIC KEY LOSES
--
-- shipment_track_points (076) and shipment_customs_public (077) fed the map's
-- positions and the customs cards; the page no longer shows either, so both
-- are dropped. The anonymous key now reaches three functions: the quotation's
-- two and shipment_tracking.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- The standing list per mode
--
-- `direction`: a customs milestone for one side only. Seeded on every job,
-- and hidden on a job going the other way, so a DDP export can show it.
-- ---------------------------------------------------------------------------
create table if not exists public.milestone_templates (
  mode      text not null,
  position  int  not null,
  code      text not null,
  label     text not null,
  stage     text check (stage in ('booked','cargo_received','stuffed','gated_in','sailed','arrived','delivered')),
  direction text check (direction in ('export', 'import')),
  primary key (mode, code)
);

alter table public.milestone_templates enable row level security;
drop policy if exists milestone_templates_read on public.milestone_templates;
create policy milestone_templates_read on public.milestone_templates
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.milestone_templates from authenticated;

insert into public.milestone_templates (mode, position, code, label, stage, direction) values
  ('air',     10,  'booked',           'Booking confirmed',              'booked',         null),
  ('air',     20,  'picked_up',        'Cargo picked up',                null,             null),
  ('air',     30,  'received',         'Received at the warehouse',      'cargo_received', null),
  ('air',     40,  'export_customs',   'Export customs cleared',         null,             'export'),
  ('air',     50,  'departed',         'Flight departed',                'sailed',         null),
  ('air',     60,  'arrived',          'Arrived at destination airport', 'arrived',        null),
  ('air',     70,  'import_customs',   'Import customs cleared',         null,             'import'),
  ('air',     80,  'out_for_delivery', 'Out for delivery',               null,             null),
  ('air',     90,  'delivered',        'Delivered',                      'delivered',      null),

  ('sea_lcl', 10,  'booked',           'Booking confirmed',              'booked',         null),
  ('sea_lcl', 20,  'picked_up',        'Cargo picked up',                null,             null),
  ('sea_lcl', 30,  'received',         'Received at the CFS',            'cargo_received', null),
  ('sea_lcl', 40,  'export_customs',   'Export customs cleared',         null,             'export'),
  ('sea_lcl', 50,  'departed',         'Vessel sailed',                  'sailed',         null),
  ('sea_lcl', 60,  'arrived',          'Arrived at destination port',    'arrived',        null),
  ('sea_lcl', 70,  'import_customs',   'Import customs cleared',         null,             'import'),
  ('sea_lcl', 80,  'out_for_delivery', 'Out for delivery',               null,             null),
  ('sea_lcl', 90,  'delivered',        'Delivered',                      'delivered',      null),

  ('sea_fcl', 10,  'booked',           'Booking confirmed',              'booked',         null),
  ('sea_fcl', 20,  'empty_picked',     'Empty container picked up',      null,             null),
  ('sea_fcl', 30,  'stuffed',          'Container stuffed',              'stuffed',        null),
  ('sea_fcl', 40,  'export_customs',   'Export customs cleared',         null,             'export'),
  ('sea_fcl', 50,  'gated_in',         'Gated in at the port',           'gated_in',       null),
  ('sea_fcl', 60,  'departed',         'Vessel sailed',                  'sailed',         null),
  ('sea_fcl', 70,  'arrived',          'Arrived at destination port',    'arrived',        null),
  ('sea_fcl', 80,  'import_customs',   'Import customs cleared',         null,             'import'),
  ('sea_fcl', 90,  'out_for_delivery', 'Out for delivery',               null,             null),
  ('sea_fcl', 100, 'delivered',        'Delivered',                      'delivered',      null),

  -- road, other, and a mode nobody set: the stages checkpoint_templates has
  ('default', 10,  'booked',           'Booking confirmed',              'booked',         null),
  ('default', 20,  'picked_up',        'Cargo picked up',                'cargo_received', null),
  ('default', 30,  'departed',         'Dispatched',                     'sailed',         null),
  ('default', 40,  'out_for_delivery', 'Out for delivery',               null,             null),
  ('default', 50,  'delivered',        'Delivered',                      'delivered',      null)
on conflict (mode, code) do update
  set position = excluded.position, label = excluded.label, stage = excluded.stage, direction = excluded.direction;


-- ---------------------------------------------------------------------------
-- Each job's list
--
-- reached_on / reached_time: the day, and the time if known, as the desk was
-- told it — the local time where it happened, the way the trade quotes it,
-- not converted. Null: not reached.
-- added: an update the desk wrote itself; it always has a date, and can be
-- deleted. The standing ones cannot, only hidden.
-- updated_at: when the customer's page last changed because of this row.
-- ---------------------------------------------------------------------------
create table if not exists public.shipment_milestones (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  text not null references public.shipments (id) on delete cascade,
  code         text not null,
  position     int  not null,
  label        text not null check (length(btrim(label)) between 2 and 120),
  stage        text check (stage in ('booked','cargo_received','stuffed','gated_in','sailed','arrived','delivered')),
  reached_on   date,
  reached_time time,
  location     text not null default '' check (length(location) <= 120),
  note         text not null default '' check (length(note) <= 500),
  hidden       boolean not null default false,
  added        boolean not null default false,
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (shipment_id, code),
  check (reached_time is null or reached_on is not null),
  check (not added or (reached_on is not null and stage is null))
);

create index if not exists shipment_milestones_shipment_idx on public.shipment_milestones (shipment_id, position);

-- Staff read; every write goes through the functions below.
alter table public.shipment_milestones enable row level security;
drop policy if exists shipment_milestones_read on public.shipment_milestones;
create policy shipment_milestones_read on public.shipment_milestones
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.shipment_milestones from authenticated;


-- ---------------------------------------------------------------------------
-- A milestone's step on the workflow bar follows it
--
-- Done when the milestone is reached, dated by it (as India's time, never in
-- the future); open when it is not. The step's trigger (066) moves the stage.
-- Called only from the functions here, which run as the owner.
-- ---------------------------------------------------------------------------
create or replace function public.milestone_to_step(p_shipment_id text, p_stage text)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_on   date;
  v_time time;
  v_at   timestamptz;
begin
  select m.reached_on, m.reached_time into v_on, v_time
    from public.shipment_milestones m
   where m.shipment_id = p_shipment_id and m.stage = p_stage and m.reached_on is not null
   order by m.reached_on, m.reached_time nulls first
   limit 1;

  v_at := case when v_on is null then null
               else least((v_on + coalesce(v_time, time '00:00')) at time zone 'Asia/Kolkata', now()) end;

  perform set_config('app.milestone_write', 'on', true);
  update public.shipment_checkpoints c
     set done_at = v_at,
         done_by = case when v_at is null then null else auth.uid() end
   where c.shipment_id = p_shipment_id and c.stage = p_stage
     and c.done_at is distinct from v_at;
  perform set_config('app.milestone_write', 'off', true);
end $fn$;

revoke execute on function public.milestone_to_step(text, text) from public, anon, authenticated;


-- A step that marks a stage is ticked only by its milestone. Nothing a browser
-- sends can set the flag: it lives for the one transaction that sets it.
create or replace function public.guard_milestone_step()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.stage is not null
     and new.done_at is distinct from old.done_at
     and coalesce(current_setting('app.milestone_write', true), '') <> 'on'
  then
    raise exception '"%" is a tracking milestone: record it on the job''s Tracking tab, which is what the customer sees', old.label
      using hint = 'Shipment → Tracking → Customer milestones';
  end if;
  return new;
end $fn$;

revoke execute on function public.guard_milestone_step() from public, anon, authenticated;

drop trigger if exists shipment_checkpoints_milestone_guard on public.shipment_checkpoints;
create trigger shipment_checkpoints_milestone_guard
  before update of done_at on public.shipment_checkpoints
  for each row execute function public.guard_milestone_step();


-- ---------------------------------------------------------------------------
-- Recording one
--
-- p_on null: not reached (the place and note stay, for "planned for Thursday").
-- p_label: the wording of an update the desk added; the standing labels stay.
-- A signed-off or cancelled job refuses, like every other change to its progress.
-- ---------------------------------------------------------------------------
create or replace function public.save_shipment_milestone(
  p_id       uuid,
  p_on       date,
  p_time     time,
  p_location text,
  p_note     text,
  p_hidden   boolean,
  p_label    text default null
) returns public.shipment_milestones
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  m public.shipment_milestones;
  s public.shipments;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into m from public.shipment_milestones where id = p_id for update;
  if not found then
    raise exception 'No such milestone';
  end if;
  select * into s from public.shipments where id = m.shipment_id for update;
  if s.signed_off_at is not null then
    raise exception '% is signed off; an admin has to reopen it before its tracking can change', s.id;
  end if;
  if s.stage = 'cancelled' then
    raise exception '% is cancelled; reopen it before recording its tracking', s.id;
  end if;
  if p_on is null and p_time is not null then
    raise exception 'A time needs its date';
  end if;
  -- Tomorrow is allowed: the day where it happened can be a day ahead of India's.
  if p_on > (now() at time zone 'Asia/Kolkata')::date + 1 then
    raise exception 'That date is in the future. A milestone is recorded once it has happened'
      using hint = 'Put what is expected in the note instead.';
  end if;
  if m.added and p_on is null then
    raise exception 'An update needs its date; delete it instead';
  end if;
  if m.added and p_label is not null and length(btrim(p_label)) < 2 then
    raise exception 'Say what happened';
  end if;

  update public.shipment_milestones
     set label        = case when m.added and p_label is not null then left(btrim(p_label), 120) else label end,
         reached_on   = p_on,
         reached_time = case when p_on is null then null else date_trunc('minute', date '2000-01-01' + p_time)::time end,
         location     = left(btrim(coalesce(p_location, '')), 120),
         note         = left(btrim(coalesce(p_note, '')), 500),
         hidden       = coalesce(p_hidden, false),
         updated_by   = auth.uid(),
         updated_at   = now()
   where id = p_id
   returning * into m;

  if m.stage is not null then
    perform public.milestone_to_step(m.shipment_id, m.stage);
  end if;
  return m;
end $fn$;

revoke execute on function public.save_shipment_milestone(uuid, date, time, text, text, boolean, text) from public, anon;
grant execute on function public.save_shipment_milestone(uuid, date, time, text, text, boolean, text) to authenticated;


-- An update of the desk's own, in its own words.
create or replace function public.add_shipment_update(
  p_shipment_id text,
  p_label       text,
  p_on          date,
  p_time        time,
  p_location    text,
  p_note        text
) returns public.shipment_milestones
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  s     public.shipments;
  m     public.shipment_milestones;
  v_pos int;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'No shipment %', p_shipment_id;
  end if;
  if s.signed_off_at is not null then
    raise exception '% is signed off; an admin has to reopen it before its tracking can change', s.id;
  end if;
  if s.stage = 'cancelled' then
    raise exception '% is cancelled; reopen it before recording its tracking', s.id;
  end if;
  if length(btrim(coalesce(p_label, ''))) < 2 then
    raise exception 'Say what happened';
  end if;
  if p_on is null then
    raise exception 'An update needs its date';
  end if;
  if p_on > (now() at time zone 'Asia/Kolkata')::date + 1 then
    raise exception 'That date is in the future. An update is recorded once it has happened'
      using hint = 'Put what is expected in the note of the milestone it concerns.';
  end if;

  -- After the standing list, which stays under 1000.
  select greatest(1000, coalesce(max(position), 0)) + 1 into v_pos
    from public.shipment_milestones where shipment_id = p_shipment_id;

  insert into public.shipment_milestones
    (shipment_id, code, position, label, reached_on, reached_time, location, note, added, updated_by, updated_at)
  values
    (p_shipment_id, 'update-' || v_pos, v_pos, left(btrim(p_label), 120), p_on, date_trunc('minute', date '2000-01-01' + p_time)::time,
     left(btrim(coalesce(p_location, '')), 120), left(btrim(coalesce(p_note, '')), 500), true, auth.uid(), now())
  returning * into m;
  return m;
end $fn$;

revoke execute on function public.add_shipment_update(text, text, date, time, text, text) from public, anon;
grant execute on function public.add_shipment_update(text, text, date, time, text, text) to authenticated;


create or replace function public.delete_shipment_update(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  m public.shipment_milestones;
  s public.shipments;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into m from public.shipment_milestones where id = p_id for update;
  if not found then
    return;
  end if;
  if not m.added then
    raise exception 'The standing milestones cannot be deleted; hide it from the customer instead';
  end if;
  select * into s from public.shipments where id = m.shipment_id;
  if s.signed_off_at is not null then
    raise exception '% is signed off; an admin has to reopen it before its tracking can change', s.id;
  end if;
  delete from public.shipment_milestones where id = p_id;
end $fn$;

revoke execute on function public.delete_shipment_update(uuid) from public, anon;
grant execute on function public.delete_shipment_update(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- A new booking gets its list, with the booking itself confirmed
--
-- Booked is the one milestone reached on creation: the job exists because
-- somebody booked it, at that moment, as its first workflow step says (066).
-- ---------------------------------------------------------------------------
create or replace function public.seed_shipment_milestones()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_mode text;
  v_dir  text;
  v_now  timestamp := now() at time zone 'Asia/Kolkata';
begin
  select public.checkpoint_mode(coalesce(new.transport_mode, e.transport_mode)), coalesce(new.trade_direction, e.trade_direction)
    into v_mode, v_dir
    from public.enquiries e where e.ref = new.enquiry_ref;
  v_mode := coalesce(v_mode, public.checkpoint_mode(new.transport_mode), 'default');
  v_dir  := coalesce(v_dir, new.trade_direction);

  insert into public.shipment_milestones (shipment_id, code, position, label, stage, hidden)
  select new.id, t.code, t.position, t.label, t.stage,
         t.direction is not null and v_dir is not null and t.direction <> v_dir
    from public.milestone_templates t
   where t.mode = v_mode
  on conflict (shipment_id, code) do nothing;

  update public.shipment_milestones
     set reached_on = v_now::date, reached_time = date_trunc('minute', v_now)::time,
         updated_by = auth.uid(), updated_at = now()
   where shipment_id = new.id and stage = 'booked' and reached_on is null;
  return new;
end $fn$;

revoke execute on function public.seed_shipment_milestones() from public, anon, authenticated;

drop trigger if exists shipments_seed_milestones on public.shipments;
create trigger shipments_seed_milestones
  after insert on public.shipments
  for each row execute function public.seed_shipment_milestones();


-- ---------------------------------------------------------------------------
-- Records that used to tick a milestone on their own now only offer it
-- ---------------------------------------------------------------------------

-- A warehouse receipt (068) ticked "received". The Tracking tab offers it instead.
drop trigger if exists warehouse_receipts_checkpoint on public.warehouse_receipts;
drop function if exists public.receipt_to_checkpoint();

-- Pickup and delivery (079): a follow-up step is still done when every movement
-- is, but a step that marks a stage (delivery; pickup on a road job) is not.
create or replace function public.movements_to_checkpoint(p_shipment_id text, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count   int;
  v_open    int;
  v_last    timestamptz;
  v_planned date;
begin
  select count(*), count(*) filter (where m.actual_at is null), max(m.actual_at), min(m.planned_date)
    into v_count, v_open, v_last, v_planned
    from public.shipment_movements m
   where m.shipment_id = p_shipment_id and m.kind = p_kind;

  -- Done when every one is done, dated by the last.
  update public.shipment_checkpoints c
     set done_at = case when v_count > 0 and v_open = 0 then v_last end,
         done_by = case when v_count > 0 and v_open = 0 then coalesce(c.done_by, auth.uid()) end
   where c.shipment_id = p_shipment_id and c.code = p_kind and c.stage is null
     and c.done_at is distinct from case when v_count > 0 and v_open = 0 then v_last end;

  -- Due by the earliest planned; none planned hands the date back to the rule.
  if v_planned is not null then
    update public.shipment_checkpoints c set due_on = v_planned, due_manual = true
     where c.shipment_id = p_shipment_id and c.code = p_kind;
  else
    update public.shipment_checkpoints c set due_manual = false
     where c.shipment_id = p_shipment_id and c.code = p_kind and c.due_manual;
    perform public.refresh_checkpoint_dues(p_shipment_id);
  end if;
end $fn$;


-- "Move to …" (066) ticked the stage's step. The stage is a milestone now:
-- only cancelling, and reopening a cancelled job, are set here.
create or replace function public.set_shipment_stage(p_id text, p_stage text)
returns public.shipments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row   public.shipments;
  v_label text;
begin
  select * into v_row from public.shipments where id = p_id for update;
  if not found then
    raise exception 'No shipment %', p_id;
  end if;

  if p_stage = 'cancelled' then
    update public.shipments set stage = 'cancelled', updated_at = now()
     where id = p_id returning * into v_row;
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_row.enquiry_ref, 'stage_changed', p_id || ' cancelled',
            jsonb_build_object('shipment_id', p_id, 'to', 'cancelled'), auth.uid());
    return v_row;
  end if;

  if v_row.stage = 'cancelled' then
    update public.shipments set stage = 'booked', updated_at = now() where id = p_id;
    perform public.derive_shipment_stage(p_id);
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_row.enquiry_ref, 'stage_changed', p_id || ' reopened',
            jsonb_build_object('shipment_id', p_id), auth.uid());
    select * into v_row from public.shipments where id = p_id;
    return v_row;
  end if;

  select m.label into v_label from public.shipment_milestones m
   where m.shipment_id = p_id and m.stage = p_stage order by m.position limit 1;
  raise exception 'Record "%" on the job''s Tracking tab: the stage follows the milestones the customer sees',
    coalesce(v_label, public.stage_words(p_stage, v_row.transport_mode))
    using hint = 'Shipment → Tracking → Customer milestones';
end $fn$;


-- A carrier's or a mail's news (072): a person decides, and deciding records
-- the milestone — the one thing the customer's page reads. The feed no longer
-- applies anything itself; without a signed-in person this refuses.
create or replace function public.apply_tracking_event(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ev    public.tracking_events;
  v_ship  public.shipments;
  v_ms    public.shipment_milestones;
  v_stage text;
  v_src   text;
  v_local timestamp;
begin
  if auth.uid() is null then
    raise exception 'A tracking update is applied by a person, not by the feed'
      using hint = 'The customer''s page changes only when somebody records a milestone.';
  end if;

  select * into v_ev from public.tracking_events where id = p_id for update;
  if not found then
    raise exception 'No such tracking update';
  end if;
  if v_ev.status in ('applied', 'dismissed') then
    return v_ev.status;
  end if;

  select * into v_ship from public.shipments where id = v_ev.shipment_id;
  if v_ship.signed_off_at is not null then
    raise exception '% is signed off', v_ship.id using hint = 'Reopen the sign-off first.';
  end if;
  if v_ship.stage = 'cancelled' then
    raise exception '% is cancelled', v_ship.id;
  end if;

  v_src := case v_ev.source
    when 'aerodatabox' then 'AeroDataBox' when 'adsb' then 'adsb.lol'
    when 'hapag_lloyd' then 'Hapag-Lloyd' when 'aisstream' then 'AIS' else 'mail' end;

  -- A changed plan moves the booking's dates, and the due dates follow (066).
  if v_ev.kind in ('schedule_changed', 'rolled_over', 'delayed')
     and (nullif(v_ev.data->>'etd', '') is not null or nullif(v_ev.data->>'eta', '') is not null)
  then
    update public.shipments
       set etd = coalesce(nullif(v_ev.data->>'etd', '')::date, etd),
           eta = coalesce(nullif(v_ev.data->>'eta', '')::date, eta),
           updated_at = now()
     where id = v_ship.id;
    update public.tracking_events
       set status = 'applied', decided_by = auth.uid(), decided_at = now()
     where id = p_id;
    return 'applied';
  end if;

  if v_ev.estimated then
    raise exception 'An estimate cannot record a milestone';
  end if;

  v_stage := public.tracking_stage(v_ev.kind);
  if v_stage is not null then
    select * into v_ms from public.shipment_milestones
     where shipment_id = v_ship.id and stage = v_stage
     order by position limit 1;
  end if;
  if v_ms.id is null then
    update public.tracking_events
       set status = 'info', decided_by = auth.uid(), decided_at = now()
     where id = p_id;
    return 'no_step';
  end if;
  if v_ms.reached_on is not null then
    update public.tracking_events
       set status = 'info', applied_step = v_ms.code, decided_by = auth.uid(), decided_at = now()
     where id = p_id;
    return 'already';
  end if;

  -- When it happened, as India's time, never in the future.
  v_local := least(coalesce(v_ev.occurred_at, now()), now()) at time zone 'Asia/Kolkata';
  perform public.save_shipment_milestone(
    v_ms.id, v_local::date, v_local::time,
    coalesce(nullif(btrim(v_ev.location), ''), nullif(btrim(v_ms.location), ''), ''),
    v_ms.note, v_ms.hidden);

  -- Where it came from, on the step (the desk's record, not the customer's).
  update public.shipment_checkpoints
     set note = btrim(note || case when note = '' then '' else E'\n' end || format('From %s: %s', v_src, v_ev.detail))
   where shipment_id = v_ship.id and stage = v_stage;

  update public.tracking_events
     set status = 'applied', applied_step = v_ms.code, decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  return 'applied';
end $fn$;

revoke execute on function public.apply_tracking_event(uuid) from public, anon, service_role;
grant execute on function public.apply_tracking_event(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The customer's page
--
-- The booking's own details, the planned route, the boxes, and the milestones
-- the desk has not hidden. Nothing from a feed, no internal step, no date a
-- rule worked out, no money, no people.
-- ---------------------------------------------------------------------------
create or replace function public.shipment_tracking(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_link public.shipment_track_links;
  s      public.shipments;
  v_cust text;
begin
  select * into v_link from public.shipment_track_links where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  if v_link.revoked then
    return jsonb_build_object('state', 'revoked');
  end if;

  select * into s from public.shipments where id = v_link.shipment_id;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  select coalesce(nullif(c.company, ''), c.name) into v_cust from public.customers c where c.id = s.customer_id;

  update public.shipment_track_links
     set opened_at = coalesce(opened_at, now()),
         last_opened_at = now()
   where id = v_link.id;

  return jsonb_build_object(
    'state',             'open',
    'reference',         s.enquiry_ref,
    'customer',          v_cust,
    'mode',              s.transport_mode,
    'cancelled',         s.stage = 'cancelled',
    'origin',            s.origin,
    'destination',       s.destination,
    'port_of_loading',   s.port_of_loading,
    'port_of_discharge', s.port_of_discharge,
    'carrier',           s.carrier,
    'flight_number',     s.flight_number,
    'vessel',            s.vessel,
    'voyage',            s.voyage,
    'etd',               coalesce(s.etd, s.sailing_date),
    'etd_time',          s.etd_time,
    'eta',               s.eta,
    'eta_time',          s.eta_time,
    'house_bill',        s.bl_number,
    'cargo',             s.cargo,
    'pieces',            s.piece_count,
    'gross_weight_kg',   s.gross_weight_kg,
    'volume_cbm',        s.volume_cbm,
    'updated_at', (
      select max(m.updated_at) from public.shipment_milestones m
       where m.shipment_id = s.id and not m.hidden),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'label',        m.label,
               'stage',        m.stage,
               'position',     m.position,
               'added',        m.added,
               'reached_on',   m.reached_on,
               'reached_time', left(m.reached_time::text, 5),
               'location',     nullif(m.location, ''),
               'note',         nullif(m.note, ''))
             order by m.position)
        from public.shipment_milestones m
       where m.shipment_id = s.id and not m.hidden), '[]'::jsonb),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'move', l.move,
               'from', l.from_place,
               'to', l.to_place,
               'etd', l.etd,
               'eta', l.eta,
               'carrier', l.carrier,
               'voyage_flight', l.voyage_flight)
             order by l.position)
        from public.shipment_routings l
       where l.shipment_id = s.id and l.status <> 'cancelled'), '[]'::jsonb),
    'containers', coalesce((
      select jsonb_agg(jsonb_build_object('number', c.container_no, 'type', c.size_type) order by c.position)
        from public.shipment_containers c
       where c.shipment_id = s.id and nullif(c.container_no, '') is not null), '[]'::jsonb)
  );
end $fn$;

grant execute on function public.shipment_tracking(text) to anon, authenticated;

drop function if exists public.shipment_track_points(text);
drop function if exists public.shipment_customs_public(text);


-- ---------------------------------------------------------------------------
-- The jobs already booked: their lists, and what their steps already say
-- ---------------------------------------------------------------------------
insert into public.shipment_milestones (shipment_id, code, position, label, stage, hidden)
select s.id, t.code, t.position, t.label, t.stage,
       t.direction is not null and coalesce(s.trade_direction, e.trade_direction) is not null
         and t.direction <> coalesce(s.trade_direction, e.trade_direction)
  from public.shipments s
  left join public.enquiries e on e.ref = s.enquiry_ref
  join public.milestone_templates t
    on t.mode = public.checkpoint_mode(coalesce(s.transport_mode, e.transport_mode))
on conflict (shipment_id, code) do nothing;

update public.shipment_milestones m
   set reached_on   = (c.done_at at time zone 'Asia/Kolkata')::date,
       reached_time = date_trunc('minute', c.done_at at time zone 'Asia/Kolkata')::time,
       updated_by   = c.done_by,
       updated_at   = c.done_at
  from public.shipment_checkpoints c
 where c.shipment_id = m.shipment_id and c.stage = m.stage
   and c.done_at is not null and m.reached_on is null;


-- Live on every open job file (084).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shipment_milestones'
  ) then
    alter publication supabase_realtime add table public.shipment_milestones;
  end if;
end $$;
