-- ---------------------------------------------------------------------------
-- The buy side: what the carrier and the overseas agent bill us.
--
-- WHY THIS IS THE PIECE EVERYTHING ELSE WAITED ON
--
-- A consolidator's business is the gap between what the shipper pays and what
-- the line and the agent charge. Until now this system held only the first
-- half, which means it could tell you revenue and could not tell you whether
-- any of it was profitable. Nine screens in the reference system's menus —
-- Payables Report, Overseas Debit Note, Overseas Credit Note, Overseas Agent
-- SOA and all four P/L reports — are the same missing table.
--
-- WHY A BILL IS NOT AN INVOICE WITH THE SIGN FLIPPED
--
-- They look alike and behave differently in the ways that matter.
--
-- Our invoice number is ours, allocated from a locked series, gapless because
-- the law requires it. A bill carries THEIR number, typed in as it appears on
-- their document, and there is nothing to allocate.
--
-- Our invoice is immutable once issued because somebody has it. A bill is a
-- claim made against us that we may dispute, part-pay or reject.
--
-- The tax runs the other way: output tax on an invoice is what we owe the
-- government; input tax on a bill is what we reclaim, and on a service bought
-- from an overseas agent there is no input tax at all — we pay it ourselves
-- under reverse charge and reclaim that.
--
-- One table with a direction flag would need a branch at every one of those.
-- ---------------------------------------------------------------------------

create table if not exists public.bills (
  id           uuid primary key default gen_random_uuid(),

  -- Theirs, as printed on their document. Not allocated here.
  bill_no      text not null,
  bill_date    date not null default current_date,
  -- When it landed on the desk, which is not when they dated it and is what
  -- an ageing report on our side should really count from.
  received_at  date not null default current_date,
  due_date     date,

  -- carrier_invoice     — ocean freight, THC, the line's own charges
  -- agent_debit_note    — the overseas agent billing us their half
  -- agent_credit_note   — the agent crediting something back, so it reduces
  -- vendor_invoice      — transport, CFS, CHA, anybody else
  kind         text not null default 'vendor_invoice'
                 check (kind in ('carrier_invoice','agent_debit_note',
                                 'agent_credit_note','vendor_invoice')),

  -- received  — recorded, owed
  -- disputed  — we are not paying this until something is resolved. Distinct
  --             from unpaid: an ageing report that counts a disputed bill as
  --             overdue is telling you off for something you decided.
  status       text not null default 'received'
                 check (status in ('draft','received','part_paid','paid',
                                   'disputed','cancelled')),

  partner_id   uuid not null references public.partners(id) on delete restrict,

  -- What it is against. Both nullable and both useful: a carrier bills per
  -- master, an agent bills per master, a transporter bills per shipment, and an
  -- office expense is against neither.
  shipment_id  text references public.shipments(id) on delete set null,
  console_id   uuid references public.consoles(id)  on delete set null,

  currency      text not null default 'INR',
  -- INR per one unit of currency, snapshotted. An agent's debit note in USD
  -- settled three weeks later is not worth what it was worth on the day, and
  -- which rate was used is a fact about the document.
  exchange_rate numeric not null default 1 check (exchange_rate > 0),

  -- Maintained by trigger from the lines.
  taxable_value numeric not null default 0,
  tax_amount    numeric not null default 0,
  total_amount  numeric not null default 0,
  total_inr     numeric not null default 0,

  -- Import of a service from an overseas agent: no Indian tax appears on their
  -- document, we pay it ourselves and reclaim it. It changes what the return
  -- says without changing what we hand over, so it is a flag and not a rate.
  reverse_charge boolean not null default false,
  -- Their GSTIN, for matching this against what appears in GSTR-2B.
  vendor_gstin   text,

  remarks      text not null default '',

  disputed_reason text,
  recorded_by  uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- The classic accounts-payable error is paying the same bill twice, and it
  -- happens because it was entered twice. One number per vendor.
  unique (partner_id, bill_no)
);

create index if not exists bills_partner_idx  on public.bills (partner_id, bill_date desc);
create index if not exists bills_shipment_idx on public.bills (shipment_id);
create index if not exists bills_console_idx  on public.bills (console_id);
create index if not exists bills_status_idx   on public.bills (status);

create table if not exists public.bill_lines (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references public.bills(id) on delete cascade,
  position    int  not null default 0,

  description text not null default '',
  sac_code    text,
  quantity    numeric not null default 1,
  unit        text not null default '',
  rate        numeric not null default 0,
  amount      numeric generated always as (round(quantity * rate, 2)) stored,
  tax_rate    numeric not null default 0 check (tax_rate >= 0),

  created_at  timestamptz not null default now()
);

create index if not exists bill_lines_bill_idx on public.bill_lines (bill_id, position);


