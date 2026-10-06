-- ---------------------------------------------------------------------------
-- 137 · Team oversight by person: every action the desk records, in one read
--
-- Team oversight (086) built its feed from three things: the timeline events,
-- the steps ticked and the mail sent. A great deal more of what a person does
-- is recorded only in its own table, with who did it beside it — a file filed
-- on an enquiry, a console opened, a CSN filed, cargo received at the
-- warehouse, a queue item set aside, a rate card or a sailing added, a buy
-- rate noted, an invoice started, issued or cancelled, a receipt or payment
-- recorded or confirmed, a vendor bill entered, an agent statement drawn up,
-- a tracking update applied or dismissed. The page now shows each person and
-- everything they did, in sections, so all of it is read here, at once.
--
-- One row per action: when, who, where it comes from (`source`), what it was
-- (`kind`: the event's kind, or a verb for the others), a line saying it, and
-- the enquiry / job / console it was on. The mail sent stays in mail_log and
-- is read as before (it carries recipients and a preview).
--
-- What is NOT read from the events, because its own table says it better and
-- for every case (a console's invoice has no enquiry, so no event):
-- invoice_started / invoice_issued / invoice_cancelled (invoices) and
-- receipt_recorded (payments).
--
-- Administrators only, like the page: security definer, so it reads every
-- table whatever their own policies say, and refuses anybody else.
-- ---------------------------------------------------------------------------

create or replace function public.team_actions(p_from timestamptz, p_to timestamptz default null)
returns table (
  id text,
  at timestamptz,
  who uuid,
  source text,
  kind text,
  summary text,
  enquiry_ref text,
  shipment_id text,
  console_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_to timestamptz := coalesce(p_to, 'infinity'::timestamptz);
begin
  if not exists (select 1 from public.profiles where profiles.id = auth.uid() and role = 'admin') then
    raise exception 'Team oversight is for administrators';
  end if;
  if p_from is null then
    raise exception 'A period is needed';
  end if;

  return query
  -- The timeline: enquiries, quotes, bookings, house bills, consoles, sign-off.
  select 'e:' || e.id::text, e.at, e.actor, 'event'::text, e.kind, e.summary, e.enquiry_ref, null::text, null::uuid
    from public.enquiry_events e
   where e.at >= p_from and e.at < v_to
     and e.kind not in ('invoice_started', 'invoice_issued', 'invoice_cancelled', 'receipt_recorded')

  -- A job's workflow steps, ticked.
  union all
  select 's:' || c.id::text, c.done_at, c.done_by, 'step', 'step_done', c.label, s.enquiry_ref, c.shipment_id, null
    from public.shipment_checkpoints c
    left join public.shipments s on s.id = c.shipment_id
   where c.done_at >= p_from and c.done_at < v_to

  -- Files filed on an enquiry.
  union all
  select 'f:' || f.id::text, f.filed_at, f.filed_by, 'file', 'file_filed',
         'Filed ' || f.name || coalesce(' — ' || nullif(btrim(f.reference_number), ''), ''), f.enquiry_ref, null, null
    from public.enquiry_files f
   where f.filed_at >= p_from and f.filed_at < v_to

  -- Consoles opened, and their CSN files made and answered.
  union all
  select 'co:' || k.id::text, k.created_at, k.opened_by, 'console', 'console_opened',
         'Opened console ' || coalesce(k.console_no, '') || ' (' || k.mode || ', ' || k.direction || ')', null, null, k.id
    from public.consoles k
   where k.created_at >= p_from and k.created_at < v_to
  union all
  select 'cf:' || x.job_no::text, x.created_at, x.created_by, 'console', 'csn_filed',
         'CSN file ' || x.file_name, null, null, x.console_id
    from public.csn_files x
   where x.created_at >= p_from and x.created_at < v_to
  union all
  select 'cr:' || x.job_no::text, x.replied_at, x.replied_by, 'console', 'csn_reply',
         'CSN reply recorded — ' || coalesce(x.reply_status, 'read') || ' (' || x.file_name || ')', null, null, x.console_id
    from public.csn_files x
   where x.replied_at >= p_from and x.replied_at < v_to and x.replied_by is not null

  -- Cargo received at the warehouse or CFS.
  union all
  select 'w:' || r.id::text, r.created_at, r.received_by, 'warehouse', 'cargo_received',
         'Cargo received' || coalesce(', receipt ' || nullif(btrim(r.receipt_no), ''), ''), s.enquiry_ref, r.shipment_id, null
    from public.warehouse_receipts r
    left join public.shipments s on s.id = r.shipment_id
   where r.created_at >= p_from and r.created_at < v_to

  -- Queue items set aside (one made into an enquiry is the timeline's "From queue").
  union all
  select 'q:' || q.id::text, q.settled_at, q.settled_by, 'intake', 'queue_set_aside',
         'Set aside from the queue: ' || coalesce(nullif(btrim(q.subject), ''), nullif(btrim(q.contact_name), ''), 'a queued item') || ' (' || q.status || ')',
         q.enquiry_ref, null, null
    from public.intake q
   where q.settled_at >= p_from and q.settled_at < v_to and q.settled_by is not null and q.status <> 'promoted'

  -- Rates and sailings.
  union all
  select 'rc:' || r.id::text, r.created_at, r.created_by, 'rates', 'rate_card_added',
         'Rate card: ' || coalesce(r.origin, '?') || ' → ' || coalesce(r.destination, '?') || ' (' || r.mode || ')', null, null, null
    from public.rate_cards r
   where r.created_at >= p_from and r.created_at < v_to
  union all
  select 'ss:' || x.id, x.created_at, x.created_by, 'rates', 'schedule_added',
         'Sailing added: ' || coalesce(x.port_of_loading, '?') || ' → ' || coalesce(x.port_of_discharge, x.final_destination, '?')
           || coalesce(' · ' || nullif(btrim(x.flight_number), ''), ''), null, null, null
    from public.sailing_schedules x
   where x.created_at >= p_from and x.created_at < v_to
  union all
  select 'lr:' || l.id::text, l.created_at, l.created_by, 'rates', 'live_rate_request', 'Live rate request opened', null, null, null
    from public.live_rate_requests l
   where l.created_at >= p_from and l.created_at < v_to
  union all
  select 'br:' || b.enquiry_ref || ':' || b.partner_id::text, b.created_at, b.created_by, 'rates', 'buy_rate_recorded',
         'Original rate noted from ' || coalesce(nullif(btrim(b.partner_label), ''), 'a partner')
           || coalesce(' — ₹' || to_char(b.total_inr, 'FM99,99,99,99,990'), ''), b.enquiry_ref, null, null
    from public.enquiry_buy_rates b
   where b.created_at >= p_from and b.created_at < v_to

  -- Accounts: invoices and notes, receipts and payments, bills, statements.
  union all
  select 'is:' || i.id::text, i.created_at, i.created_by, 'accounts', 'invoice_started',
         'Started ' || replace(i.kind, '_', ' ') || coalesce(' for ' || nullif(btrim(i.bill_to_name), ''), ''), i.enquiry_ref, i.shipment_id, i.console_id
    from public.invoices i
   where i.created_at >= p_from and i.created_at < v_to
  union all
  select 'ii:' || i.id::text, i.issued_at, i.issued_by, 'accounts', 'invoice_issued',
         'Issued ' || replace(i.kind, '_', ' ') || coalesce(' ' || i.number, '')
           || coalesce(' — ' || i.currency || ' ' || to_char(i.total_amount, 'FM99,99,99,99,990.00'), '')
           || coalesce(' to ' || nullif(btrim(i.bill_to_name), ''), ''), i.enquiry_ref, i.shipment_id, i.console_id
    from public.invoices i
   where i.issued_at >= p_from and i.issued_at < v_to and i.issued_by is not null
  union all
  select 'ic:' || i.id::text, i.cancelled_at, i.cancelled_by, 'accounts', 'invoice_cancelled',
         'Cancelled ' || replace(i.kind, '_', ' ') || coalesce(' ' || i.number, ''), i.enquiry_ref, i.shipment_id, i.console_id
    from public.invoices i
   where i.cancelled_at >= p_from and i.cancelled_at < v_to and i.cancelled_by is not null
  union all
  select 'pr:' || p.id::text, p.created_at, p.created_by, 'accounts', case p.direction when 'in' then 'receipt_recorded' else 'payment_recorded' end,
         case p.direction when 'in' then 'Receipt' else 'Payment' end || coalesce(' ' || p.number, '') || ' recorded — '
           || p.currency || ' ' || to_char(p.amount, 'FM99,99,99,99,990.00') || coalesce(' (' || p.mode || ')', ''), null, null, null
    from public.payments p
   where p.created_at >= p_from and p.created_at < v_to
  union all
  select 'pc:' || p.id::text, p.confirmed_at, p.confirmed_by, 'accounts', case p.direction when 'in' then 'receipt_confirmed' else 'payment_confirmed' end,
         case p.direction when 'in' then 'Receipt' else 'Payment' end || coalesce(' ' || p.number, '') || ' confirmed', null, null, null
    from public.payments p
   where p.confirmed_at >= p_from and p.confirmed_at < v_to and p.confirmed_by is not null
  union all
  select 'px:' || p.id::text, p.cancelled_at, p.cancelled_by, 'accounts', case p.direction when 'in' then 'receipt_cancelled' else 'payment_cancelled' end,
         case p.direction when 'in' then 'Receipt' else 'Payment' end || coalesce(' ' || p.number, '') || ' cancelled', null, null, null
    from public.payments p
   where p.cancelled_at >= p_from and p.cancelled_at < v_to and p.cancelled_by is not null
  union all
  select 'b:' || b.id::text, b.created_at, b.recorded_by, 'accounts', 'bill_recorded',
         'Entered ' || replace(b.kind, '_', ' ') || coalesce(' ' || nullif(btrim(b.bill_no), ''), '')
           || ' — ' || b.currency || ' ' || to_char(b.total_amount, 'FM99,99,99,99,990.00'), s.enquiry_ref, b.shipment_id, b.console_id
    from public.bills b
    left join public.shipments s on s.id = b.shipment_id
   where b.created_at >= p_from and b.created_at < v_to
  union all
  select 'as:' || a.id::text, a.created_at, a.created_by, 'accounts', 'statement_created',
         'Agent statement ' || coalesce(a.statement_no, '') || ' drawn up', null, null, null
    from public.agent_statements a
   where a.created_at >= p_from and a.created_at < v_to

  -- Tracking updates the desk decided on.
  union all
  select 't:' || t.id::text, t.decided_at, t.decided_by, 'tracking', 'tracking_' || t.status,
         case t.status when 'applied' then 'Applied a tracking update: ' when 'dismissed' then 'Dismissed a tracking update: ' else 'Noted a tracking update: ' end
           || replace(t.kind, '_', ' '), s.enquiry_ref, t.shipment_id, null
    from public.tracking_events t
    left join public.shipments s on s.id = t.shipment_id
   where t.decided_at >= p_from and t.decided_at < v_to and t.decided_by is not null;
end;
$fn$;

revoke execute on function public.team_actions(timestamptz, timestamptz) from public, anon;
grant execute on function public.team_actions(timestamptz, timestamptz) to authenticated;
