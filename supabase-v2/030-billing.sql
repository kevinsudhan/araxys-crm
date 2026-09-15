-- ---------------------------------------------------------------------------
-- Billing: invoices with line items, and the party they are addressed to.
--
-- WHAT WAS MISSING
--
-- `shipments.agreed_inr` — one number — was the entire money model. It is read
-- in five places and it answers exactly one question: what did we say we would
-- charge. It cannot answer what we actually billed, what was billed for, what
-- tax applied, what has been paid, or what is still owed.
--
-- WHY THE NUMBER IS NOT A TEXT FIELD
--
-- The reference system this was modelled against has `Invoice No.` as a text
-- box the operator types into, which is how you get `INV110926` — the date,
-- wearing a prefix. Section 31 of the CGST Act read with Rule 46(b) requires a
-- consecutive serial number, unique within a financial year. A human typing
-- into a box cannot produce that, and two people typing into two boxes at the
-- same time definitely cannot.
--
-- So the number is allocated here, under a row lock, and only at the moment of
-- issue. A draft carries no number at all. That is deliberate: a draft that
-- gets abandoned must not burn a number out of the middle of the series, and
-- "gapless" is the part the department actually checks.
--
-- WHY THE BILL-TO PARTY IS COPIED ONTO THE INVOICE
--
-- Same reasoning as 028 copying the agreed terms onto the shipment. An invoice
-- is a statement of what was billed to whom at a point in time. If it read the
-- customer's address through a join, correcting a typo in that address next
-- year would silently rewrite an invoice that has already been sent, filed and
-- possibly assessed. The snapshot is the document; the customer record is where
-- the next invoice gets its defaults from.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. The bill-to party
--
-- `customers` held name, company, phones and emails. None of that can be put
-- on a tax invoice. Missing entirely: a registered address, a GSTIN, and the
-- state — and the state is not cosmetic, it decides whether the tax is CGST +
-- SGST or IGST. Without it the tax treatment of every invoice is a guess.
--
-- On `customers` rather than in a separate ledger table: a second table would
-- need its own identity, its own matching rules against incoming mail, and a
-- reason to exist beyond holding four more columns. When one customer genuinely
-- needs several bill-to addresses, that is the point to split it out.
-- ---------------------------------------------------------------------------
alter table public.customers
  -- The legal name on the invoice, which is not always the trading name the
  -- desk knows them by.
  add column if not exists billing_name       text,
  add column if not exists billing_address    text,
  add column if not exists billing_city       text,
  add column if not exists billing_state      text,
  -- The GST state code, '33' for Tamil Nadu. Two characters, kept as text
  -- because '07' is not 7.
  add column if not exists billing_state_code text,
  add column if not exists billing_pincode    text,
  add column if not exists billing_country    text not null default 'India',

  add column if not exists gstin              text,
  add column if not exists pan                text,
  add column if not exists iec                text,

  -- Where the invoice is emailed, and who it is marked for. Distinct from the
  -- operational contact in `emails` — accounts payable is rarely the person who
  -- sent the enquiry.
  add column if not exists billing_email      text,
  add column if not exists billing_attention  text,

  -- Days from invoice date to due date. Drives the due date and the ageing.
  add column if not exists payment_terms_days int;

-- The first two characters of a GSTIN are the state code, by construction. Where
-- somebody has entered a GSTIN we can fill the state code from it rather than
-- asking for the same fact twice.
update public.customers
   set billing_state_code = substring(gstin from 1 for 2)
 where gstin is not null
   and length(gstin) = 15
   and billing_state_code is null;


-- ---------------------------------------------------------------------------
-- 2. Number allocation
--
-- One row per series per financial year, holding the next number to hand out.
-- Indian financial years run April to March, so an invoice dated 31 March and
-- one dated 1 April belong to different series and must restart at 1.
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_series (
  series       text not null,        -- INV, PRO, CRN, DBN
  fy           text not null,        -- '26-27'
  next_number  int  not null default 1,
  primary key (series, fy)
);

