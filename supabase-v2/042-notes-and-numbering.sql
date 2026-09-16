-- ---------------------------------------------------------------------------
-- Credit and debit notes as Section 34 actually requires them, and a serial
-- number that fits.
--
-- THE NUMBER WAS TOO LONG
--
-- 030 allocated `ALG/INV/26-27/0001`. That is eighteen characters, and Rule
-- 46(b) — carried into Rule 53(1A) for notes — caps a serial at sixteen. The
-- company prefix was the part that did not earn its place: the GSTIN and the
-- registered name are already on the document, so `ALG/` was repeating on every
-- line what the letterhead says once.
--
-- `INV/26-27/0001` is fourteen. Series, financial year, sequence.
--
-- Numbers already issued are NOT rewritten. An invoice that has gone out is the
-- document somebody holds; renumbering it to satisfy a rule it was issued under
-- would be a worse breach than the length. Only the next one is affected.
--
-- WHAT A CREDIT NOTE HAS TO CARRY
--
-- Rule 53(1A): the nature of the document, our name, address and GSTIN, a
-- consecutive serial, the date, the recipient's details — and the serial number
-- and date of the tax invoice it relates to. That last one is the whole point
-- of a credit note and the schema had nowhere to put it.
--
-- The reason is not statutory but is the first thing anybody asks, and without
-- a field for it the answer lives in somebody's memory.
--
-- THE 30 NOVEMBER DEADLINE
--
-- Section 34(2): a credit note may only be declared in a return up to the 30th
-- of November following the end of the financial year of the original supply,
-- or the date the annual return for that year is filed, whichever is earlier.
-- After that it can still be issued — as a commercial credit note — but the tax
-- cannot be adjusted.
--
-- The desk cannot be expected to hold that date in its head per invoice, so it
-- is computed and the screen says which side of it a note falls on.
-- ---------------------------------------------------------------------------

