-- 118: A sent quotation, edited, becomes its next revision.
--
-- ---------------------------------------------------------------------------
-- A sent quotation's charges were locked: what the customer was sent stays as
-- it went. Revising meant pasting the rate again, or starting an empty version
-- and typing every charge back in. Now the first change to a sent quotation's
-- charges makes its next version — the same charges, terms, validity,
-- currency, layout and routing — as a draft, and the change lands there. The
-- sent version is marked superseded and keeps its own charges.
--
-- revise_quote(p_quote) does it in one transaction, and answers
--   { quote_id: the new draft, lines: { <sent line id>: <its copy's id> }, existing }
-- so the edit that started it can be applied to the copy of the charge it was
-- made on. Asked again — a second edit racing the first, another tab — it
-- answers the draft already made (`existing: true`) rather than a third version.
--
-- Security invoker: it does exactly what the desk could do from the page
-- (supersede, insert the version and its lines, log it), under the same
-- policies, in one go.
-- ---------------------------------------------------------------------------

create or replace function public.revise_quote(p_quote uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  q         public.quotes%rowtype;
  v_new     uuid;
  v_version int;
  v_lines   jsonb := '{}'::jsonb;
  v_id      uuid;
  l         public.quote_lines%rowtype;
begin
  select * into q from public.quotes where id = p_quote for update;
  if not found then
    raise exception 'That quotation was not found' using errcode = 'P0002';
  end if;

  -- Already revised: the draft that was made, matched charge by charge on position.
  select id into v_new
    from public.quotes
   where enquiry_ref = q.enquiry_ref and status = 'draft' and version > q.version
   order by version desc
   limit 1;
  if v_new is not null then
    select coalesce(jsonb_object_agg(o.id::text, n.id::text), '{}'::jsonb) into v_lines
      from public.quote_lines o
      join public.quote_lines n on n.quote_id = v_new and n.position = o.position
     where o.quote_id = p_quote;
    return jsonb_build_object('quote_id', v_new, 'lines', v_lines, 'existing', true);
  end if;

  if q.status <> 'sent' then
    raise exception 'Only a quotation that has gone to the customer is revised this way; this one is %', q.status
      using hint = 'A draft is edited as it is. An accepted quotation is what the customer agreed to.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.quotes where enquiry_ref = q.enquiry_ref;

  update public.quotes set status = 'superseded' where id = p_quote;

  insert into public.quotes
    (enquiry_ref, version, amount_inr, basis, valid_until, sailing_date, schedule_id, currency, fx_rate,
     quote_type, multi_carrier, terms, mail_text, pasted_text, routing, carrier, transit_time, status, created_by)
  values
    (q.enquiry_ref, v_version, 0, q.basis, q.valid_until, q.sailing_date, q.schedule_id, q.currency, q.fx_rate,
     q.quote_type, q.multi_carrier, q.terms, q.mail_text, q.pasted_text, q.routing, q.carrier, q.transit_time,
     'draft', auth.uid())
  returning id into v_new;

  for l in select * from public.quote_lines where quote_id = p_quote order by position, created_at loop
    insert into public.quote_lines
      (quote_id, position, description, sac_code, quantity, unit, rate, currency, fx_rate, cost_inr,
       partner_quote_id, charge_code, min_amount, cost_currency, cost_fx_rate, cost_rate, vendor, section, gst_rate)
    values
      (v_new, l.position, l.description, l.sac_code, l.quantity, l.unit, l.rate, l.currency, l.fx_rate, l.cost_inr,
       l.partner_quote_id, l.charge_code, l.min_amount, l.cost_currency, l.cost_fx_rate, l.cost_rate, l.vendor, l.section, l.gst_rate)
    returning id into v_id;
    v_lines := v_lines || jsonb_build_object(l.id::text, v_id::text);
  end loop;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (q.enquiry_ref, 'quote_revised',
          format('Version %s started from version %s, which had been sent, by changing its charges', v_version, q.version),
          jsonb_build_object('from', p_quote, 'to', v_new), auth.uid());

  return jsonb_build_object('quote_id', v_new, 'lines', v_lines, 'existing', false);
end $fn$;

revoke execute on function public.revise_quote(uuid) from public, anon;
grant execute on function public.revise_quote(uuid) to authenticated;

notify pgrst, 'reload schema';