alter table public.invoice_series enable row level security;

/**
 * The financial year a date falls in, as '26-27'.
 *
 * April starts it. A date in January 2027 is in FY 26-27, which is the thing
 * everybody gets wrong when they use the calendar year.
 */
create or replace function public.fy_of(p_date date)
returns text
language sql
immutable
as $fn$
  select case
           when extract(month from p_date) >= 4
             then to_char(p_date, 'YY') || '-' || to_char(p_date + interval '1 year', 'YY')
           else to_char(p_date - interval '1 year', 'YY') || '-' || to_char(p_date, 'YY')
         end;
$fn$;

/**
 * Hands out the next number in a series, and moves the series on.
 *
 * `for update` on the series row is what makes this safe: two people pressing
 * Issue at the same moment queue, and the second one waits for the first to
 * commit rather than reading the same `next_number` and producing a duplicate.
 * A unique index on the number would catch that afterwards, but catching it
 * afterwards means one of them gets an error at the moment they meant to send
 * an invoice.
 *
 * Never call this for a draft. The number is spent the moment it is handed out.
 */
create or replace function public.allocate_invoice_number(p_series text, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_fy  text := public.fy_of(p_date);
  v_n   int;
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

  -- ALG/INV/26-27/0001. The company initials are part of the series so that a
  -- number is identifiable on a customer's remittance advice without context.
  return 'ALG/' || p_series || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $fn$;


-- ---------------------------------------------------------------------------
-- 3. Invoices
--
-- The header. Four kinds share this table because they share every field and
-- differ only in sign, series and what they are called: a credit note is an
-- invoice that reduces what is owed. Separate tables for them — which is what
-- the reference system does, with Debit Note, Credit Note, Overseas Debit Note
-- and Overseas Credit Note as four sibling screens — means four copies of the
-- numbering, the tax logic, the line items and the totals.
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),

  -- Null until issued. The series is chosen up front because it determines
  -- which sequence the number will come from.
  number        text unique,
  series        text not null default 'INV',
  fy            text,

  kind          text not null default 'tax_invoice'
                  check (kind in ('tax_invoice','proforma','credit_note','debit_note')),

  -- draft      — being built, editable, no number
  -- issued     — numbered and sent, immutable
  -- part_paid  — some money received against it
  -- paid       — settled
  -- cancelled  — withdrawn. Never deleted: the number stays spent, because a
  --              gap in the series is the thing that has to be explainable.
  status        text not null default 'draft'
                  check (status in ('draft','issued','part_paid','paid','cancelled')),

  shipment_id   text references public.shipments(id) on delete restrict,
  enquiry_ref   text references public.enquiries(ref) on delete set null,
  customer_id   text not null references public.customers(id) on delete restrict,

  invoice_date  date not null default current_date,
  due_date      date,

  -- ---------------------------------------------------------------- bill to
  -- Snapshotted at issue. See the header note.
  bill_to_name       text not null default '',
  bill_to_address    text not null default '',
  bill_to_gstin      text,
  bill_to_state      text,
  bill_to_state_code text,
  bill_to_country    text not null default 'India',

  -- Who at that organisation it is marked for, and whose account the charges
  -- sit on. These are different: you bill the shipper with the charges on the
  -- consignee's account often enough that it needs its own field.
  attention     text not null default '',
  account_of    text not null default '',

  -- ------------------------------------------------------- shipment context
  -- Copied from the shipment so the invoice reads the same next year as it did
  -- the day it went out. The customer reconciles against the vessel and the
  -- B/L, not against our internal reference.
  bl_number        text,
  bl_date          date,
  vessel_voyage    text,
  movement_type    text,          -- FCL/FCL, LCL/LCL, FCL/LCL
  volume_cbm       numeric,
  gross_weight_kg  numeric,

  -- ------------------------------------------------------------------ money
  currency      text not null default 'INR',
  -- Units of `currency` to one INR is the wrong way round for how anybody
  -- quotes it, so this is INR per one unit of currency: 90.12 for EUR. Stored
  -- on the invoice because the rate used is a fact about the document, not
  -- something to look up again later and get a different answer.
  exchange_rate numeric not null default 1 check (exchange_rate > 0),

  -- Where the supply is deemed to happen. Drives the split below and is a
  -- required field on the invoice itself under Rule 46.
  place_of_supply       text,
  place_of_supply_code  text,

  -- cgst_sgst   — supplier and place of supply in the same state
  -- igst        — different states
  -- export_lut  — export of service, zero-rated, no tax collected (LUT filed)
  -- export_igst — export of service with IGST paid, refund claimed
  -- exempt      — exempt or non-GST supply
  tax_treatment text not null default 'cgst_sgst'
                  check (tax_treatment in ('cgst_sgst','igst','export_lut','export_igst','exempt')),

  -- Maintained by trigger from the lines. Never written by hand.
  taxable_value numeric not null default 0,
  cgst_amount   numeric not null default 0,
  sgst_amount   numeric not null default 0,
  igst_amount   numeric not null default 0,
  total_amount  numeric not null default 0,
  -- The INR equivalent, for the books and the return. Equal to total_amount
  -- when the invoice is already in INR.
  total_inr     numeric not null default 0,

  -- --------------------------------------------------------------- the rest
  description   text not null default '',
  remarks       text not null default '',
  -- Which of our accounts payment should reach. Free text because a bank
  -- account master for one company's two accounts is a table nobody maintains.
  bank_account  text not null default '',

  -- Print the cargo arrival notice detail on the document.
  show_can_details boolean not null default false,
  -- Free-time extension granted to this consignee, where one was. Nullable and
  -- rendered as an em dash when absent — the reference system shows 01/01/1900
  -- here, which is a null that escaped into a form.
  extension_date   date,

  issued_at     timestamptz,
  issued_by     uuid references auth.users(id),
  cancelled_at  timestamptz,
  cancelled_by  uuid references auth.users(id),
  cancel_reason text,

  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists invoices_shipment_idx on public.invoices (shipment_id);
