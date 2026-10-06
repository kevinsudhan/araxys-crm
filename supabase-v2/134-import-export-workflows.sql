-- ---------------------------------------------------------------------------
-- 134: An import has its own workflow, not an export's.
--
-- WHAT WAS WRONG
--
-- The workflow lists (059, 066) were written for exports: empty container
-- pickup, stuffing, VGM, gate-in, the SI, the B/L. Only the customs step and
-- the pre-alert followed the job's trade direction (077, 078). On an import
-- — Kaohsiung to Chennai — those are the origin agent's work, and the desk's
-- own (the agent's booking, the documents arriving, the arrival notice, the
-- delivery order, the empty box going back) were nowhere (the user, 6 Oct:
-- "things will change between import and export").
--
-- THE LISTS
--
--   both     order confirmed · sailed / departed · arrived · delivered
--   export   as before: pickup, warehouse or CFS, empty pickup, stuffing,
--            VGM, gate-in, documents, SI, B/L or HAWB, LEO, pre-alert
--   import   booking with the origin agent · pre-alert and documents
--            received · arrival notice to the consignee · (LCL) destuffed at
--            the CFS · import customs cleared (OOC) · delivery order issued
--            · (FCL) empty container returned
--
-- A job with no direction set works as an export, as every job did.
--
-- CHANGING IT
--
-- The direction is chosen on the shipment page; it is the job's fact, kept on
-- the enquiry, which the shipment follows (065). When it changes, the steps
-- for the other way that are not done go, the steps for this way come, their
-- dates are worked out, and the customer's milestones for the other way are
-- hidden. A step already done stays: it happened.
--
-- The arrival notice sent (126) and the delivery order issued (088) tick
-- their steps, as the LEO and OOC dates tick customs (077).
-- ---------------------------------------------------------------------------

-- ---- the export side's own steps ----
update public.checkpoint_templates t
   set direction = 'export'
  from (values
    ('air', 'pickup'), ('air', 'warehouse'), ('air', 'documents'), ('air', 'origin_customer'), ('air', 'hawb_draft'), ('air', 'hawb_confirm'), ('air', 'loading'),
    ('sea_lcl', 'pickup'), ('sea_lcl', 'cfs'), ('sea_lcl', 'documents'), ('sea_lcl', 'si_cutoff'), ('sea_lcl', 'bl_draft'), ('sea_lcl', 'bl_confirm'),
    ('sea_fcl', 'empty_pickup'), ('sea_fcl', 'stuffing'), ('sea_fcl', 'vgm'), ('sea_fcl', 'gate_in'), ('sea_fcl', 'si_cutoff'), ('sea_fcl', 'bl_confirm')
  ) as x(mode, code)
 where t.mode = x.mode and t.code = x.code;

-- ---- the import side's ----
insert into public.checkpoint_templates (mode, position, code, label, stage, direction, due_rule) values
  ('air',     20,  'imp_origin_booking', 'Booking with the origin agent',     null,      'import', '[{"anchor":"booked","days":1}]'),
  ('air',     80,  'imp_departed',       'Flight departed',                   'sailed',  'import', '[{"anchor":"etd","days":0}]'),
  ('air',     86,  'imp_documents',      'Pre-alert and documents received',  null,      'import', '[{"anchor":"etd","days":1},{"anchor":"eta","days":-1}]'),
  ('air',     88,  'imp_arrival_notice', 'Arrival notice to the consignee',   null,      'import', '[{"anchor":"eta","days":-1}]'),
  ('air',     97,  'imp_do',             'Delivery order issued',             null,      'import', '[{"anchor":"eta","days":1}]'),

  ('sea_lcl', 20,  'imp_origin_booking', 'Booking with the origin agent',     null,      'import', '[{"anchor":"booked","days":1}]'),
  ('sea_lcl', 86,  'imp_documents',      'Pre-alert and documents received',  null,      'import', '[{"anchor":"etd","days":2},{"anchor":"eta","days":-5}]'),
  ('sea_lcl', 88,  'imp_arrival_notice', 'Arrival notice to the consignee',   null,      'import', '[{"anchor":"eta","days":-3}]'),
  ('sea_lcl', 92,  'imp_destuffed',      'Destuffed at the CFS',              null,      'import', '[{"anchor":"eta","days":2}]'),
  ('sea_lcl', 97,  'imp_do',             'Delivery order issued',             null,      'import', '[{"anchor":"eta","days":3}]'),

  ('sea_fcl', 20,  'imp_origin_booking', 'Booking with the origin agent',     null,      'import', '[{"anchor":"booked","days":1}]'),
  ('sea_fcl', 86,  'imp_documents',      'Pre-alert and documents received',  null,      'import', '[{"anchor":"etd","days":2},{"anchor":"eta","days":-5}]'),
  ('sea_fcl', 88,  'imp_arrival_notice', 'Arrival notice to the consignee',   null,      'import', '[{"anchor":"eta","days":-3}]'),
  ('sea_fcl', 97,  'imp_do',             'Delivery order issued',             null,      'import', '[{"anchor":"eta","days":2}]'),
  ('sea_fcl', 105, 'imp_empty_return',   'Empty container returned',          null,      'import', '[{"anchor":"eta","days":7}]')
on conflict (mode, code) do update
  set position = excluded.position, label = excluded.label, stage = excluded.stage, direction = excluded.direction, due_rule = excluded.due_rule, active = true;

