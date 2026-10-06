-- ---------------------------------------------------------------------------
-- The whole life of one dummy shipment, checked end to end (7 Oct 2026).
--
-- Run it with `node supabase-v2/e2e.mjs`, not by hand: that script puts the
-- numbering sequences back afterwards (a rolled-back transaction still uses up
-- job and receipt numbers — see HANDOFF).
--
-- Mail into the queue → enquiry taken on → details, dimensions, parties →
-- partner asked, partner's reply, original rate → quotation drafted, approved
-- by the admin, sent → the customer opens and accepts it by its link →
-- booked → job records (routings, customs, pickup, warehouse) → workflow steps
-- and tracking milestones → tracking link read by the customer → pre-alert →
-- console → house B/L numbered, its draft approved by the shipper by link →
-- invoice from the quotation, receipt, carrier bill and payment, credit note,
-- debit note to the agent → the final bill agrees → sign-off refused while
-- not delivered, then the job worked to the end and signed off → a signed-off
-- job refuses changes → team oversight (refused to an employee, the actions
-- credited for the admin) → reopen → side paths (a phoned-in enquiry put back,
-- a queue item set aside and back, a job cancelled and reopened).
--
-- Every step as the person who does it in the app — the employee, the admin,
-- or the customer by link (anon) — through the same functions and table writes
-- the app makes, with its checks. One transaction, rolled back by the RESULTS
-- exception at the end: nothing it does is kept. It uses the employee and admin
-- accounts below; change them if those accounts go.
-- ---------------------------------------------------------------------------
do $e2e$
declare
  v_emp   uuid := '3ccf0ab6-70ee-4640-a60c-967eb283b6f2';
  v_adm   uuid := '2d64e23a-2e77-41b3-a9c7-163905cb9690';
  v_tag   text := 'E2E' || to_char(clock_timestamp(), 'HH24MISSMS');
  log     text[] := '{}';
  n_ok    int := 0;
  n_bad   int := 0;
  v_cust  text;
  v_intake uuid;
  v_ref   text;
  v_enq   public.enquiries;
  v_carrier uuid;
  v_agent uuid;
  v_pq    uuid;
  v_quote uuid;
  v_q     public.quotes;
  v_token text;
  v_json  jsonb;
  v_ship  text;
  v_s     public.shipments;
  v_console uuid;
  v_inv   uuid;
  v_note  uuid;
  v_anote uuid;
  v_pay   uuid;
  v_pay2  uuid;
  v_bill  uuid;
  v_i     public.invoices;
  v_n     numeric;
  v_n2    numeric;
  v_n3    numeric;
  v_n4    numeric;
  v_txt   text;
  v_cnt   int;
  v_cnt2  int;
  v_ref2  text;
  v_intake2 uuid;