-- ---------------------------------------------------------------------------
-- Totals
--
-- Same shape as the invoice side and for the same reason: two screens computing
-- a total from the same lines will eventually disagree about rounding.
--
-- Under reverse charge the tax is NOT added to what we hand over — the vendor's
-- document has no tax on it. We pay that tax to the government separately and
-- reclaim it, so it is tracked and excluded from the total.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_bill_totals(p_bill uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_bill    public.bills;
  v_taxable numeric := 0;
  v_tax     numeric := 0;
begin
  select * into v_bill from public.bills where id = p_bill;
  if not found then return; end if;

  select coalesce(sum(amount), 0),
         coalesce(sum(round(amount * tax_rate / 100, 2)), 0)
    into v_taxable, v_tax
    from public.bill_lines
   where bill_id = p_bill;

  update public.bills
     set taxable_value = v_taxable,
         tax_amount    = v_tax,
         total_amount  = v_taxable + case when v_bill.reverse_charge then 0 else v_tax end,
         total_inr     = round(
           (v_taxable + case when v_bill.reverse_charge then 0 else v_tax end)
           * v_bill.exchange_rate, 2),
         updated_at    = now()
   where id = p_bill;
end $fn$;

create or replace function public.bill_lines_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_id uuid := coalesce(new.bill_id, old.bill_id);
begin
  perform public.recompute_bill_totals(v_id);
  return coalesce(new, old);
end $fn$;

drop trigger if exists bill_lines_totals on public.bill_lines;
create trigger bill_lines_totals
  after insert or update or delete on public.bill_lines
  for each row execute function public.bill_lines_touch();

create or replace function public.bills_retotal()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.exchange_rate is distinct from old.exchange_rate
     or new.reverse_charge is distinct from old.reverse_charge then
    perform public.recompute_bill_totals(new.id);
  end if;
  return new;
end $fn$;

drop trigger if exists bills_retotal_trg on public.bills;
create trigger bills_retotal_trg
  after update on public.bills
  for each row execute function public.bills_retotal();


-- ---------------------------------------------------------------------------
-- Paying them
--
-- The allocation table already exists and already knows how to spread one
-- amount over several documents and record tax withheld against each. Money
-- out is the same act pointed the other way: we deduct TDS when we pay a
-- transporter exactly as our customers deduct it when they pay us.
--
-- So rather than a second allocation table, an allocation now points at either
-- an invoice or a bill — exactly one of them.
-- ---------------------------------------------------------------------------
alter table public.payment_allocations
  alter column invoice_id drop not null,
  add column if not exists bill_id uuid references public.bills(id) on delete restrict;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'payalloc_one_target' and conrelid = 'public.payment_allocations'::regclass
  ) then
    alter table public.payment_allocations
      add constraint payalloc_one_target
      check ((invoice_id is not null) <> (bill_id is not null));
  end if;
end $$;

create index if not exists payalloc_bill_idx on public.payment_allocations (bill_id);

-- The uniqueness that stopped an invoice appearing twice on one receipt has to
-- cover the other side too.
create unique index if not exists payalloc_once_per_bill
  on public.payment_allocations (payment_id, bill_id) where bill_id is not null;