create index if not exists invoices_customer_idx on public.invoices (customer_id, invoice_date desc);
create index if not exists invoices_status_idx   on public.invoices (status);
create index if not exists invoices_due_idx      on public.invoices (due_date) where status in ('issued','part_paid');


-- ---------------------------------------------------------------------------
-- 4. Lines
--
-- The absence the whole of this migration exists to fill. A forwarder's invoice
-- is not one amount: it is ocean freight, terminal handling, documentation, a
-- B/L fee, a delivery order fee, CFS charges — each with its own SAC code and
-- its own tax rate, and the customer queries them individually.
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,

  -- Display order. Operators reorder charges to match how the customer reads
  -- them, and creation order is not that.
  position    int  not null default 0,

  description text not null default '',
  -- Services Accounting Code. 996521 for goods transport support, 996531 for
  -- air, 9965/9967 heads generally. Required per line under Rule 46 once
  -- turnover crosses the threshold.
  sac_code    text,

  quantity    numeric not null default 1,
  -- What the quantity counts: CBM, W/M, per container, per B/L, lumpsum.
  unit        text not null default '',
  rate        numeric not null default 0,

  -- Never typed, never stored inconsistently with its inputs.
  amount      numeric generated always as (round(quantity * rate, 2)) stored,

  -- Per line, because 18% freight and a 0% reimbursement can sit on the same
  -- invoice and a single header rate would make one of them wrong.
  tax_rate    numeric not null default 18 check (tax_rate >= 0),
  -- A disbursement recovered at cost — customs duty paid on the customer's
  -- behalf. Carries no GST because it is not our supply.
  is_reimbursement boolean not null default false,

  created_at  timestamptz not null default now()
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);