begin
  -- ===================== as the employee =====================
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    v_cust := (public.create_customer('E2E Tester', v_tag || ' Exports Pvt Ltd', lower(v_tag) || '@example.invalid', '+91 90000 00001')).id;
    if v_cust is null then raise exception 'no id'; end if;
    log := log || format('PASS 01 customer created (%s)', v_cust); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 01 create customer: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_intake := (public.capture_message_as_intake(
      lower(v_tag) || '-msg', lower(v_tag) || '-conv', 'Rate request: Chennai to Jebel Ali LCL ' || v_tag,
      'E2E Tester', lower(v_tag) || '@example.invalid', 'Please quote 2 pallets machinery parts', now(),
      'email', v_tag || ' Exports Pvt Ltd', null, 'Chennai', 'Jebel Ali', 'Machinery parts')).id;
    if v_intake is null then raise exception 'no intake'; end if;
    log := log || text 'PASS 02 mail captured into the queue'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 02 capture mail to queue: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_enq := public.promote_intake(v_intake, v_cust, true, null);
    v_ref := v_enq.ref;
    if v_enq.assigned_to is distinct from v_emp then raise exception 'not taken on by the employee (%)', v_enq.assigned_to; end if;
    select count(*) into v_cnt from public.enquiry_events where enquiry_ref = v_ref and kind in ('promoted_from_intake', 'assigned');
    if v_cnt < 2 then raise exception 'timeline missing from-queue/taken-on (%)', v_cnt; end if;
    log := log || format('PASS 03 queue item turned into enquiry %s and taken on, timeline written', v_ref); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 03 promote queue item: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    update public.enquiries
       set transport_mode = 'sea_lcl', trade_direction = 'export', incoterm = 'FOB', cargo = 'Machinery parts',
           ready_date = current_date + 5, package_count = 2, package_type = 'Pallets', freight_terms = 'prepaid',
           consignee_name = 'E2E Gulf Trading LLC', consignee_country = 'AE', updated_at = now()
     where ref = v_ref;
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 then raise exception 'update touched % rows', v_cnt; end if;
    log := log || text 'PASS 04 enquiry details edited (mode, direction, incoterm, cargo, consignee)'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 04 edit enquiry details: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    insert into public.enquiry_dimensions (enquiry_ref, position, pieces, length, width, height, weight_per_piece)
    values (v_ref, 1, 2, 120, 100, 110, 450);
    select volume_cbm, gross_weight_kg into v_n, v_n2 from public.enquiries where ref = v_ref;
    if coalesce(v_n, 0) <= 0 or coalesce(v_n2, 0) <= 0 then raise exception 'cargo figures not worked out (cbm %, kg %)', v_n, v_n2; end if;
    log := log || format('PASS 05 dimension line added; enquiry worked out %s cbm, %s kg', v_n, v_n2); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 05 dimension line: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    insert into public.partners (name, organisation, role, emails, country) values ('E2E Line Desk', v_tag || ' Shipping Line', 'carrier', array['line@example.invalid'], 'IN') returning id into v_carrier;
    insert into public.partners (name, organisation, role, emails, country) values ('E2E Agent', v_tag || ' Gulf Agency', 'overseas_agent', array['agent@example.invalid'], 'AE') returning id into v_agent;
    insert into public.enquiry_parties (enquiry_ref, role, name, organisation, emails) values (v_ref, 'overseas_agent', 'E2E Agent', v_tag || ' Gulf Agency', array['agent@example.invalid']);
    log := log || text 'PASS 06 partners added to the book; party added to the enquiry'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 06 partners / enquiry party: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    perform public.assign_partner(v_ref, v_agent, 'overseas_agent', 'Destination charges please');
    select count(*) into v_cnt from public.partner_assignments where enquiry_ref = v_ref and partner_id = v_agent;
    if v_cnt <> 1 then raise exception 'assignment rows %', v_cnt; end if;
    log := log || text 'PASS 07 partner asked for rates on the enquiry'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 07 assign partner: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_pq := (public.record_rfq_sent(v_ref, gen_random_uuid(), 'agent@example.invalid', v_tag || ' Gulf Agency', v_agent,
             'Rate request ' || v_ref, lower(v_tag) || '-rfq-conv', lower(v_tag) || '-rfq-msg')).id;
    perform public.record_rfq_reply(v_pq, lower(v_tag) || '-rfq-reply', now(), 950, 'USD', 18, current_date + 15);
    select status into v_txt from public.partner_quotes where id = v_pq;
    if v_txt is distinct from 'quoted' then raise exception 'partner quote status %', v_txt; end if;
    log := log || text 'PASS 08 rate request recorded and the partner''s reply (USD 950, 18 days) recorded as quoted'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 08 rate request / reply: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    insert into public.enquiry_buy_rates (enquiry_ref, partner_id, partner_label, pasted_text, lines, roe, total_inr, created_by)
    values (v_ref, v_agent, v_tag || ' Gulf Agency', 'O/F USD 950',
            '[{"section":"freight","description":"Ocean freight","currency":"USD","unit":"Shipment","quantity":1,"rate":950}]'::jsonb, '{"USD":88}'::jsonb, 83600, v_emp);
    log := log || text 'PASS 09 partner''s original rate kept against the enquiry'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 09 original rate: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    insert into public.quotes (enquiry_ref, version, amount_inr, basis, valid_until, currency, fx_rate, quote_type, multi_carrier, status, created_by)
    values (v_ref, 1, 0, 'per_shipment', current_date + 14, 'INR', 1, 'standard', false, 'draft', v_emp) returning id into v_quote;
    insert into public.quote_lines (quote_id, position, description, quantity, unit, rate, currency, fx_rate, section, sac_code, cost_currency, cost_fx_rate, cost_rate)
    values (v_quote, 1, 'Ocean freight Chennai - Jebel Ali', 1, 'Shipment', 95000, 'INR', 1, 'freight', '996521', 'INR', 1, 83600),
           (v_quote, 2, 'Documentation', 1, 'Set', 3500, 'INR', 1, 'ex_works', '996719', 'INR', 1, 0);
    select * into v_q from public.quotes where id = v_quote;
    if v_q.amount_inr <> 98500 then raise exception 'quote total %, expected 98500', v_q.amount_inr; end if;
    log := log || format('PASS 10 quotation v1 drafted with 2 charges; total worked out ₹%s', v_q.amount_inr); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 10 draft quotation: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    perform public.submit_quote_for_approval(v_quote);
    select approval_status into v_txt from public.quotes where id = v_quote;
    if v_txt not in ('pending', 'approved') then raise exception 'approval status %', v_txt; end if;
    log := log || format('PASS 11 quotation submitted for approval (now %s)', v_txt); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 11 submit for approval: ' || sqlerrm); n_bad := n_bad + 1; end;

  -- the admin approves
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    if v_quote is null then raise exception 'no quotation to approve'; end if;
    select approval_status into v_txt from public.quotes where id = v_quote;
    if v_txt = 'pending' then perform public.decide_quote(v_quote, true, 'Fine to send'); end if;
    select approval_status into v_txt from public.quotes where id = v_quote;
    if v_txt <> 'approved' then raise exception 'approval status %', v_txt; end if;
    log := log || text 'PASS 12 admin approved the quotation'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 12 admin approval: ' || sqlerrm); n_bad := n_bad + 1; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.quotes set status = 'sent', sent_at = now() where id = v_quote;
    update public.enquiries set status = 'quoted', updated_at = now() where ref = v_ref;
    insert into public.enquiry_events (enquiry_ref, kind, summary, actor) values (v_ref, 'quote_sent', 'Quoted ₹98,500', v_emp);
    v_token := (public.issue_quote_link(v_quote)).token;
    if v_token is null or length(v_token) < 10 then raise exception 'no link token (%)', v_token; end if;
    log := log || text 'PASS 13 quotation marked sent and its customer link issued'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 13 send quotation / link: ' || sqlerrm); n_bad := n_bad + 1; end;

  -- ===================== the customer, by the link =====================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    v_json := public.quote_by_token(v_token);
    if v_json is null or coalesce(v_json ->> 'state', '') in ('unknown', 'revoked', 'expired') then raise exception 'quotation not readable by link: %', left(v_json::text, 200); end if;
    v_json := public.accept_quote_by_token(v_token, 'E2E Buyer', 'Go ahead');
    if (v_json ->> 'ok')::boolean is not true then raise exception 'accept said %', v_json; end if;
    log := log || text 'PASS 14 customer opened the quotation by its link and accepted it'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 14 customer accepts by link: ' || sqlerrm); n_bad := n_bad + 1; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    v_s := public.promote_enquiry(v_ref);
    v_ship := v_s.id;
    select count(*) into v_cnt from public.shipment_checkpoints where shipment_id = v_ship;
    select * into v_s from public.shipments where id = v_ship;
    if v_cnt = 0 then raise exception 'no workflow steps seeded'; end if;
    log := log || format('PASS 15 booked: shipment %s, stage %s, %s workflow steps, mode %s, %s', v_ship, v_s.stage, v_cnt, coalesce(v_s.transport_mode, '—'), coalesce(v_s.trade_direction, '—')); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 15 book (promote enquiry): ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    update public.shipments
       set shipper_name = v_tag || ' Exports Pvt Ltd', shipper_address = 'Guindy, Chennai',
           consignee_name = 'E2E Gulf Trading LLC', consignee_address = 'Jebel Ali Free Zone, Dubai', consignee_country = 'AE',
           port_of_loading = 'Chennai', port_of_discharge = 'Jebel Ali', etd = current_date + 10, eta = current_date + 28,
           package_count = 2, package_type = 'Pallets', gross_weight_kg = 900, volume_cbm = 2.64, updated_at = now()
     where id = v_ship;
    get diagnostics v_cnt = row_count;
    if v_cnt <> 1 then raise exception 'updated % rows', v_cnt; end if;
    log := log || text 'PASS 16 shipment parties, ports, dates and cargo saved'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 16 shipment details: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    insert into public.shipment_routings (shipment_id, position, move, from_place, to_place, etd, carrier, status)
    values (v_ship, 1, 'road', 'Guindy', 'Chennai CFS', current_date + 3, 'E2E Transport', 'planned'),
           (v_ship, 2, 'sea', 'Chennai', 'Jebel Ali', current_date + 10, v_tag || ' Shipping Line', 'planned');
    insert into public.shipment_customs (shipment_id, side, handled_by, broker_name, port_code, sb_number, sb_date)
    values (v_ship, 'export', 'broker', 'E2E CHA', 'INMAA1', '1234567', current_date);
    insert into public.shipment_movements (shipment_id, kind, planned_date, transporter, vehicle_number, pieces, actual_at, condition)
    values (v_ship, 'pickup', current_date, 'E2E Transport', 'TN01AB1234', 2, now(), 'good');
    perform public.movements_to_checkpoint(v_ship, 'pickup');
    insert into public.warehouse_receipts (shipment_id, received_at, pieces, gross_weight_kg, volume_cbm, condition, received_by)
    values (v_ship, now(), 2, 900, 2.64, 'good', v_emp);
    select count(*) into v_cnt from public.warehouse_receipts where shipment_id = v_ship and receipt_no is not null;
    if v_cnt <> 1 then raise exception 'warehouse receipt not numbered'; end if;
    log := log || text 'PASS 17 routings, export customs (shipping bill), pickup and warehouse receipt recorded'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 17 job records: ' || sqlerrm); n_bad := n_bad + 1; end;

  -- as the desk does it: an ordinary step pressed; a milestone step only from the Tracking tab
  begin
    select count(*) filter (where done_at is not null) into v_cnt from public.shipment_checkpoints where shipment_id = v_ship;
    update public.shipment_checkpoints set done_at = now(), done_by = v_emp
     where id = (select id from public.shipment_checkpoints where shipment_id = v_ship and done_at is null and stage is null order by position limit 1);
    get diagnostics v_cnt2 = row_count;
    if v_cnt2 <> 1 then raise exception 'no ordinary step to tick'; end if;
    begin
      update public.shipment_checkpoints set done_at = now(), done_by = v_emp
       where id = (select id from public.shipment_checkpoints where shipment_id = v_ship and done_at is null and stage is not null order by position limit 1);
      raise exception 'a milestone step was pressed directly';
    exception when others then
      if sqlerrm not like '%is a tracking milestone%' then raise; end if;
    end;
    perform public.save_shipment_milestone(
      (select id from public.shipment_milestones where shipment_id = v_ship and stage is not null and reached_on is null order by position limit 1),
      current_date, null, 'Chennai CFS', 'E2E', false);
    select stage into v_txt from public.shipments where id = v_ship;
    select count(*) filter (where done_at is not null) into v_cnt2 from public.shipment_checkpoints where shipment_id = v_ship;
    if v_txt = 'booked' then raise exception 'stage did not move from booked'; end if;
    log := log || format('PASS 18 a step ticked; a milestone step refused when pressed and recorded on Tracking instead; steps done %s → %s, stage now %s', v_cnt, v_cnt2, v_txt); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 18 workflow steps / milestones: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    perform public.add_shipment_update(v_ship, 'Cargo handed to the line', current_date, null, 'Chennai', 'On schedule');
    v_txt := (public.issue_track_link(v_ship)).token;
    perform public.record_pre_alert(v_ship, 'agent@example.invalid', 2);
    if v_txt is null then raise exception 'no tracking token'; end if;
    log := log || text 'PASS 19 tracking update added, tracking link issued, pre-alert recorded'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 19 tracking / pre-alert: ' || sqlerrm); n_bad := n_bad + 1; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    v_json := public.shipment_tracking(v_txt);
    if v_json is null or coalesce(v_json ->> 'state', '') in ('unknown', 'revoked') then raise exception 'tracking page says %', left(v_json::text, 200); end if;
    log := log || text 'PASS 20 customer''s tracking page reads the job by its link'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 20 public tracking page: ' || sqlerrm); n_bad := n_bad + 1; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    v_console := (public.open_console(null, 'export', 'LCL')).id;
    perform public.attach_to_console(v_ship, v_console);
    select console_id into v_txt from public.shipments where id = v_ship;
    if v_txt is distinct from v_console::text then raise exception 'not on the console'; end if;
    log := log || text 'PASS 21 console opened and the job put on it'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 21 console: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    insert into public.house_bills (shipment_id, release_mode, originals, mto_own, data)
    values (v_ship, 'original', 3, false, jsonb_build_object(
      'consignee_mode', 'named', 'consignee_name', 'E2E Gulf Trading LLC', 'consignee_address', 'Jebel Ali Free Zone, Dubai',
      'shipper_name', v_tag || ' Exports Pvt Ltd', 'shipper_address', 'Guindy, Chennai', 'notify_same', true,
      'port_of_loading', 'Chennai', 'port_of_discharge', 'Jebel Ali', 'description', 'Machinery parts', 'packages', '2 Pallets'));
    v_txt := public.number_hbl(v_ship);
    if v_txt is null then raise exception 'no number'; end if;
    log := log || format('PASS 22 house B/L saved and numbered %s', v_txt); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 22 house B/L save / number: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_token := public.hbl_draft_link(v_ship)::text;
    perform public.hbl_draft_sent(v_ship, 'e2e@example.invalid');
    log := log || text 'PASS 23 house B/L draft link made and marked sent to the shipper'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 23 house B/L draft link: ' || sqlerrm); n_bad := n_bad + 1; end;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    v_json := public.hbl_draft_by_token(v_token);
    if v_json is null or coalesce(v_json ->> 'state', '') in ('unknown', 'revoked') then raise exception 'draft by link says %', left(v_json::text, 200); end if;
    v_json := public.hbl_answer_by_token(v_token, true, 'E2E Shipper', 'Looks right');
    if coalesce(v_json ->> 'ok', 'true') = 'false' then raise exception 'answer said %', left(v_json::text, 200); end if;
    log := log || text 'PASS 24 shipper opened the B/L draft by its link and approved it'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 24 shipper approves B/L draft: ' || sqlerrm); n_bad := n_bad + 1; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    select approval into v_txt from public.house_bills where shipment_id = v_ship;
    if v_txt is distinct from 'approved' then raise exception 'approval is %', v_txt; end if;
    begin
      perform public.issue_house_bl(v_ship);
      raise exception 'issued a second B/L number';
    exception when others then
      if sqlerrm not like 'This shipment already carries B/L%' then raise; end if;
    end;
    log := log || text 'PASS 25 B/L approval on the job; a second B/L number refused'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 25 B/L approval / double number guard: ' || sqlerrm); n_bad := n_bad + 1; end;

  -- ===================== accounts =====================
  begin
    -- Starting the invoice brings the accepted quotation's charges with it, as the app relies on.
    v_inv := (public.start_invoice(v_ship, 'tax_invoice')).id;
    select * into v_i from public.invoices where id = v_inv;
    if round(coalesce(v_i.total_inr, v_i.total_amount, 0)) <> round(98500 * 1.18) then
      raise exception 'invoice total % is not the quotation plus GST (%)', v_i.total_amount, 98500 * 1.18;
    end if;
    perform public.issue_invoice(v_inv);
    select * into v_i from public.invoices where id = v_inv;
    if v_i.status <> 'issued' or v_i.number is null then raise exception 'status % number %', v_i.status, v_i.number; end if;
    log := log || format('PASS 26 tax invoice drafted from the quotation and issued as %s, ₹%s with GST (bill to %s)', v_i.number, v_i.total_inr, v_i.bill_to_name); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 26 invoice: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_pay := (public.start_payment('in', v_cust, null, v_inv)).id;
    update public.payments set amount = 50000, mode = 'bank_transfer', payment_date = current_date, updated_at = now() where id = v_pay;
    if not exists (select 1 from public.payment_allocations where payment_id = v_pay and invoice_id = v_inv) then
      insert into public.payment_allocations (payment_id, invoice_id, amount, tds_amount) values (v_pay, v_inv, 50000, 0);
    else
      update public.payment_allocations set amount = 50000 where payment_id = v_pay and invoice_id = v_inv;
    end if;
    perform public.confirm_payment(v_pay);
    select status into v_txt from public.invoices where id = v_inv;
    if v_txt <> 'part_paid' then raise exception 'invoice status %', v_txt; end if;
    log := log || format('PASS 27 receipt of ₹50,000 recorded against it and confirmed; invoice now %s', v_txt); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 27 receipt: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    insert into public.bills (bill_no, bill_date, kind, status, partner_id, shipment_id, currency, exchange_rate, recorded_by)
    values (v_tag || '-OF', current_date, 'carrier_invoice', 'received', v_carrier, v_ship, 'INR', 1, v_emp) returning id into v_bill;
    insert into public.bill_lines (bill_id, position, description, quantity, unit, rate, tax_rate)
    values (v_bill, 1, 'Ocean freight', 1, 'Shipment', 83600, 18);
    select total_inr into v_n from public.bills where id = v_bill;
    if coalesce(v_n, 0) <= 0 then perform public.recompute_bill_totals(v_bill); select total_inr into v_n from public.bills where id = v_bill; end if;
    if coalesce(v_n, 0) <= 0 then raise exception 'bill total %', v_n; end if;
    log := log || format('PASS 28 carrier''s bill entered, ₹%s with GST', v_n); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 28 carrier bill: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_pay2 := (public.start_payment('out', null, v_carrier, null)).id;
    update public.payments set amount = v_n, mode = 'bank_transfer', payment_date = current_date, updated_at = now() where id = v_pay2;
    insert into public.payment_allocations (payment_id, bill_id, amount, tds_amount) values (v_pay2, v_bill, v_n, 0);
    perform public.confirm_payment(v_pay2);
    select status into v_txt from public.bills where id = v_bill;
    if v_txt <> 'paid' then raise exception 'bill status %', v_txt; end if;
    log := log || format('PASS 29 carrier paid in full and confirmed; bill now %s', v_txt); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 29 payment to carrier: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_note := (public.start_note(v_inv, 'credit_note', 'Documentation charge waived')).id;
    if not exists (select 1 from public.invoice_lines where invoice_id = v_note) then
      insert into public.invoice_lines (invoice_id, position, description, sac_code, quantity, unit, rate, tax_rate, currency, fx_rate)
      values (v_note, 1, 'Documentation waived', '996719', 1, 'Set', 3500, 18, 'INR', 1);
    end if;
    perform public.issue_invoice(v_note);
    select number, total_inr into v_txt, v_n2 from public.invoices where id = v_note;
    log := log || format('PASS 30 credit note %s raised against the invoice and issued, ₹%s', v_txt, v_n2); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 30 credit note: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_anote := (public.start_agent_note(v_agent, 'debit_note', null, 'USD')).id;
    update public.invoices set shipment_id = v_ship, exchange_rate = 88 where id = v_anote;
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit, rate, tax_rate, currency, fx_rate)
    values (v_anote, 1, 'Handling, our side', 1, 'Shipment', 100, 0, 'USD', 88);
    perform public.issue_invoice(v_anote);
    select number, total_inr into v_txt, v_n2 from public.invoices where id = v_anote;
    log := log || format('PASS 31 debit note %s to the overseas agent issued, ₹%s', v_txt, v_n2); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 31 debit note to agent: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    select billed_inr, collected_inr, cost_inr, paid_out_inr into v_n, v_n2, v_n3, v_n4 from public.job_final_bill where shipment_id = v_ship;
    if v_n is null then raise exception 'no final bill row'; end if;
    select sum(case when kind = 'credit_note' then -total_inr else total_inr end) into v_q.amount_inr
      from public.invoices where shipment_id = v_ship and status in ('issued', 'part_paid', 'paid') and kind in ('tax_invoice', 'debit_note', 'credit_note');
    if v_n <> v_q.amount_inr then raise exception 'billed % vs documents %', v_n, v_q.amount_inr; end if;
    log := log || format('PASS 32 final bill agrees with the documents: billed ₹%s, collected ₹%s, cost ₹%s, paid out ₹%s', v_n, v_n2, v_n3, v_n4); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 32 final bill view: ' || sqlerrm); n_bad := n_bad + 1; end;

  -- ===================== close the job =====================
  begin
    v_json := public.shipment_signoff_checklist(v_ship);
    select count(*) into v_cnt from jsonb_array_elements(v_json) e where (e ->> 'blocking')::boolean and not (e ->> 'ok')::boolean;
    begin
      perform public.sign_off_shipment(v_ship, 'E2E early');
      raise exception 'signed off with % blocking items open', v_cnt;
    exception when others then
      if sqlerrm not like 'not ready to sign off%' then raise; end if;
    end;
    log := log || format('PASS 33 sign-off refused while %s blocking items are open', v_cnt); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 33 sign-off guard: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    update public.shipment_checkpoints set done_at = now(), done_by = v_emp
     where shipment_id = v_ship and done_at is null and stage is null;
    for v_txt in
      select id::text from public.shipment_milestones where shipment_id = v_ship and stage is not null and reached_on is null order by position
    loop
      perform public.save_shipment_milestone(v_txt::uuid, current_date, null, 'E2E', 'E2E', false);
    end loop;
    update public.shipment_checkpoints set done_at = now(), done_by = v_emp
     where shipment_id = v_ship and done_at is null and stage is null;
    insert into public.enquiry_files (enquiry_ref, name, content_type, size_bytes, path, source, filed_by, document_type)
    values (v_ref, 'POD.pdf', 'application/pdf', 1024, 'e2e/' || v_ship || '/pod.pdf', 'upload', v_emp, 'Proof of delivery');
    select stage into v_txt from public.shipments where id = v_ship;
    select count(*) into v_cnt from public.shipment_checkpoints where shipment_id = v_ship and done_at is null;
    if v_txt <> 'delivered' or v_cnt <> 0 then raise exception 'stage %, % steps open', v_txt, v_cnt; end if;
    log := log || text 'PASS 34 job worked to the end: every step done, every milestone recorded, delivered, proof of delivery filed'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 34 finish the job: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    perform public.sign_off_shipment(v_ship, 'E2E check');
    select signed_off_at into v_s.signed_off_at from public.shipments where id = v_ship;
    if v_s.signed_off_at is null then raise exception 'not signed off'; end if;
    log := log || text 'PASS 35 job signed off'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 35 sign off: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    begin
      perform public.add_shipment_update(v_ship, 'After sign-off', current_date, null, null, null);
      raise exception 'a signed-off job took a tracking update';
    exception when others then
      if sqlerrm not like '%signed off%' or sqlerrm like 'a signed-off job took%' then raise; end if;
    end;
    log := log || text 'PASS 36 a signed-off job refuses changes'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 36 signed-off guard: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    select count(*) into v_cnt from public.enquiry_events where enquiry_ref = v_ref;
    if v_cnt = 0 then raise exception 'no timeline'; end if;
    log := log || format('PASS 37 the case file''s timeline holds %s events for the job', v_cnt); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 37 timeline: ' || sqlerrm); n_bad := n_bad + 1; end;

  -- the employee may not read team oversight
  begin
    perform * from public.team_actions(now() - interval '1 hour');
    log := log || text 'FAIL 38 an employee could read team oversight'; n_bad := n_bad + 1;
  exception when others then
    log := log || text 'PASS 38 team oversight refused to an employee'; n_ok := n_ok + 1;
  end;

  -- ===================== the admin =====================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    select count(*), count(distinct kind) into v_cnt, v_cnt2 from public.team_actions(now() - interval '1 hour') where who = v_emp;
    if v_cnt < 10 then raise exception 'only % actions credited to the employee', v_cnt; end if;
    log := log || format('PASS 39 team oversight credits the employee with %s actions of %s kinds', v_cnt, v_cnt2); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 39 team oversight: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    perform public.reopen_signoff(v_ship, 'E2E check: reopening');
    select signed_off_at into v_s.signed_off_at from public.shipments where id = v_ship;
    if v_s.signed_off_at is not null then raise exception 'still signed off'; end if;
    log := log || text 'PASS 40 admin reopened the signed-off job'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 40 reopen sign-off: ' || sqlerrm); n_bad := n_bad + 1; end;

  -- ===================== side paths, as the employee =====================
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin
    v_ref2 := (public.create_enquiry(v_cust, 'call', 'Chennai', 'Singapore', 'Garments')).ref;
    perform public.claim_enquiry(v_ref2);
    perform public.release_enquiry(v_ref2);
    select assigned_to into v_txt from public.enquiries where ref = v_ref2;
    if v_txt is not null then raise exception 'still assigned after release'; end if;
    log := log || format('PASS 41 a phoned-in enquiry %s opened, taken on and put back', v_ref2); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 41 enquiry by phone / take on / put back: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    v_intake2 := (public.capture_message_as_intake(lower(v_tag) || '-msg2', null, 'Newsletter ' || v_tag, 'Spam Sender', 'spam@example.invalid', 'Buy now')).id;
    perform public.dismiss_intake(v_intake2, 'Not an enquiry');
    perform public.reopen_intake(v_intake2);
    select status into v_txt from public.intake where id = v_intake2;
    if v_txt <> 'new' then raise exception 'status %', v_txt; end if;
    log := log || text 'PASS 42 a queue item set aside and put back'; n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 42 queue dismiss / reopen: ' || sqlerrm); n_bad := n_bad + 1; end;

  begin
    perform public.cancel_shipment(v_ship, 'E2E check: customer cancelled');
    select stage into v_txt from public.shipments where id = v_ship;
    if v_txt <> 'cancelled' then raise exception 'stage after cancel %', v_txt; end if;
    perform public.reopen_shipment(v_ship, 'E2E check: back on');
    select stage into v_s.stage from public.shipments where id = v_ship;
    if v_s.stage = 'cancelled' then raise exception 'still cancelled after reopen'; end if;
    log := log || format('PASS 43 job cancelled and reopened (back at %s)', v_s.stage); n_ok := n_ok + 1;
  exception when others then log := log || ('FAIL 43 cancel / reopen job: ' || sqlerrm); n_bad := n_bad + 1; end;

  raise exception 'RESULTS ok=% failed=% %', n_ok, n_bad, E'\n' || array_to_string(log, E'\n');
end
$e2e$;