create or replace function public.allocate_invoice_number(p_series text, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fy  text := public.fy_of(p_date);
  v_n   int;
  v_no  text;
begin
  insert into public.invoice_series (series, fy, next_number)
  values (p_series, v_fy, 1)
  on conflict (series, fy) do nothing;

  select next_number into v_n
    from public.invoice_series
   where series = p_series and fy = v_fy
     for update;

  update public.invoice_series
     set next_number = next_number + 1
   where series = p_series and fy = v_fy;

  -- INV/26-27/0001 — fourteen characters, inside the sixteen Rule 46(b) allows.
  v_no := p_series || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');

  if length(v_no) > 16 then
    raise exception 'Serial % is % characters; Rule 46(b) allows sixteen',
                    v_no, length(v_no);
  end if;

  return v_no;
end $fn$;


-- ---------------------------------------------------------------------------
-- What a note relates to
-- ---------------------------------------------------------------------------
alter table public.invoices
  -- The document being corrected. Restricted rather than cascaded: a credit
  -- note whose original vanished is a credit note nobody can account for.
  add column if not exists original_invoice_id uuid
    references public.invoices(id) on delete restrict,
  -- Snapshotted alongside the link, because Rule 53(1A) wants the number and
  -- date printed on the note and the original is a row that can be cancelled.
  add column if not exists original_number text,
  add column if not exists original_date   date,
  -- Not statutory, and the first thing anybody asks.
  add column if not exists note_reason     text;

create index if not exists invoices_original_idx on public.invoices (original_invoice_id);

/**
 * The last date a note against this supply can still adjust tax.
 *
 * 30 November following the end of the financial year the original supply fell
 * in. The annual return, if filed earlier, closes it sooner — this system does
 * not know when that was filed, so it returns the statutory outer limit and the
 * screen says so rather than implying the date is unconditional.
 */
create or replace function public.note_adjustment_deadline(p_supply_date date)
returns date
language sql
immutable
as $fn$
  select make_date(
    case when extract(month from p_supply_date) >= 4
         then extract(year from p_supply_date)::int + 1
         else extract(year from p_supply_date)::int
    end, 11, 30);
$fn$;

grant execute on function public.note_adjustment_deadline(date) to authenticated;


-- ---------------------------------------------------------------------------
-- Raising a note against an invoice
--
-- Everything on the note comes from the document it corrects: the same party,
-- the same job, the same tax treatment. A credit note addressed to somebody
-- other than the person who got the invoice is not a credit note.
-- ---------------------------------------------------------------------------
create or replace function public.start_note(
  p_invoice uuid,
  p_kind    text,
  p_reason  text default ''
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_src public.invoices;
  v_row public.invoices;
begin
  if p_kind not in ('credit_note','debit_note') then
    raise exception 'A note is a credit note or a debit note, not %', p_kind;
  end if;

  select * into v_src from public.invoices where id = p_invoice;
  if not found then
    raise exception 'No invoice %', p_invoice;
  end if;

  if v_src.status = 'draft' then
    raise exception 'That invoice has not been issued yet'
      using hint = 'Correct the draft instead — there is nothing out there to credit.';
  end if;
  if v_src.kind in ('credit_note','debit_note') then
    raise exception 'A note cannot be raised against another note';
  end if;

  select * into v_row
    from public.invoices
   where original_invoice_id = p_invoice and kind = p_kind and status = 'draft'
   order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  insert into public.invoices (
    kind, series, status,
    customer_id, partner_id, shipment_id, enquiry_ref, console_id,
    bill_to_name, bill_to_address, bill_to_gstin,
    bill_to_state, bill_to_state_code, bill_to_country,
    attention, account_of,
    bl_number, bl_date, vessel_voyage, movement_type, volume_cbm, gross_weight_kg,
    place_of_supply, place_of_supply_code, tax_treatment, trade_direction,
    currency, exchange_rate,
    original_invoice_id, original_number, original_date, note_reason,
    created_by
  ) values (
    p_kind,
    case when p_kind = 'credit_note' then 'CRN' else 'DBN' end,
    'draft',
    v_src.customer_id, v_src.partner_id, v_src.shipment_id, v_src.enquiry_ref,
    v_src.console_id,
    v_src.bill_to_name, v_src.bill_to_address, v_src.bill_to_gstin,
    v_src.bill_to_state, v_src.bill_to_state_code, v_src.bill_to_country,
    v_src.attention, v_src.account_of,
    v_src.bl_number, v_src.bl_date, v_src.vessel_voyage, v_src.movement_type,
    v_src.volume_cbm, v_src.gross_weight_kg,
    v_src.place_of_supply, v_src.place_of_supply_code, v_src.tax_treatment,
    v_src.trade_direction,
    v_src.currency, v_src.exchange_rate,
    p_invoice, v_src.number, v_src.invoice_date, coalesce(p_reason, ''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.start_note(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- A note must say what it corrects before it can be issued
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(p_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row   public.invoices;
  v_lines int;
begin
  select * into v_row from public.invoices where id = p_id;
  if not found then
    raise exception 'No invoice %', p_id;
  end if;

  if v_row.status <> 'draft' then
    raise exception 'This invoice was already issued as %', coalesce(v_row.number, '(numbered)')
      using hint = 'Issuing it again would spend a second serial number on the same document.';
  end if;

  select count(*) into v_lines from public.invoice_lines where invoice_id = p_id;
  if v_lines = 0 then
    raise exception 'There are no charges on this invoice yet'
      using hint = 'Add at least one charge line before issuing it.';
  end if;

  if coalesce(nullif(v_row.bill_to_name, ''), null) is null then
    raise exception 'This invoice has no bill-to name'
      using hint = 'Fill in the customer''s billing details first.';
  end if;

  -- Rule 53(1A) wants the number and date of the invoice a note relates to
  -- printed on the note itself.
  if v_row.kind in ('credit_note','debit_note')
     and coalesce(v_row.original_number, '') = '' then
    raise exception 'A % must say which invoice it corrects', replace(v_row.kind, '_', ' ')
      using hint = 'Raise it from the invoice itself so the number and date come across.';
  end if;

  update public.invoices
     set number    = public.allocate_invoice_number(v_row.series, v_row.invoice_date),
         fy        = public.fy_of(v_row.invoice_date),
         status    = 'issued',
         issued_at = now(),
         issued_by = auth.uid(),
         updated_at = now()
   where id = p_id
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  select v_row.enquiry_ref, 'invoice_issued',
         format('%s issued for %s', v_row.number,
                to_char(v_row.total_amount, 'FM999,999,999.00')),
         jsonb_build_object('invoice_id', v_row.id, 'number', v_row.number,
                            'total', v_row.total_amount, 'currency', v_row.currency),
         auth.uid()
   where v_row.enquiry_ref is not null;

  return v_row;
end $fn$;

grant execute on function public.issue_invoice(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The final bill: where a job ended up
--
-- Everything billed, everything it cost, everything collected and paid, and
-- what is left on both sides. Read-only — it is the closing position of a job,
-- not another document to issue.
-- ---------------------------------------------------------------------------
create or replace view public.job_final_bill as
  select s.id as shipment_id,
         s.enquiry_ref,
         s.customer_id,
         s.stage,
         s.console_id,

         coalesce((select sum(case when i.kind = 'credit_note' then -i.total_inr else i.total_inr end)
                     from public.invoices i
                    where i.shipment_id = s.id
                      and i.status in ('issued','part_paid','paid')
                      and i.kind in ('tax_invoice','debit_note','credit_note')), 0) as billed_inr,

         coalesce((select sum(a.amount + a.tds_amount)
                     from public.payment_allocations a
                     join public.payments p on p.id = a.payment_id and p.status = 'confirmed'
                     join public.invoices i on i.id = a.invoice_id
                    where i.shipment_id = s.id), 0) as collected_inr,

         coalesce((select sum(case when b.kind = 'agent_credit_note' then -b.total_inr else b.total_inr end)
                     from public.bills b
                    where b.shipment_id = s.id and b.status <> 'cancelled'), 0) as cost_inr,

         coalesce((select sum(a.amount + a.tds_amount)
                     from public.payment_allocations a
                     join public.payments p on p.id = a.payment_id and p.status = 'confirmed'
                     join public.bills b on b.id = a.bill_id
                    where b.shipment_id = s.id), 0) as paid_out_inr,

         (select count(*) from public.invoices i
           where i.shipment_id = s.id and i.status = 'draft')                as open_drafts,
         (select count(*) from public.bills b
           where b.shipment_id = s.id and b.status in ('received','part_paid')) as unpaid_bills,
         (select count(*) from public.bills b
           where b.shipment_id = s.id and b.status = 'disputed')             as disputed_bills
    from public.shipments s;

grant select on public.job_final_bill to authenticated;
