-- ---------------------------------------------------------------------------
-- Money in and money out, and what it settles.
--
-- WHY ONE TABLE WITH A DIRECTION
--
-- The reference system has Receipts and Payments as two screens, and Overseas
-- Debit Note and Overseas Credit Note as two more. They are the same record:
-- an amount, a date, a party, an instrument, and a list of what it settles.
-- Two tables means two numbering schemes, two allocation tables, two sets of
-- triggers, and the one that gets a fix is whichever somebody was looking at.
--
-- WHY TDS IS NOT OPTIONAL
--
-- An Indian customer settling a 17,000 invoice pays 16,830 and remits 170 to
-- the government against our PAN. Without somewhere to record that, the invoice
-- is short by 170 for ever: it never reaches paid, it sits in the ageing report
-- until somebody writes it off, and every receivables total in the business is
-- quietly wrong by the sum of everybody's TDS.
--
-- It is per allocation rather than per receipt because TDS is deducted per
-- invoice, at a rate that depends on what the invoice was for.
--
-- WHY AN ADVANCE IS JUST AN UNALLOCATED RECEIPT
--
-- Money arrives before the invoice does. Rather than a separate advances table
-- with its own rules for being drawn down, a receipt simply need not allocate
-- all of itself — and what is left over IS the advance. Applying it later is
-- adding an allocation, which is why allocations stay editable after a receipt
-- is confirmed while the receipt's own amount and date do not.
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),

  -- Null until confirmed, same as an invoice: a draft that is abandoned must
  -- not take a number out of the middle of the series.
  number       text unique,
  series       text not null default 'RCT',        -- RCT in, PMT out
  fy           text,

  -- in  — a receipt: a customer has paid us
  -- out — a payment: we have paid a carrier, an agent, or a refund
  direction    text not null check (direction in ('in','out')),

  status       text not null default 'draft'
                 check (status in ('draft','confirmed','cancelled')),

  payment_date date not null default current_date,

  -- Who the money is with. One or the other, depending on direction; both are
  -- nullable because a receipt can arrive before anybody has worked out whose
  -- it is, and that is exactly when it needs recording.
  customer_id  text references public.customers(id) on delete restrict,
  partner_id   uuid references public.partners(id)  on delete restrict,

  -- Who actually handed it over, when that is not who owes it. A parent company
  -- settling for a subsidiary is common enough to need its own field, and
  -- overwriting the customer with it would lose who the debt belonged to.
  paid_by      text not null default '',

  -- The cash that moved. TDS is NOT part of this: it never reached our bank.
  amount       numeric not null default 0 check (amount >= 0),
  currency     text not null default 'INR',
  exchange_rate numeric not null default 1 check (exchange_rate > 0),

  mode         text not null default 'bank_transfer'
                 check (mode in ('bank_transfer','cheque','cash','upi',
                                 'from_advance','adjustment','other')),
  -- Cheque or reference number, and the bank it is drawn on.
  instrument_no   text not null default '',
  drawn_on        text not null default '',
  instrument_date date,

  remarks      text not null default '',

  confirmed_at  timestamptz,
  confirmed_by  uuid references auth.users(id),
  cancelled_at  timestamptz,
  cancelled_by  uuid references auth.users(id),
  cancel_reason text,

  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists payments_customer_idx  on public.payments (customer_id, payment_date desc);
create index if not exists payments_partner_idx   on public.payments (partner_id, payment_date desc);
create index if not exists payments_direction_idx on public.payments (direction, status);


-- ---------------------------------------------------------------------------
-- What each receipt settles
--
-- One row per invoice a receipt is applied to. The reference system's own
-- screen shows why this cannot be a column: a single receipt of 17,196 settles
-- one invoice of 17,000 and another of 196, from two different bookings.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.payments(id) on delete cascade,
  invoice_id  uuid not null references public.invoices(id) on delete restrict,

  -- Cash applied to this invoice out of the receipt.
  amount      numeric not null default 0 check (amount >= 0),

  -- Tax the payer withheld on this invoice and remitted to the government.
  -- It settles the invoice without ever being cash we received, which is the
  -- whole reason it is a separate column and not folded into `amount`.
  tds_amount  numeric not null default 0 check (tds_amount >= 0),

  created_at  timestamptz not null default now(),

  -- One line per invoice per receipt. Two lines for the same invoice would be
  -- a data entry slip, and summing them is not a feature anybody wants.
  unique (payment_id, invoice_id)
);