-- ---------------------------------------------------------------------------
-- 5. Totals, maintained rather than calculated at render time
--
-- Two screens computing the same total from the same lines will eventually
-- disagree — one rounds per line, the other rounds the sum. Doing it once, in
-- the database, on write, means there is a single answer and the invoice
-- carries it.
--
-- Rounding is per line, then summed. That is the order the tax authority's own
-- worked examples use, and it is the order that makes the printed line amounts
-- add up to the printed total.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_invoice_totals(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inv      public.invoices;
  v_taxable  numeric := 0;
  v_tax      numeric := 0;
begin
  select * into v_inv from public.invoices where id = p_invoice;
  if not found then return; end if;

  select coalesce(sum(amount), 0),
         coalesce(sum(case
                        when is_reimbursement then 0
                        else round(amount * tax_rate / 100, 2)
                      end), 0)
    into v_taxable, v_tax
    from public.invoice_lines
   where invoice_id = p_invoice;

  update public.invoices
     set taxable_value = v_taxable,
         -- An intra-state supply splits the same total tax in half. It is one
         -- rate to the customer and two lines on the return.
         cgst_amount = case when tax_treatment = 'cgst_sgst' then round(v_tax / 2, 2) else 0 end,
         sgst_amount = case when tax_treatment = 'cgst_sgst' then v_tax - round(v_tax / 2, 2) else 0 end,
         igst_amount = case when tax_treatment in ('igst','export_igst') then v_tax else 0 end,
         total_amount = v_taxable + case
                          when tax_treatment in ('export_lut','exempt') then 0
                          else v_tax
                        end,
         total_inr = round((v_taxable + case
                          when tax_treatment in ('export_lut','exempt') then 0
                          else v_tax
                        end) * exchange_rate, 2),
         updated_at = now()
   where id = p_invoice;
end $fn$;

create or replace function public.invoice_lines_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
  v_id     uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  select status into v_status from public.invoices where id = v_id;

  -- An issued invoice is a document somebody has. Editing its lines after the
  -- fact changes what we say we sent them, silently. The way to correct an
  -- issued invoice is a credit note, which is why credit notes are a kind here.
  if v_status is distinct from 'draft' then
    raise exception 'This invoice has been issued and its charges cannot be changed'
      using hint = 'Raise a credit note against it instead.';
  end if;

  perform public.recompute_invoice_totals(v_id);
  return coalesce(new, old);
end $fn$;

drop trigger if exists invoice_lines_totals on public.invoice_lines;
create trigger invoice_lines_totals
  after insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_touch();

-- Changing the treatment or the rate on the header moves every total with it.
create or replace function public.invoices_retotal()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.tax_treatment is distinct from old.tax_treatment
     or new.exchange_rate is distinct from old.exchange_rate then
    perform public.recompute_invoice_totals(new.id);
  end if;
  return new;
end $fn$;

drop trigger if exists invoices_retotal_trg on public.invoices;
create trigger invoices_retotal_trg
  after update on public.invoices
  for each row execute function public.invoices_retotal();


-- ---------------------------------------------------------------------------
-- 6. What the tax treatment should be
--
-- A suggestion, not a decision. Place of supply for the transport of goods is
-- genuinely not a one-liner — section 12 and section 13 of the IGST Act point
-- at different things depending on whether both parties are in India, and the
-- destination of the cargo is not the same question as the location of the
-- recipient. This function gets the common cases right and the operator
-- confirms, which is the same shape as everything else here: the machine
-- proposes, a person presses the button.
-- ---------------------------------------------------------------------------
create or replace function public.suggest_tax_treatment(
  p_country    text,
  p_state_code text
)
returns text
language sql
immutable
as $fn$
  select case
           -- Ours is 33ABDCA2229C1ZD: Tamil Nadu.
           when coalesce(p_country, 'India') <> 'India' then 'export_lut'
           when p_state_code = '33'                     then 'cgst_sgst'
           when p_state_code is null                    then 'cgst_sgst'
           else 'igst'
         end;
$fn$;


-- ---------------------------------------------------------------------------
-- 7. Starting an invoice from a shipment
--
-- Everything this needs is already on the shipment or the customer, and making
-- somebody retype it is how the reference system ends up with a required
-- `House Job(BL) No` text box on a screen reached from the job itself.
--
-- Returns the existing draft if there is one. Pressing "Raise an invoice"
-- twice means "did that work", and a second empty draft is not an answer.
-- ---------------------------------------------------------------------------
create or replace function public.start_invoice(
  p_shipment_id text,
  p_kind        text default 'tax_invoice'
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship public.shipments;
  v_cust public.customers;
  v_row  public.invoices;
  v_series text;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if not found then
    raise exception 'No shipment %', p_shipment_id;
  end if;

  select * into v_cust from public.customers where id = v_ship.customer_id;

  select * into v_row
    from public.invoices
   where shipment_id = p_shipment_id
     and kind = p_kind
     and status = 'draft'
   order by created_at desc
   limit 1;
  if found then
    return v_row;
  end if;

  v_series := case p_kind
                when 'proforma'    then 'PRO'
                when 'credit_note' then 'CRN'
                when 'debit_note'  then 'DBN'
                else 'INV'
              end;

  insert into public.invoices (
    kind, series, shipment_id, enquiry_ref, customer_id,
    bill_to_name, bill_to_address, bill_to_gstin,
    bill_to_state, bill_to_state_code, bill_to_country,
    attention,
    bl_number, bl_date, vessel_voyage, movement_type, volume_cbm, gross_weight_kg,
    place_of_supply, place_of_supply_code,
    tax_treatment,
    due_date,
    created_by
  ) values (
    p_kind, v_series, v_ship.id, v_ship.enquiry_ref, v_ship.customer_id,

    coalesce(nullif(v_cust.billing_name, ''), nullif(v_cust.company, ''), v_cust.name),
    coalesce(v_cust.billing_address, ''),
    v_cust.gstin,
    v_cust.billing_state,
    v_cust.billing_state_code,
    coalesce(v_cust.billing_country, 'India'),
    coalesce(v_cust.billing_attention, ''),

    v_ship.bl_number,
    v_ship.etd,
    nullif(trim(coalesce(v_ship.vessel, '') || ' / ' || coalesce(v_ship.voyage, '')), '/'),
    -- The desk books FCL unless a container was shared. Where the enquiry is on
    -- a sailing, that sailing knows which it is.
    (select sa.mode || '/' || sa.mode
       from public.enquiries e
       join public.sailings sa on sa.id = e.sailing_id
      where e.ref = v_ship.enquiry_ref),
    v_ship.volume_cbm,
    v_ship.gross_weight_kg,

    v_cust.billing_state,
    v_cust.billing_state_code,

    public.suggest_tax_treatment(v_cust.billing_country, v_cust.billing_state_code),

    case
      when v_cust.payment_terms_days is not null
        then current_date + v_cust.payment_terms_days
      else null
    end,

    auth.uid()
  )
  returning * into v_row;

  -- ------------------------------------------------------------------------
  -- The first charge line, from what was actually agreed.
  --
  -- A draft that opens empty makes somebody retype a number that is already in
  -- the database two tables away. The agreed amount on the shipment came off
  -- the accepted quote, so it is the one figure we can put on an invoice line
  -- without anybody guessing.
  --
  -- What it is NOT allowed to do is invent a breakdown. The quote was one
  -- number; splitting it into freight, THC and documentation here would be this
  -- system making up three figures that no customer ever agreed to. So it goes
  -- on as one line saying exactly where it came from, and the desk splits it if
  -- it wants to. The SAC is left empty for the same reason — which code a
  -- charge is filed under is a classification, not a default.
  -- ------------------------------------------------------------------------
  if v_ship.agreed_inr is not null and v_ship.agreed_inr > 0 then
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit, rate)
    values (v_row.id, 1, 'Freight and services as per accepted quotation', 1, 'Lumpsum',
            v_ship.agreed_inr);
    select * into v_row from public.invoices where id = v_row.id;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ship.enquiry_ref, 'invoice_started',
    format('%s draft started for %s', replace(p_kind, '_', ' '), v_ship.id),
    jsonb_build_object('invoice_id', v_row.id, 'shipment_id', v_ship.id),
    auth.uid()
  );

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- 8. Issuing
--
-- The only place a number is allocated, and the point the document stops being
-- editable. Refuses an invoice with nothing on it: an invoice for zero is
-- either a mistake or a way of burning a serial number, and neither should be
-- one button press away.
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

  -- A proforma is not a tax invoice and does not consume the statutory series.
  -- It gets its own sequence so that neither one has a gap in it.
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
  values (
    v_row.enquiry_ref, 'invoice_issued',
    format('%s issued for %s', v_row.number,
           to_char(v_row.total_amount, 'FM999,999,999.00')),
    jsonb_build_object('invoice_id', v_row.id, 'number', v_row.number,
                       'total', v_row.total_amount, 'currency', v_row.currency),
    auth.uid()
  );

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- 9. Cancelling
--
-- Marks, never deletes. The number stays spent and the row stays readable,
-- because "why does the series jump from 0041 to 0043" is a question somebody
-- will be asked to answer, possibly years later.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_invoice(p_id uuid, p_reason text default '')
returns public.invoices
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.invoices;
begin
  update public.invoices
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = auth.uid(),
         cancel_reason = coalesce(p_reason, ''),
         updated_at    = now()
   where id = p_id
     and status <> 'cancelled'
  returning * into v_row;

  if not found then
    raise exception 'No open invoice %', p_id;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_row.enquiry_ref, 'invoice_cancelled',
    format('%s cancelled', coalesce(v_row.number, 'Draft invoice')),
    jsonb_build_object('invoice_id', v_row.id, 'reason', p_reason),
    auth.uid()
  );

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- 10. Row Level Security
--
-- Same shape as the rest of the operational schema: any signed-in member of the
-- desk, nothing for anon.
--
-- Deletes: granted on lines, because building a draft means removing a charge
-- you added by mistake, and the trigger already refuses once the invoice is
-- issued. Not granted on invoices — cancel is the operation, and it keeps the
-- number accounted for.
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['invoices','invoice_lines','invoice_series'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)',
                   t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)',
                   t || '_update', t);
  end loop;
