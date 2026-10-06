-- ---------------------------------------------------------------------------
-- 135: A cross trade keeps the origin's steps (134, put right).
--
-- 134 marked the origin's steps as the export's, so a cross-trade job — the
-- cargo moving between two other countries, the desk arranging it — would
-- have lost them along with export customs. A cross trade is worked as an
-- export without India's customs: the pickup, the stuffing, the B/L and the
-- pre-alert stay; the LEO and the OOC are nobody's here. On the customer's
-- list, only the two customs milestones are hidden.
--
-- One rule for each, used everywhere a list is made.
-- ---------------------------------------------------------------------------

/** Whether a workflow step belongs on a job going this way. */
create or replace function public.step_for_direction(p_step_direction text, p_code text, p_dir text)
returns boolean
language sql
immutable
as $fn$
  select p_step_direction is null
      or p_step_direction = coalesce(p_dir, 'export')
      or (p_dir = 'cross_trade' and p_step_direction = 'export' and p_code <> 'customs_export')
$fn$;

/** Whether a customer milestone is hidden on a job going this way (the desk can still show it). */
create or replace function public.milestone_hidden_for(p_milestone_direction text, p_code text, p_dir text)
returns boolean
language sql
immutable
as $fn$
  select p_milestone_direction is not null and p_dir is not null
     and case when p_dir = 'cross_trade' then p_code in ('export_customs', 'import_customs')
              else p_milestone_direction <> p_dir end
$fn$;


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
  v_dir  := coalesce(v_dir, new.trade_direction);

  -- The first step is done on creation: a booking exists because the order was confirmed.
  select min(position) into v_first from public.checkpoint_templates where mode = v_mode and active;

  insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule, done_at)
  select new.id, t.position, t.code, t.label, t.stage, t.due_rule,
         case when t.position = v_first then now() else null end
    from public.checkpoint_templates t
   where t.mode = v_mode and t.active
     and public.step_for_direction(t.direction, t.code, v_dir)
   order by t.position
  on conflict (shipment_id, code) do nothing;

  perform public.refresh_checkpoint_dues(new.id);
  return new;
end $fn$;


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
  select public.checkpoint_mode(coalesce(s.transport_mode, e.transport_mode)), coalesce(s.trade_direction, e.trade_direction)
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
     and not public.step_for_direction(t.direction, t.code, v_dir);

  -- This way's come, in their places.
  insert into public.shipment_checkpoints (shipment_id, position, code, label, stage, due_rule)
  select p_shipment_id, t.position, t.code, t.label, t.stage, t.due_rule
    from public.checkpoint_templates t
   where t.mode = v_mode and t.active and public.step_for_direction(t.direction, t.code, v_dir)
  on conflict (shipment_id, code) do nothing;

  perform public.refresh_checkpoint_dues(p_shipment_id);
  perform public.derive_shipment_stage(p_shipment_id);

  -- The customer's: by the same rule — not one reached, nor the desk's own.
  update public.shipment_milestones m
     set hidden = public.milestone_hidden_for(t.direction, t.code, v_dir)
    from public.milestone_templates t
   where m.shipment_id = p_shipment_id and not m.added and m.reached_on is null
     and t.mode = v_mode and t.code = m.code and t.direction is not null
     and m.hidden is distinct from public.milestone_hidden_for(t.direction, t.code, v_dir);
end $fn$;

revoke execute on function public.apply_direction_steps(text) from public, anon, authenticated;


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
         public.milestone_hidden_for(t.direction, t.code, v_dir)
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

-- Cross-trade jobs under way: the origin's steps back.
do $$
declare r record;
begin
  for r in select id from public.shipments where trade_direction = 'cross_trade' and signed_off_at is null and stage <> 'cancelled' loop
    perform public.apply_direction_steps(r.id);
  end loop;
end $$;