create index if not exists payalloc_invoice_idx on public.payment_allocations (invoice_id);


-- ---------------------------------------------------------------------------
-- A receipt cannot give out more cash than it took in
--
-- The hard invariant. TDS is deliberately outside it: the payer withheld that
-- money, so it settles an invoice without having been part of the cash.
-- ---------------------------------------------------------------------------
create or replace function public.check_allocation_fits()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pay    public.payments;
  v_alloc  numeric;
begin
  select * into v_pay from public.payments where id = new.payment_id;

  if v_pay.status = 'cancelled' then
    raise exception 'That receipt has been cancelled and cannot be applied to anything';
  end if;

  -- The row being written is not in the table yet on INSERT, and still holds
  -- its old amount on UPDATE, so neither is counted by a plain sum. Excluding
  -- this row by id and adding the incoming amount covers both: on INSERT the id
  -- matches nothing (the default has already been applied by the time a BEFORE
  -- trigger runs), and on UPDATE it excludes the stale value.
  select coalesce(sum(amount), 0) into v_alloc
    from public.payment_allocations
   where payment_id = v_pay.id
     and id <> new.id;

  v_alloc := v_alloc + new.amount;

  if v_alloc > v_pay.amount + 0.005 then
    raise exception 'Applying % would be more than the % received',
                    to_char(v_alloc, 'FM999,999,999.00'),
                    to_char(v_pay.amount, 'FM999,999,999.00')
      using hint = 'Reduce one of the lines, or raise the amount on the receipt itself.';
  end if;

  return new;
end $fn$;