end $rls$;

drop policy if exists invoice_lines_delete on public.invoice_lines;
create policy invoice_lines_delete on public.invoice_lines
  for delete to authenticated using (true);

revoke all on public.invoices      from anon;
revoke all on public.invoice_lines from anon;
revoke all on public.invoice_series from anon;

grant execute on function public.fy_of(date)                       to authenticated;
grant execute on function public.suggest_tax_treatment(text, text) to authenticated;
grant execute on function public.start_invoice(text, text)         to authenticated;
grant execute on function public.issue_invoice(uuid)               to authenticated;
grant execute on function public.cancel_invoice(uuid, text)        to authenticated;

-- Deliberately not granted: allocating a number is something `issue_invoice`
-- does as part of issuing, and nothing else has a reason to spend one.
revoke execute on function public.allocate_invoice_number(text, date) from authenticated;


-- ---------------------------------------------------------------------------
-- 11. What each shipment has been billed
--
-- A view rather than columns on the shipment, because it is a summary of rows
-- that change underneath it. Cancelled invoices are excluded from the totals
-- but the row still exists to be read.
-- ---------------------------------------------------------------------------
create or replace view public.shipment_billing as
  select s.id as shipment_id,
         count(i.id) filter (where i.status <> 'cancelled' and i.kind = 'tax_invoice') as invoice_count,
         count(i.id) filter (where i.status = 'draft')                                 as draft_count,
         coalesce(sum(i.total_inr) filter (
           where i.status in ('issued','part_paid','paid') and i.kind = 'tax_invoice'
         ), 0) as billed_inr
    from public.shipments s
    left join public.invoices i on i.shipment_id = s.id
   group by s.id;

grant select on public.shipment_billing to authenticated;