create or replace function public.recompute_bill_settlement(p_bill uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_bill    public.bills;
  v_settled numeric;
begin
  select * into v_bill from public.bills where id = p_bill;
  if not found then return; end if;

  select coalesce(sum(a.amount + a.tds_amount), 0) into v_settled
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
   where a.bill_id = p_bill and p.status = 'confirmed';

  -- A disputed or cancelled bill keeps its status whatever lands against it:
  -- a part payment made while a dispute is open does not settle the dispute.
  if v_bill.status in ('disputed','cancelled','draft') then
    return;
  end if;

  update public.bills
     set status = case
                    when v_settled <= 0                            then 'received'
                    when v_settled + 0.005 >= v_bill.total_amount   then 'paid'
                    else 'part_paid'
                  end,
         updated_at = now()
   where id = p_bill;
end $fn$;

-- Replaces the invoice-only version from 034: an allocation now moves whichever
-- document it points at.
create or replace function public.allocation_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce(new.invoice_id, old.invoice_id) is not null then
    perform public.recompute_invoice_settlement(coalesce(new.invoice_id, old.invoice_id));
    if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id
       and old.invoice_id is not null then
      perform public.recompute_invoice_settlement(old.invoice_id);
    end if;
  end if;

  if coalesce(new.bill_id, old.bill_id) is not null then
    perform public.recompute_bill_settlement(coalesce(new.bill_id, old.bill_id));
    if tg_op = 'UPDATE' and new.bill_id is distinct from old.bill_id
       and old.bill_id is not null then
      perform public.recompute_bill_settlement(old.bill_id);
    end if;
  end if;

  return coalesce(new, old);
end $fn$;

-- Same for confirming or cancelling the payment itself.
create or replace function public.payment_status_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare r record;
begin
  if new.status is distinct from old.status then
    for r in select invoice_id, bill_id from public.payment_allocations
              where payment_id = new.id loop
      if r.invoice_id is not null then
        perform public.recompute_invoice_settlement(r.invoice_id);
      end if;
      if r.bill_id is not null then
        perform public.recompute_bill_settlement(r.bill_id);
      end if;
    end loop;
  end if;
  return new;
end $fn$;


-- ---------------------------------------------------------------------------
-- Billing the overseas agent
--
-- An overseas debit note is a sale, not a purchase — we are charging the agent
-- their share of a job we handled. So it belongs on the invoice side, and the
-- only thing the invoice table lacked was the ability to address one to a
-- partner rather than a customer.
-- ---------------------------------------------------------------------------
alter table public.invoices
  alter column customer_id drop not null,
  add column if not exists partner_id uuid references public.partners(id) on delete restrict,
  add column if not exists console_id uuid references public.consoles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'invoices_has_a_party' and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_has_a_party
      check (customer_id is not null or partner_id is not null);
  end if;
end $$;

create index if not exists invoices_partner_idx on public.invoices (partner_id);


-- ---------------------------------------------------------------------------
-- What a job made
--
-- Revenue less cost, per shipment and per console. This is the P/L the
-- reference system spreads across four menu entries, and it is one subtraction
-- once both sides exist.
--
-- Credit notes subtract on both sides. A cancelled document counts for nothing.
-- ---------------------------------------------------------------------------
create or replace view public.shipment_margin as
  select s.id as shipment_id,
         s.console_id,
         coalesce((
           select sum(case when i.kind = 'credit_note' then -i.total_inr else i.total_inr end)
             from public.invoices i
            where i.shipment_id = s.id
              and i.status in ('issued','part_paid','paid')
              and i.kind in ('tax_invoice','debit_note','credit_note')
         ), 0) as revenue_inr,
         coalesce((
           select sum(case when b.kind = 'agent_credit_note' then -b.total_inr else b.total_inr end)
             from public.bills b
            where b.shipment_id = s.id
              and b.status <> 'cancelled'
         ), 0) as cost_inr
    from public.shipments s;

grant select on public.shipment_margin to authenticated;

/**
 * The same question asked of a whole console.
 *
 * Costs attach at both levels and must not be counted twice: a carrier bills
 * the master, a transporter bills one shipment. So a console's cost is the
 * bills raised against the console itself PLUS the bills raised against the
 * shipments on it.
 */
create or replace view public.console_margin as
  select c.id as console_id,
         c.console_no,
         coalesce((
           select sum(case when i.kind = 'credit_note' then -i.total_inr else i.total_inr end)
             from public.invoices i
             join public.shipments s on s.id = i.shipment_id
            where s.console_id = c.id
              and i.status in ('issued','part_paid','paid')
              and i.kind in ('tax_invoice','debit_note','credit_note')
         ), 0)
         + coalesce((
           select sum(case when i.kind = 'credit_note' then -i.total_inr else i.total_inr end)
             from public.invoices i
            where i.console_id = c.id
              and i.status in ('issued','part_paid','paid')
         ), 0) as revenue_inr,

         coalesce((
           select sum(case when b.kind = 'agent_credit_note' then -b.total_inr else b.total_inr end)
             from public.bills b
            where b.console_id = c.id and b.status <> 'cancelled'
         ), 0)
         + coalesce((
           select sum(case when b.kind = 'agent_credit_note' then -b.total_inr else b.total_inr end)
             from public.bills b
             join public.shipments s on s.id = b.shipment_id
            where s.console_id = c.id
              and b.console_id is null
              and b.status <> 'cancelled'
         ), 0) as cost_inr
    from public.consoles c;

grant select on public.console_margin to authenticated;

/** Where each vendor and agent stands with us. */
create or replace view public.partner_balances as
  select p.id as partner_id,
         coalesce(nullif(p.organisation, ''), p.name) as label,
         coalesce((
           select sum(case when b.kind = 'agent_credit_note' then -b.total_inr else b.total_inr end)
             from public.bills b
            where b.partner_id = p.id and b.status not in ('cancelled','draft')
         ), 0) as billed_to_us,
         coalesce((
           select sum(a.amount + a.tds_amount)
             from public.payment_allocations a
             join public.payments pay on pay.id = a.payment_id and pay.status = 'confirmed'
             join public.bills b on b.id = a.bill_id
            where b.partner_id = p.id
         ), 0) as settled,
         coalesce((
           select count(*) from public.bills b
            where b.partner_id = p.id and b.status in ('received','part_paid')
         ), 0) as open_bills,
         coalesce((
           select count(*) from public.bills b
            where b.partner_id = p.id and b.status = 'disputed'
         ), 0) as disputed_bills
    from public.partners p;

grant select on public.partner_balances to authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['bills','bill_lines'] loop
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

-- Lines may be removed while building the record of somebody else's document.
-- The bill itself is cancelled, never deleted: it is evidence of a claim made.
drop policy if exists bill_lines_delete on public.bill_lines;
create policy bill_lines_delete on public.bill_lines for delete to authenticated using (true);

revoke all on public.bills      from anon;
revoke all on public.bill_lines from anon;
