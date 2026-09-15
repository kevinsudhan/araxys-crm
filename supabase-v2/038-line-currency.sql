-- ---------------------------------------------------------------------------
-- A currency per charge line, and its INR equivalent.
--
-- WHY THE CURRENCY MOVED OFF THE HEADER
--
-- 030 put one currency on the invoice, which is how a simple bill works and is
-- not how a freight bill works. Ocean freight is quoted and paid in dollars;
-- the terminal handling, the documentation fee and the CFS charge are in
-- rupees. They appear on the same invoice because they are the same job.
--
-- So each line carries its own currency and the rate used to convert it, and
-- the invoice totals in INR. That is exactly what the reference system's grid
-- does — Charges, CUR, Amount, Amount(INR), with the total footing the INR
-- column — and it is the only arrangement where the total means anything when
-- the lines disagree.
--
-- WHY THE RATE IS ON THE LINE AND NOT LOOKED UP
--
-- Same reason it is on the invoice and on the bill: the rate used is a fact
-- about the document. An invoice re-opened next quarter has to show what was
-- charged, not what the conversion would be today.
--
-- The invoice's own `currency` stays, demoted to the default a new line starts
-- with — which on this desk is INR and on an overseas debit note is USD.
-- ---------------------------------------------------------------------------

alter table public.invoice_lines
  add column if not exists currency text not null default 'INR',
  -- INR per one unit of `currency`. 1 for rupee lines, so the arithmetic below
  -- needs no special case for them.
  add column if not exists fx_rate  numeric not null default 1 check (fx_rate > 0);

-- Generated rather than maintained: it is a pure function of three columns on
-- the same row, and a stored copy that anything could write would drift.
alter table public.invoice_lines
  add column if not exists amount_inr numeric
    generated always as (round(quantity * rate * fx_rate, 2)) stored;


-- ---------------------------------------------------------------------------
-- Totals, now footed in INR
--
-- Replaces the version in 030. The only change is that every sum is over
-- `amount_inr` rather than `amount`: with mixed currencies on one document,
-- adding the raw amounts together would produce a number in no currency at all.
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

  select coalesce(sum(amount_inr), 0),
         coalesce(sum(case
                        when is_reimbursement then 0
                        else round(amount_inr * tax_rate / 100, 2)
                      end), 0)
    into v_taxable, v_tax
    from public.invoice_lines
   where invoice_id = p_invoice;

  update public.invoices
     set taxable_value = v_taxable,
         cgst_amount = case when tax_treatment = 'cgst_sgst' then round(v_tax / 2, 2) else 0 end,
         sgst_amount = case when tax_treatment = 'cgst_sgst' then v_tax - round(v_tax / 2, 2) else 0 end,
         igst_amount = case when tax_treatment in ('igst','export_igst') then v_tax else 0 end,
         total_amount = v_taxable + case
                          when tax_treatment in ('export_lut','exempt') then 0
                          else v_tax
                        end,
         -- The totals are already in INR, so this is no longer a conversion.
         -- Kept as a column because every reader and every export references it.
         total_inr = v_taxable + case
                       when tax_treatment in ('export_lut','exempt') then 0
                       else v_tax
                     end,
         updated_at = now()
   where id = p_invoice;
end $fn$;

-- The header exchange rate no longer scales anything, so a change to it must
-- not silently move a total. Only the treatment does now.
create or replace function public.invoices_retotal()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.tax_treatment is distinct from old.tax_treatment then
    perform public.recompute_invoice_totals(new.id);
  end if;
  return new;
end $fn$;

-- Existing lines are all rupee lines at par, which the defaults already say.
-- Recompute every invoice so the stored totals agree with the new arithmetic.
do $$
declare r record;
begin
  for r in select id from public.invoices loop
    perform public.recompute_invoice_totals(r.id);
  end loop;
end $$;
