-- 115: A pasted air quotation, laid out as the desk's own rate table.
--
-- ---------------------------------------------------------------------------
-- An air quotation goes to the customer as the table the desk has always sent:
-- a line of what it is for (route, terms, packages, weight, carrier, transit
-- time), then CHARGES | CURRENCY/QUANTUM | RATES | INR | GST | TOTAL VALUE IN
-- INR, grouped under Freight and Destination charges (lib/airQuote.ts). What
-- that needs and the lines did not carry:
--
--   quote_lines.section   Gains 'freight' and 'destination', beside 'ex_works'
--                         and 'other' (106), so a quotation is grouped as the
--                         desk groups it.
--   quote_lines.gst_rate  The GST on the charge as quoted, in per cent: 0 is
--                         "none" (air freight), null is "not stated" (every line
--                         before this). An invoice made from the quotation
--                         charges what was quoted, and 18 where nothing was.
--   quotes.routing        HEL - IST - MAA, as the rate gave it.
--   quotes.carrier        TK, Emirates.
--   quotes.transit_time   2-3 days.
--
-- A charge quoted as a share of others ("3% on OF+EXW") is an ordinary line:
-- its figure is worked out by the app when it is pasted, and the wording stays
-- with the charge as its condition, as "at actuals" does (106).
-- ---------------------------------------------------------------------------

alter table public.quote_lines drop constraint if exists quote_lines_section_check;
alter table public.quote_lines add constraint quote_lines_section_check
  check (section is null or section in ('ex_works', 'freight', 'destination', 'other'));

alter table public.quote_lines add column if not exists gst_rate numeric;
alter table public.quote_lines drop constraint if exists quote_lines_gst_rate_check;
alter table public.quote_lines add constraint quote_lines_gst_rate_check
  check (gst_rate is null or (gst_rate >= 0 and gst_rate <= 28));

alter table public.quotes add column if not exists routing text;
alter table public.quotes add column if not exists carrier text;
alter table public.quotes add column if not exists transit_time text;

-- The invoice charges the GST the quotation stated; 18 where it stated none (039).
create or replace function public.copy_quote_lines_to_invoice(p_invoice uuid, p_quote uuid)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare v_n int;
begin
  insert into public.invoice_lines
    (invoice_id, position, description, sac_code, quantity, unit, rate, currency, fx_rate, tax_rate)
  select p_invoice, l.position, l.description, l.sac_code, l.quantity, l.unit,
         l.rate, l.currency, l.fx_rate, coalesce(l.gst_rate, 18)
    from public.quote_lines l
   where l.quote_id = p_quote
   order by l.position;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- A charge's GST and its group are what the customer reads, as its rate is:
-- changing either un-approves an approved draft, as an edit to a figure does.
CREATE OR REPLACE FUNCTION public.quote_lines_reset_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    -- A blank row added to be filled in changes nothing yet. (`rate`
    -- defaults to 0, so zero counts as blank here.)
    if coalesce(btrim(new.description), '') = ''
       and coalesce(new.rate, 0) = 0 and coalesce(new.amount, 0) = 0
       and coalesce(new.min_amount, 0) = 0
    then
      return null;
    end if;
  elsif tg_op = 'DELETE' then
    if coalesce(btrim(old.description), '') = ''
       and coalesce(old.rate, 0) = 0 and coalesce(old.amount, 0) = 0
       and coalesce(old.min_amount, 0) = 0
    then
      return null;
    end if;
  elsif not (   new.description is distinct from old.description
             or new.charge_code is distinct from old.charge_code
             or new.sac_code    is distinct from old.sac_code
             or new.quantity    is distinct from old.quantity
             or new.unit        is distinct from old.unit
             or new.rate        is distinct from old.rate
             or new.currency    is distinct from old.currency
             or new.fx_rate     is distinct from old.fx_rate
             or new.amount      is distinct from old.amount
             or new.amount_inr  is distinct from old.amount_inr
             or new.min_amount  is distinct from old.min_amount
             or new.gst_rate    is distinct from old.gst_rate
             or new.section     is distinct from old.section)
  then
    return null;  -- cost side, vendor or ordering only
  end if;

  perform public.reset_approval_after_edit(coalesce(new.quote_id, old.quote_id));
  return null;
end $function$;

notify pgrst, 'reload schema';
