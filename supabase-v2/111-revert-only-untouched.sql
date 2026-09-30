-- 111: A booking is sent back to its enquiry only while nothing has happened
-- on it (Shipments sweep, 30 Sep).
--
-- revert_shipment DELETES the shipment. Every table hanging off it cascades —
-- milestones, warehouse receipts, pickups, customs, house bills issued with
-- their numbers — and the vendor bills recorded against it were set to no
-- job at all (bills ON DELETE SET NULL), so its costs quietly left it. Only an
-- invoice stopped it, and the page offered it on every job, delivered and
-- signed-off ones included.
--
-- Now it is refused once any of that exists: signed off, cancelled, past
-- booked, a bill recorded, a house bill or HAWB issued, cargo received into
-- the warehouse, or a pickup or delivery done. That job is cancelled instead
-- (cancel_shipment, 103), which keeps its records.

create or replace function public.revert_shipment(p_id text, p_reason text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ship     public.shipments;
  v_invoices int;
  v_bills    int;
  v_why      text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_ship from public.shipments where id = p_id for update;
  if not found then
    raise exception 'no shipment %', p_id;
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why the booking is being sent back';
  end if;

  select count(*) into v_invoices from public.invoices where shipment_id = p_id;
  if v_invoices > 0 then
    raise exception 'this booking has % invoice(s) against it and cannot be reverted; raise a credit note instead', v_invoices;
  end if;

  select count(*) into v_bills from public.bills where shipment_id = p_id;

  v_why := case
    when v_ship.signed_off_at is not null then 'it is signed off'
    when v_ship.stage = 'cancelled' or v_ship.cancelled_at is not null then 'it is cancelled'
    when v_ship.stage <> 'booked' then 'the cargo has already moved (' || v_ship.stage || ')'
    when v_bills > 0 then v_bills || ' vendor bill(s) are recorded against it'
    when exists (select 1 from public.house_bills h where h.shipment_id = p_id and (h.issued_at is not null or h.status = 'issued'))
      then 'its house bill of lading has been issued'
    when exists (select 1 from public.house_airwaybills a where a.shipment_id = p_id and coalesce(a.original_issued, false))
      then 'its HAWB has been issued'
    when exists (select 1 from public.warehouse_receipts w where w.shipment_id = p_id)
      then 'cargo has been received into the warehouse'
    when exists (select 1 from public.shipment_movements m where m.shipment_id = p_id and m.actual_at is not null)
      then 'a pickup or delivery has been done'
    else null
  end;
  if v_why is not null then
    raise exception '% cannot be sent back to the enquiry: %.', p_id, v_why
      using hint = 'Cancel the shipment instead; that keeps its records.';
  end if;

  delete from public.shipment_checkpoints where shipment_id = p_id;
  delete from public.shipments where id = p_id;

  update public.enquiries
     set status = 'accepted', updated_at = now()
   where ref = v_ship.enquiry_ref;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ship.enquiry_ref,
    'booking_reverted',
    'Booking ' || v_ship.id || ' sent back to the enquiry: ' || btrim(p_reason),
    jsonb_build_object('shipment_id', v_ship.id),
    auth.uid()
  );

  return v_ship.enquiry_ref;
end $$;

revoke execute on function public.revert_shipment(text, text) from public, anon;
grant execute on function public.revert_shipment(text, text) to authenticated;