-- ---- the customer's milestones: the origin's own on an export only ----
update public.milestone_templates t
   set direction = 'export'
  from (values ('air', 'received'), ('sea_lcl', 'received'), ('sea_fcl', 'empty_picked'), ('sea_fcl', 'stuffed'), ('sea_fcl', 'gated_in')) as x(mode, code)
 where t.mode = x.mode and t.code = x.code;


-- ---------------------------------------------------------------------------
-- Seeding a new booking: the steps for the way it goes (an export when unsaid)
-- ---------------------------------------------------------------------------
create or replace function public.seed_shipment_checkpoints()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mode  text;
  v_dir   text;
  v_first int;
begin
  -- The shipment's own mode first: 065 has already copied it from the enquiry.
  select public.checkpoint_mode(coalesce(new.transport_mode, e.transport_mode)), coalesce(new.trade_direction, e.trade_direction)
    into v_mode, v_dir
    from public.enquiries e where e.ref = new.enquiry_ref;
  v_mode := coalesce(v_mode, 'default');
  v_dir  := coalesce(v_dir, new.trade_direction, 'export');

  -- The first step is done on creation: a booking exists because the order was confirmed.
  select min(position) into v_first from public.checkpoint_templates where mode = v_mode and active;

  insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule, done_at)
  select new.id, t.position, t.code, t.label, t.stage, t.due_rule,
         case when t.position = v_first then now() else null end
    from public.checkpoint_templates t
   where t.mode = v_mode and t.active
     and (t.direction is null or t.direction = v_dir)
   order by t.position
  on conflict (shipment_id, code) do nothing;

  perform public.refresh_checkpoint_dues(new.id);
  return new;
end $fn$;


-- ---------------------------------------------------------------------------
-- A job's lists, for the way it goes now
-- ---------------------------------------------------------------------------
create or replace function public.apply_direction_steps(p_shipment_id text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mode text;
  v_dir  text;
begin
  select public.checkpoint_mode(coalesce(s.transport_mode, e.transport_mode)), coalesce(s.trade_direction, e.trade_direction, 'export')
    into v_mode, v_dir
    from public.shipments s left join public.enquiries e on e.ref = s.enquiry_ref
   where s.id = p_shipment_id;
  if not found then
    return;
  end if;

  -- The other way's steps that were not done go; done ones stay, they happened.
  delete from public.shipment_checkpoints c
   using public.checkpoint_templates t
   where c.shipment_id = p_shipment_id and c.done_at is null
     and t.mode = v_mode and t.code = c.code
     and t.direction is not null and t.direction <> v_dir;

  -- This way's come, in their places.
  insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule)
  select p_shipment_id, t.position, t.code, t.label, t.stage, t.due_rule
    from public.checkpoint_templates t
   where t.mode = v_mode and t.active and (t.direction is null or t.direction = v_dir)
  on conflict (shipment_id, code) do nothing;

  perform public.refresh_checkpoint_dues(p_shipment_id);
  perform public.derive_shipment_stage(p_shipment_id);

  -- The customer's: the other way's hidden, this way's shown — not one reached, nor the desk's own.
  update public.shipment_milestones m
     set hidden = (t.direction <> v_dir)
    from public.milestone_templates t
   where m.shipment_id = p_shipment_id and not m.added and m.reached_on is null
     and t.mode = v_mode and t.code = m.code and t.direction is not null
     and m.hidden is distinct from (t.direction <> v_dir);
end $fn$;

revoke execute on function public.apply_direction_steps(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- When the direction changes, and when the arrival notice goes
-- ---------------------------------------------------------------------------
create or replace function public.shipment_direction_steps()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- A signed-off job is closed as it was worked.
  if new.signed_off_at is not null then
    return null;
  end if;
  if new.trade_direction is distinct from old.trade_direction then
    perform public.apply_direction_steps(new.id);
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    select new.enquiry_ref, 'direction_changed',
           format('Now %s: the workflow follows', coalesce(replace(new.trade_direction, '_', ' '), 'without a direction')),
           jsonb_build_object('shipment_id', new.id, 'from', old.trade_direction, 'to', new.trade_direction), auth.uid()
     where new.enquiry_ref is not null;
  end if;
  if new.arrival_notice_sent_at is not null and old.arrival_notice_sent_at is null then
    update public.shipment_checkpoints
       set done_at = new.arrival_notice_sent_at, done_by = auth.uid()
     where shipment_id = new.id and code = 'imp_arrival_notice' and done_at is null;
  end if;
  return null;
end $fn$;

drop trigger if exists shipments_direction_steps on public.shipments;
create trigger shipments_direction_steps
  after update of trade_direction, arrival_notice_sent_at on public.shipments
  for each row execute function public.shipment_direction_steps();

-- Our delivery order to the consignee, on an import.
create or replace function public.received_hbl_do_step()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.do_issued_on is not null and (tg_op = 'INSERT' or old.do_issued_on is null) then
    update public.shipment_checkpoints
       set done_at = (new.do_issued_on::timestamp + interval '12 hours') at time zone 'Asia/Kolkata', done_by = auth.uid()
     where shipment_id = new.shipment_id and code = 'imp_do' and done_at is null;
  end if;
  return null;
end $fn$;

drop trigger if exists received_house_bills_do_step on public.received_house_bills;
create trigger received_house_bills_do_step
  after insert or update of do_issued_on on public.received_house_bills
  for each row execute function public.received_hbl_do_step();


-- ---------------------------------------------------------------------------
-- Imports under way get the import list. An export's list is as it was, and a
-- milestone the desk hid on one stays hidden.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.shipments where trade_direction = 'import' and signed_off_at is null and stage <> 'cancelled' loop
    perform public.apply_direction_steps(r.id);
  end loop;
end $$;
