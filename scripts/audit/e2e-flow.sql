-- One shipment, enquiry to sign-off, as the desk would do it — on the live
-- database, in one transaction that is rolled back at the end.
--
--   node <q.mjs> "@scripts/audit/e2e-flow.sql"
--
-- Each step runs as the person who would do it (an employee, the admin, the
-- customer with only the anonymous key), through the same functions and table
-- writes the app uses, and is timed. A step that fails is recorded with the
-- database's own words and the flow carries on where it can. Nothing is kept:
-- the final RAISE rolls everything back, and the one sequence the flow draws
-- from (a booking's ARX number) is put back if nobody else booked meanwhile.
do $e2e$
declare
  -- Real people, found by what they may do: an employee whose quotes need approval, and an admin.
  emp    uuid := (select id from public.profiles where role = 'employee' and not coalesce(can_approve_quotes, false) order by email limit 1);
  adm    uuid := (select id from public.profiles where role = 'admin' order by email limit 1);
  vendor uuid := (select id from public.partners order by created_at limit 1);
  seq0   bigint := pg_sequence_last_value('public.shipment_no_seq');
  seq1   bigint;
  steps  jsonb := '[]'::jsonb;
  t0     timestamptz;
  v_cust text;
  v_ref  text;
  v_q    uuid;
  v_tok  text;
  v_pub  jsonb;
  v_ship text;
  v_inv  uuid;
  v_num  text;
  v_pay  uuid;
  v_bill uuid;
  v_ms   uuid;
  v_trk  text;
  v_txt  text;
  v_n    int;
  v_j    jsonb;
  today  date := (now() at time zone 'Asia/Kolkata')::date;

begin
  -- ---------------------------------------------------------------- inbound
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', emp::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  t0 := clock_timestamp();
  begin
    v_cust := (public.create_customer('E2E Audit', 'E2E Audit Pvt Ltd', 'e2e-audit@example.invalid', '')).id;
    v_ref := (public.create_enquiry(v_cust, 'email', 'Chennai', 'Jebel Ali', 'Machine parts, 12 cartons')).ref;
    perform public.claim_enquiry(v_ref);
    update public.enquiries set transport_mode = 'sea_lcl', trade_direction = 'export', incoterm = 'CIF' where ref = v_ref;
    steps := steps || jsonb_build_object('step', 'enquiry created and claimed', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000), 'ref', v_ref);
  exception when others then
    steps := steps || jsonb_build_object('step', 'enquiry created and claimed', 'ok', false, 'error', sqlerrm);
  end;

  t0 := clock_timestamp();
  begin
    insert into public.quotes (enquiry_ref, version, amount_inr, basis, status, created_by, currency, fx_rate)
    values (v_ref, 1, 85000, 'All-in, CFS Chennai to CFS Jebel Ali', 'draft', emp, 'INR', 1)
    returning id into v_q;
    insert into public.quote_lines (quote_id, position, description, quantity, unit, rate, currency, fx_rate, cost_inr)
    values (v_q, 1, 'Ocean freight', 1, 'lot', 85000, 'INR', 1, 61000);
    steps := steps || jsonb_build_object('step', 'quote drafted with a costed line', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
  exception when others then
    steps := steps || jsonb_build_object('step', 'quote drafted with a costed line', 'ok', false, 'error', sqlerrm);
  end;

  -- The gate: an employee cannot send an unapproved quote, nor approve one.
  begin
    update public.quotes set status = 'sent', sent_at = now() where id = v_q;
    get diagnostics v_n = row_count;
    steps := steps || jsonb_build_object('step', 'unapproved quote refused on send', 'ok', false, 'error', 'NOT REFUSED', 'rows', v_n);
  exception when others then
    steps := steps || jsonb_build_object('step', 'unapproved quote refused on send', 'ok', true, 'said', sqlerrm);
  end;
  begin
    perform public.decide_quote(v_q, true, 'self');
    steps := steps || jsonb_build_object('step', 'employee cannot approve', 'ok', false, 'error', 'NOT REFUSED');
  exception when others then
    steps := steps || jsonb_build_object('step', 'employee cannot approve', 'ok', true, 'said', sqlerrm);
  end;

  t0 := clock_timestamp();
  begin
    perform public.submit_quote_for_approval(v_q);
    steps := steps || jsonb_build_object('step', 'quote submitted for approval', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
  exception when others then
    steps := steps || jsonb_build_object('step', 'quote submitted for approval', 'ok', false, 'error', sqlerrm);
  end;

  -- the admin approves
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t0 := clock_timestamp();
  begin
    perform public.decide_quote(v_q, true, 'Margin fine');
    steps := steps || jsonb_build_object('step', 'admin approves', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'approval', (select approval_status from public.quotes where id = v_q));
  exception when others then
    steps := steps || jsonb_build_object('step', 'admin approves', 'ok', false, 'error', sqlerrm);
  end;

  -- the employee sends it and makes the acceptance link
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', emp::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t0 := clock_timestamp();
  begin
    update public.quotes set status = 'sent', sent_at = now() where id = v_q;
    update public.enquiries set status = 'quoted' where ref = v_ref;
    v_tok := (public.issue_quote_link(v_q)).token;
    steps := steps || jsonb_build_object('step', 'quote sent, acceptance link issued', 'ok', v_tok is not null, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
  exception when others then
    steps := steps || jsonb_build_object('step', 'quote sent, acceptance link issued', 'ok', false, 'error', sqlerrm);
  end;

  -- ------------------------------------------------------------- the customer
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  t0 := clock_timestamp();
  begin
    v_pub := public.quote_by_token(v_tok);
    steps := steps || jsonb_build_object('step', 'customer opens the quotation', 'ok', v_pub is not null, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'leaks_cost', v_pub::text ~* '(cost_inr|61000|margin|buy)', 'keys', (select jsonb_agg(k) from jsonb_object_keys(v_pub) k));
    v_pub := public.accept_quote_by_token(v_tok, 'E2E Audit', 'Go ahead');
    steps := steps || jsonb_build_object('step', 'customer accepts', 'ok', true, 'answer', v_pub);
  exception when others then
    steps := steps || jsonb_build_object('step', 'customer opens and accepts', 'ok', false, 'error', sqlerrm);
  end;
  begin
    perform 1 from public.quotes limit 1;
    steps := steps || jsonb_build_object('step', 'anon cannot read quotes', 'ok', false, 'error', 'NOT REFUSED');
  exception when others then
    steps := steps || jsonb_build_object('step', 'anon cannot read quotes', 'ok', true);
  end;

  -- ---------------------------------------------------------------- booking
  reset role;
  steps := steps || jsonb_build_object('step', 'after acceptance', 'enquiry_status', (select status from public.enquiries where ref = v_ref),
    'quote_status', (select status from public.quotes where id = v_q));
  perform set_config('request.jwt.claims', json_build_object('sub', emp::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  t0 := clock_timestamp();
  begin
    v_ship := (public.promote_enquiry(v_ref)).id;
    steps := steps || jsonb_build_object('step', 'booked (promote_enquiry)', 'ok', v_ship is not null, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000), 'shipment', v_ship,
      'steps', (select count(*) from public.shipment_checkpoints where shipment_id = v_ship),
      'milestones', (select count(*) from public.shipment_milestones where shipment_id = v_ship),
      'booked_reached', (select reached_on is not null from public.shipment_milestones where shipment_id = v_ship and stage = 'booked'));
  exception when others then
    steps := steps || jsonb_build_object('step', 'booked (promote_enquiry)', 'ok', false, 'error', sqlerrm);
  end;
  seq1 := pg_sequence_last_value('public.shipment_no_seq');

  -- ------------------------------------------------------------- operations
  t0 := clock_timestamp();
  begin
    update public.shipments set carrier = 'MSC', vessel = 'MSC AURORA', voyage = 'FA412E', etd = today - 3, eta = today + 8,
           port_of_loading = 'Chennai (INMAA)', port_of_discharge = 'Jebel Ali (AEJEA)'
     where id = v_ship;
    insert into public.shipment_movements (shipment_id, kind, actual_at, pieces) values (v_ship, 'pickup', now() - interval '5 days', 12);
    insert into public.warehouse_receipts (shipment_id, received_at, location, pieces, gross_weight_kg, condition)
    values (v_ship, now() - interval '4 days', 'Chennai CFS', 12, 480, 'good');
    insert into public.shipment_customs (shipment_id, side, sb_number, sb_date, leo_date) values (v_ship, 'export', '7712345', today - 5, today - 4);
    steps := steps || jsonb_build_object('step', 'pickup, receipt, export customs recorded', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'stage_after_records', (select stage from public.shipments where id = v_ship));
  exception when others then
    steps := steps || jsonb_build_object('step', 'pickup, receipt, export customs recorded', 'ok', false, 'error', sqlerrm);
  end;

  t0 := clock_timestamp();
  begin
    for v_ms in select id from public.shipment_milestones where shipment_id = v_ship and code in ('picked_up', 'received', 'export_customs', 'departed') order by position loop
      perform public.save_shipment_milestone(v_ms, today - 3, time '14:30', '', '', false);
    end loop;
    steps := steps || jsonb_build_object('step', 'milestones recorded to sailed', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'stage', (select stage from public.shipments where id = v_ship));
  exception when others then
    steps := steps || jsonb_build_object('step', 'milestones recorded to sailed', 'ok', false, 'error', sqlerrm);
  end;

  t0 := clock_timestamp();
  begin
    insert into public.house_bills (shipment_id, data) values (v_ship, jsonb_build_object('consignee_name', 'E2E Consignee LLC'));
    v_num := public.number_hbl(v_ship);
    steps := steps || jsonb_build_object('step', 'house B/L numbered', 'ok', v_num is not null, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000), 'hbl', v_num);
  exception when others then
    steps := steps || jsonb_build_object('step', 'house B/L numbered', 'ok', false, 'error', sqlerrm);
  end;

  -- the customer's tracking page
  begin
    v_trk := (public.issue_track_link(v_ship)).token;
    reset role;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    v_pub := public.shipment_tracking(v_trk);
    steps := steps || jsonb_build_object('step', 'customer tracking page', 'ok', v_pub->>'state' = 'open',
      'reached', (select jsonb_agg(m->>'label') from jsonb_array_elements(v_pub->'milestones') m where m->>'reached_on' is not null),
      'leaks', v_pub::text ~* '(agreed_inr|85000|ARX-SHP|done_by|updated_by|assigned_to)');
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', emp::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
  exception when others then
    steps := steps || jsonb_build_object('step', 'customer tracking page', 'ok', false, 'error', sqlerrm);
  end;

  -- ------------------------------------------------- cancelled, and reopened
  begin
    perform public.cancel_shipment(v_ship, 'no');
    steps := steps || jsonb_build_object('step', 'cancelling needs a reason', 'ok', false, 'error', 'NOT REFUSED');
  exception when others then
    steps := steps || jsonb_build_object('step', 'cancelling needs a reason', 'ok', true, 'said', sqlerrm);
  end;
  t0 := clock_timestamp();
  begin
    perform public.cancel_shipment(v_ship, 'Customer postponed the order');
    steps := steps || jsonb_build_object('step', 'shipment cancelled with a reason', 'ok', (select stage from public.shipments where id = v_ship) = 'cancelled',
      'ms', round(extract(epoch from clock_timestamp() - t0) * 1000), 'reason', (select cancel_reason from public.shipments where id = v_ship));
  exception when others then
    steps := steps || jsonb_build_object('step', 'shipment cancelled with a reason', 'ok', false, 'error', sqlerrm);
  end;
  begin
    perform public.save_shipment_milestone((select id from public.shipment_milestones where shipment_id = v_ship and code = 'arrived'), today, null, '', '', false);
    steps := steps || jsonb_build_object('step', 'a cancelled job takes no milestones', 'ok', false, 'error', 'NOT REFUSED');
  exception when others then
    steps := steps || jsonb_build_object('step', 'a cancelled job takes no milestones', 'ok', true, 'said', sqlerrm);
  end;
  begin
    reset role;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
    v_pub := public.shipment_tracking(v_trk);
    steps := steps || jsonb_build_object('step', 'the customer sees it cancelled', 'ok', coalesce((v_pub->>'cancelled')::boolean, false));
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', emp::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
  exception when others then
    steps := steps || jsonb_build_object('step', 'the customer sees it cancelled', 'ok', false, 'error', sqlerrm);
  end;
  t0 := clock_timestamp();
  begin
    perform public.reopen_shipment(v_ship, 'Customer confirmed the order again');
    steps := steps || jsonb_build_object('step', 'reopened where its milestones say', 'ok', (select stage from public.shipments where id = v_ship) = 'sailed',
      'ms', round(extract(epoch from clock_timestamp() - t0) * 1000), 'stage', (select stage from public.shipments where id = v_ship),
      'cleared', (select cancel_reason is null and cancelled_at is null from public.shipments where id = v_ship));
  exception when others then
    steps := steps || jsonb_build_object('step', 'reopened where its milestones say', 'ok', false, 'error', sqlerrm);
  end;

  -- ---------------------------------------------------------------- accounts
  t0 := clock_timestamp();
  begin
    v_inv := (public.start_invoice(v_ship, 'tax_invoice')).id;
    insert into public.invoice_lines (invoice_id, position, description, sac_code, quantity, unit, rate, tax_rate)
    values (v_inv, 1, 'Ocean freight', '996521', 1, 'lot', 85000, 18);
    steps := steps || jsonb_build_object('step', 'invoice drafted', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'draft', (select jsonb_build_object('status', status, 'bill_to', bill_to_name, 'taxable', taxable_value, 'total', total_amount) from public.invoices where id = v_inv));
  exception when others then
    steps := steps || jsonb_build_object('step', 'invoice drafted', 'ok', false, 'error', sqlerrm);
  end;
  t0 := clock_timestamp();
  begin
    perform public.issue_invoice(v_inv);
    steps := steps || jsonb_build_object('step', 'invoice issued', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'issued', (select jsonb_build_object('number', number, 'status', status, 'taxable', taxable_value, 'igst', igst_amount, 'cgst', cgst_amount, 'total', total_amount) from public.invoices where id = v_inv));
  exception when others then
    steps := steps || jsonb_build_object('step', 'invoice issued', 'ok', false, 'error', sqlerrm,
      'draft', (select jsonb_build_object('bill_to', bill_to_name, 'state_code', bill_to_state_code, 'pos', place_of_supply_code, 'gstin', bill_to_gstin) from public.invoices where id = v_inv));
  end;

  t0 := clock_timestamp();
  begin
    v_pay := (public.start_payment('in', v_cust, null, v_inv)).id;
    update public.payments set amount = (select total_amount from public.invoices where id = v_inv), mode = 'bank_transfer', payment_date = today where id = v_pay;
    select count(*) into v_n from public.payment_allocations where payment_id = v_pay;
    if v_n = 0 then
      insert into public.payment_allocations (payment_id, invoice_id, amount) values (v_pay, v_inv, (select total_amount from public.invoices where id = v_inv));
    end if;
    perform public.confirm_payment(v_pay);
    steps := steps || jsonb_build_object('step', 'receipt recorded and confirmed', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'payment', (select jsonb_build_object('number', number, 'status', status, 'amount', amount) from public.payments where id = v_pay),
      'settled', (select to_jsonb(s) from public.invoice_settlement s where s.invoice_id = v_inv));
  exception when others then
    steps := steps || jsonb_build_object('step', 'receipt recorded and confirmed', 'ok', false, 'error', sqlerrm);
  end;

  t0 := clock_timestamp();
  begin
    insert into public.bills (bill_no, bill_date, partner_id, shipment_id, currency, exchange_rate, taxable_value, tax_amount, total_amount, total_inr, recorded_by)
    values ('E2E-AUDIT-1', today, vendor, v_ship, 'INR', 1, 61000, 0, 61000, 61000, emp)
    returning id into v_bill;
    steps := steps || jsonb_build_object('step', 'carrier bill recorded', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'margin', (select to_jsonb(m) from public.shipment_margin m where m.shipment_id = v_ship),
      'final_bill', (select to_jsonb(f) from public.job_final_bill f where f.shipment_id = v_ship));
  exception when others then
    steps := steps || jsonb_build_object('step', 'carrier bill recorded', 'ok', false, 'error', sqlerrm);
  end;
  -- The job header's margin (shipment_margin) should agree with Job closing's,
  -- which is before GST: GST collected is owed to the government (lib/jobPnl.ts).
  begin
    steps := steps || jsonb_build_object('step', 'job header margin is before GST, like Job closing',
      'ok', (select m.revenue_inr = i.taxable_value from public.shipment_margin m, public.invoices i where m.shipment_id = v_ship and i.id = v_inv),
      'error', (select format('header revenue %s includes GST; taxable value is %s', m.revenue_inr, i.taxable_value)
                  from public.shipment_margin m, public.invoices i where m.shipment_id = v_ship and i.id = v_inv and m.revenue_inr <> i.taxable_value));
  exception when others then
    steps := steps || jsonb_build_object('step', 'job header margin is before GST, like Job closing', 'ok', false, 'error', sqlerrm);
  end;

  -- --------------------------------------------------------------- delivery
  t0 := clock_timestamp();
  begin
    for v_ms in select id from public.shipment_milestones where shipment_id = v_ship and code in ('arrived', 'out_for_delivery', 'delivered') order by position loop
      perform public.save_shipment_milestone(v_ms, today, null, 'Jebel Ali', '', false);
    end loop;
    steps := steps || jsonb_build_object('step', 'arrived and delivered', 'ok', (select stage from public.shipments where id = v_ship) = 'delivered',
      'ms', round(extract(epoch from clock_timestamp() - t0) * 1000), 'stage', (select stage from public.shipments where id = v_ship));
  exception when others then
    steps := steps || jsonb_build_object('step', 'arrived and delivered', 'ok', false, 'error', sqlerrm);
  end;

  -- ---------------------------------------------------------------- sign-off
  t0 := clock_timestamp();
  begin
    v_j := public.shipment_signoff_checklist(v_ship);
    steps := steps || jsonb_build_object('step', 'sign-off checklist', 'ok', true, 'ms', round(extract(epoch from clock_timestamp() - t0) * 1000),
      'failing', (select jsonb_agg(jsonb_build_object('label', i->>'label', 'blocking', i->'blocking', 'detail', i->>'detail')) from jsonb_array_elements(v_j) i where not (i->>'ok')::boolean));
  exception when others then
    steps := steps || jsonb_build_object('step', 'sign-off checklist', 'ok', false, 'error', sqlerrm);
  end;
  begin
    perform public.sign_off_shipment(v_ship, '');
    steps := steps || jsonb_build_object('step', 'employee signs off', 'ok', true);
  exception when others then
    steps := steps || jsonb_build_object('step', 'employee signs off', 'ok', false, 'said', sqlerrm);
    -- the admin can, with a reason
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.sign_off_shipment(v_ship, 'E2E audit: open follow-ups accepted');
      steps := steps || jsonb_build_object('step', 'admin signs off with a reason', 'ok', true);
    exception when others then
      steps := steps || jsonb_build_object('step', 'admin signs off with a reason', 'ok', false, 'error', sqlerrm);
    end;
  end;
  begin
    perform public.save_shipment_milestone((select id from public.shipment_milestones where shipment_id = v_ship and code = 'delivered'), null, null, '', '', false);
    steps := steps || jsonb_build_object('step', 'signed-off job is locked', 'ok', false, 'error', 'NOT REFUSED');
  exception when others then
    steps := steps || jsonb_build_object('step', 'signed-off job is locked', 'ok', true, 'said', sqlerrm);
  end;

  begin
    perform public.cancel_shipment(v_ship, 'After sign-off');
    steps := steps || jsonb_build_object('step', 'a signed-off job cannot be cancelled', 'ok', false, 'error', 'NOT REFUSED');
  exception when others then
    steps := steps || jsonb_build_object('step', 'a signed-off job cannot be cancelled', 'ok', true, 'said', sqlerrm);
  end;

  -- ---------------------------------------------------------- who sees what
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', emp::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.icegate_settings set iec = iec;
    get diagnostics v_n = row_count;
    steps := steps || jsonb_build_object('step', 'employee cannot change ICEGATE settings', 'ok', v_n = 0, 'rows_changed', v_n);
  exception when others then
    steps := steps || jsonb_build_object('step', 'employee cannot change ICEGATE settings', 'ok', true);
  end;
  select count(*) into v_n from public.mail_log where synced_by is distinct from emp;
  steps := steps || jsonb_build_object('step', 'employee sees only mail their own session recorded', 'ok', v_n = 0, 'others_rows_visible', v_n);
  select count(*) into v_n from public.backup_runs;
  steps := steps || jsonb_build_object('step', 'employee cannot see backups', 'ok', v_n = 0, 'rows_visible', v_n);
  -- Their own signature, and nothing else on their profile (104).
  begin
    update public.profiles set signature = '<p>Regards</p><img src="https://example.invalid/signatures/a.png" width="220">' where id = emp;
    get diagnostics v_n = row_count;
    steps := steps || jsonb_build_object('step', 'employee saves their own signature', 'ok', v_n = 1, 'rows', v_n);
  exception when others then
    steps := steps || jsonb_build_object('step', 'employee saves their own signature', 'ok', false, 'error', sqlerrm);
  end;
  begin
    update public.profiles set can_approve_quotes = true where id = emp;
    steps := steps || jsonb_build_object('step', 'employee cannot make themselves an approver', 'ok', false, 'error', 'NOT REFUSED');
  exception when others then
    steps := steps || jsonb_build_object('step', 'employee cannot make themselves an approver', 'ok', true, 'said', sqlerrm);
  end;

  reset role;
  -- put the one sequence back, if nobody else has drawn from it since
  if seq1 is not null and pg_sequence_last_value('public.shipment_no_seq') = seq1 and seq0 is not null then
    perform setval('public.shipment_no_seq', seq0, true);
    steps := steps || jsonb_build_object('step', 'sequence restored', 'from', seq1, 'to', seq0);
  else
    steps := steps || jsonb_build_object('step', 'sequence not restored', 'before', seq0, 'after_flow', seq1, 'now', pg_sequence_last_value('public.shipment_no_seq'));
  end if;

  raise exception 'RESULTS %', steps::text;
end $e2e$;