-- ---------------------------------------------------------------------------
-- Moving an invoice to part paid or paid
--
-- Only confirmed receipts count. A draft receipt is somebody typing, and an
-- invoice that flickers to "paid" because of a half-entered one is worse than
-- an invoice that waits.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_invoice_settlement(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_inv     public.invoices;
  v_settled numeric;
begin
  select * into v_inv from public.invoices where id = p_invoice;
  if not found then return; end if;

  -- Cash plus withheld tax. Both discharge the debt.
  select coalesce(sum(a.amount + a.tds_amount), 0) into v_settled
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
   where a.invoice_id = p_invoice
     and p.status = 'confirmed';

  -- A cancelled invoice stays cancelled whatever lands against it, and a draft
  -- cannot be paid because nobody has been asked for the money yet.
  if v_inv.status in ('cancelled','draft') then
    return;
  end if;

  update public.invoices
     set status = case
                    when v_settled <= 0                        then 'issued'
                    when v_settled + 0.005 >= v_inv.total_amount then 'paid'
                    else 'part_paid'
                  end,
         updated_at = now()
   where id = p_invoice;
end $fn$;

create or replace function public.allocation_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.recompute_invoice_settlement(coalesce(new.invoice_id, old.invoice_id));
  -- Moving an allocation from one invoice to another has to release the first.
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    perform public.recompute_invoice_settlement(old.invoice_id);
  end if;
  return coalesce(new, old);
end $fn$;

drop trigger if exists payalloc_fits on public.payment_allocations;
create trigger payalloc_fits
  before insert or update on public.payment_allocations
  for each row execute function public.check_allocation_fits();

drop trigger if exists payalloc_settle on public.payment_allocations;
create trigger payalloc_settle
  after insert or update or delete on public.payment_allocations
  for each row execute function public.allocation_touch();

/** Confirming or cancelling a receipt moves every invoice it touches. */
create or replace function public.payment_status_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_inv uuid;
begin
  if new.status is distinct from old.status then
    for v_inv in select invoice_id from public.payment_allocations where payment_id = new.id loop
      perform public.recompute_invoice_settlement(v_inv);
    end loop;
  end if;
  return new;
end $fn$;

drop trigger if exists payments_status_trg on public.payments;
create trigger payments_status_trg
  after update on public.payments
  for each row execute function public.payment_status_touch();


-- ---------------------------------------------------------------------------
-- Starting one
--
-- `p_invoice` is optional and is the common case: you are looking at an unpaid
-- invoice and pressing "record a receipt". It fills the customer, the amount
-- still outstanding, and the allocation line — so the ordinary receipt is one
-- press and a confirm rather than a screen of typing.
-- ---------------------------------------------------------------------------
create or replace function public.start_payment(
  p_direction  text,
  p_customer   text default null,
  p_partner    uuid default null,
  p_invoice    uuid default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row      public.payments;
  v_inv      public.invoices;
  v_due      numeric;
  v_customer text := p_customer;
begin
  if p_invoice is not null then
    select * into v_inv from public.invoices where id = p_invoice;
    if not found then
      raise exception 'No invoice %', p_invoice;
    end if;
    v_customer := coalesce(v_customer, v_inv.customer_id);

    select v_inv.total_amount - coalesce(sum(a.amount + a.tds_amount), 0)
      into v_due
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
     where a.invoice_id = p_invoice and p.status = 'confirmed';

    v_due := greatest(coalesce(v_due, v_inv.total_amount), 0);
  end if;

  insert into public.payments (direction, series, customer_id, partner_id, amount, created_by)
  values (
    p_direction,
    case when p_direction = 'in' then 'RCT' else 'PMT' end,
    v_customer,
    p_partner,
    coalesce(v_due, 0),
    auth.uid()
  )
  returning * into v_row;

  -- The allocation that the receipt was opened to make. Amount only: how much
  -- of it is TDS is something only the payer's advice says, so it starts at
  -- zero rather than being guessed at a rate nobody stated.
  if p_invoice is not null and coalesce(v_due, 0) > 0 then
    insert into public.payment_allocations (payment_id, invoice_id, amount)
    values (v_row.id, p_invoice, v_due);
  end if;

  return v_row;
end $fn$;


create or replace function public.confirm_payment(p_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row   public.payments;
  v_alloc numeric;
begin
  select * into v_row from public.payments where id = p_id;
  if not found then
    raise exception 'No receipt %', p_id;
  end if;
  if v_row.status <> 'draft' then
    raise exception 'That was already confirmed as %', coalesce(v_row.number, '(numbered)');
  end if;
  if v_row.amount <= 0 then
    raise exception 'The amount is zero'
      using hint = 'Enter what was actually received before confirming it.';
  end if;

  select coalesce(sum(amount), 0) into v_alloc
    from public.payment_allocations where payment_id = p_id;

  update public.payments
     set number       = public.allocate_invoice_number(v_row.series, v_row.payment_date),
         fy           = public.fy_of(v_row.payment_date),
         status       = 'confirmed',
         confirmed_at = now(),
         confirmed_by = auth.uid(),
         updated_at   = now()
   where id = p_id
  returning * into v_row;

  -- Anything not applied is an advance sitting on the customer's account. It is
  -- not an error and it is not lost: it shows on their balance and is applied
  -- by adding an allocation later.
  if v_alloc < v_row.amount then
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    select distinct i.enquiry_ref, 'receipt_recorded',
           format('%s received, %s left on account', v_row.number,
                  to_char(v_row.amount - v_alloc, 'FM999,999,999.00')),
           jsonb_build_object('payment_id', v_row.id, 'on_account', v_row.amount - v_alloc),
           auth.uid()
      from public.payment_allocations a
      join public.invoices i on i.id = a.invoice_id
     where a.payment_id = p_id and i.enquiry_ref is not null;
  else
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    select distinct i.enquiry_ref, 'receipt_recorded',
           format('%s received against %s', v_row.number, coalesce(i.number, 'a draft')),
           jsonb_build_object('payment_id', v_row.id, 'amount', v_row.amount),
           auth.uid()
      from public.payment_allocations a
      join public.invoices i on i.id = a.invoice_id
     where a.payment_id = p_id and i.enquiry_ref is not null;
  end if;

  return v_row;
end $fn$;


create or replace function public.cancel_payment(p_id uuid, p_reason text default '')
returns public.payments
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.payments;
begin
  update public.payments
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = auth.uid(),
         cancel_reason = coalesce(p_reason, ''),
         updated_at    = now()
   where id = p_id and status <> 'cancelled'
  returning * into v_row;

  if not found then
    raise exception 'No open receipt %', p_id;
  end if;

  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- What is settled, and what is still owed
-- ---------------------------------------------------------------------------
create or replace view public.invoice_settlement as
  select i.id as invoice_id,
         i.customer_id,
         i.total_amount,
         coalesce(sum(a.amount)     filter (where p.status = 'confirmed'), 0) as cash_received,
         coalesce(sum(a.tds_amount) filter (where p.status = 'confirmed'), 0) as tds_withheld,
         i.total_amount
           - coalesce(sum(a.amount + a.tds_amount) filter (where p.status = 'confirmed'), 0)
           as outstanding
    from public.invoices i
    left join public.payment_allocations a on a.invoice_id = i.id
    left join public.payments p on p.id = a.payment_id
   where i.status <> 'cancelled'
   group by i.id;

grant select on public.invoice_settlement to authenticated;

/**
 * Where each customer stands.
 *
 * `on_account` is the advance: confirmed money in that has not been applied to
 * anything. It reduces what they effectively owe without belonging to any
 * invoice, which is why it cannot be derived from the invoices alone.
 */
create or replace view public.customer_balances as
  with billed as (
    select customer_id,
           coalesce(sum(total_amount), 0) as billed,
           coalesce(sum(case when status in ('issued','part_paid') then 1 else 0 end), 0) as open_count
      from public.invoices
     where status in ('issued','part_paid','paid') and kind = 'tax_invoice'
     group by customer_id
  ),
  settled as (
    select i.customer_id,
           coalesce(sum(a.amount), 0)     as cash_received,
           coalesce(sum(a.tds_amount), 0) as tds_withheld
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and p.status = 'confirmed'
      join public.invoices i on i.id = a.invoice_id
     group by i.customer_id
  ),
  advances as (
    select p.customer_id,
           coalesce(sum(p.amount), 0)
             - coalesce(sum((select coalesce(sum(a.amount), 0)
                               from public.payment_allocations a
                              where a.payment_id = p.id)), 0) as on_account
      from public.payments p
     where p.direction = 'in' and p.status = 'confirmed' and p.customer_id is not null
     group by p.customer_id
  )
  select c.id as customer_id,
         coalesce(c.billing_name, nullif(c.company, ''), c.name) as label,
         coalesce(b.billed, 0)          as billed,
         coalesce(s.cash_received, 0)   as cash_received,
         coalesce(s.tds_withheld, 0)    as tds_withheld,
         coalesce(b.billed, 0) - coalesce(s.cash_received, 0) - coalesce(s.tds_withheld, 0)
           as outstanding,
         coalesce(adv.on_account, 0)    as on_account,
         coalesce(b.open_count, 0)      as open_invoices
    from public.customers c
    left join billed   b   on b.customer_id = c.id
    left join settled  s   on s.customer_id = c.id
    left join advances adv on adv.customer_id = c.id;

grant select on public.customer_balances to authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Allocations may be deleted: unapplying an advance from the wrong invoice is
-- a correction, and the receipt itself is untouched by it. Receipts may not —
-- cancel is the operation, because the number stays spent.
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['payments','payment_allocations'] loop
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

drop policy if exists payalloc_delete on public.payment_allocations;
create policy payalloc_delete on public.payment_allocations
  for delete to authenticated using (true);

revoke all on public.payments            from anon;
revoke all on public.payment_allocations from anon;

grant execute on function public.start_payment(text, text, uuid, uuid) to authenticated;
grant execute on function public.confirm_payment(uuid)                 to authenticated;
grant execute on function public.cancel_payment(uuid, text)            to authenticated;
