-- ---------------------------------------------------------------------------
-- Building a quotation out of charges, rather than typing one number.
--
-- WHAT WAS WRONG
--
-- `quotes.amount_inr` is a single figure somebody works out in their head or in
-- a spreadsheet and types in. Three things follow from that and all of them
-- cost money:
--
--   The customer asks "what is the 62,000 made of" and the answer is not in the
--   system. Somebody rebuilds it from memory and gets a different number.
--
--   The invoice cannot be built from the quote, so the charges are typed a
--   second time at billing and the two disagree.
--
--   Margin per charge head is unanswerable, because the sell side has no heads.
--
-- A quotation is the same shape as the invoice it becomes: lines, each with a
-- head, a quantity, a rate and a currency.
--
-- WHY THE PARTNER'S RATE IS NOT COPIED IN AUTOMATICALLY
--
-- Because a partner's reply is a BUYING price. Putting it on a customer's
-- quotation sends the agent's cost to the shipper, which is the one mistake in
-- this whole screen that cannot be taken back. The buy figure is shown beside
-- the line as context and the sell rate is typed by a person.
-- ---------------------------------------------------------------------------

create table if not exists public.quote_lines (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  position    int  not null default 0,

  description text not null default '',
  sac_code    text,
  quantity    numeric not null default 1,
  unit        text not null default '',
  rate        numeric not null default 0,
  currency    text not null default 'INR',
  fx_rate     numeric not null default 1 check (fx_rate > 0),

  amount      numeric generated always as (round(quantity * rate, 2)) stored,
  amount_inr  numeric generated always as (round(quantity * rate * fx_rate, 2)) stored,

  -- What this charge costs us, where a partner has quoted it. Recorded on the
  -- line so the margin on a quotation can be seen while it is being built,
  -- which is the only moment anybody can do anything about it.
  cost_inr    numeric,
  -- Which reply the cost came from, so it can be traced back.
  partner_quote_id uuid references public.partner_quotes(id) on delete set null,

  created_at  timestamptz not null default now()
);

create index if not exists quote_lines_quote_idx on public.quote_lines (quote_id, position);


-- ---------------------------------------------------------------------------
-- The quoted amount, from the lines
--
-- `quotes.amount_inr` stays: it is referenced by the acceptance flow, by
-- `promote_enquiry`, by the quotation document and by the overview. It stops
-- being typed and starts being the sum.
--
-- When the last line is removed the amount is left alone rather than zeroed. A
-- quote that has already been sent at a figure does not become a quote for
-- nothing because somebody tidied up the breakdown.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_quote_total(p_quote uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_sum numeric;
  v_n   int;
begin
  select count(*), coalesce(sum(amount_inr), 0)
    into v_n, v_sum
    from public.quote_lines where quote_id = p_quote;

  if v_n = 0 then
    return;
  end if;

  update public.quotes set amount_inr = v_sum where id = p_quote;
end $fn$;

create or replace function public.quote_lines_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id     uuid := coalesce(new.quote_id, old.quote_id);
  v_status text;
begin
  select status into v_status from public.quotes where id = v_id;

  -- A quote the customer has accepted is what they agreed to. Changing the
  -- charges underneath it rewrites the agreement.
  if v_status = 'accepted' then
    raise exception 'That quotation has been accepted and its charges cannot be changed'
      using hint = 'Revise it as a new version instead.';
  end if;

  perform public.recompute_quote_total(v_id);
  return coalesce(new, old);
end $fn$;

drop trigger if exists quote_lines_total on public.quote_lines;
create trigger quote_lines_total
  after insert or update or delete on public.quote_lines
  for each row execute function public.quote_lines_touch();


-- ---------------------------------------------------------------------------
-- What a quotation is worth against what it costs
-- ---------------------------------------------------------------------------
create or replace view public.quote_margin as
  select q.id as quote_id,
         q.enquiry_ref,
         q.amount_inr                                as sell_inr,
         coalesce((select sum(l.cost_inr) from public.quote_lines l
                    where l.quote_id = q.id), 0)     as cost_inr,
         (select count(*) from public.quote_lines l
           where l.quote_id = q.id)                  as line_count,
         (select count(*) from public.quote_lines l
           where l.quote_id = q.id and l.cost_inr is not null) as costed_lines
    from public.quotes q;

grant select on public.quote_margin to authenticated;


-- ---------------------------------------------------------------------------
-- Carrying a quotation's charges onto the invoice it becomes
--
-- The whole point of giving a quote line items: what was agreed is what gets
-- billed, without anybody retyping it. Called instead of the single seeded line
-- when the accepted quote actually has a breakdown.
-- ---------------------------------------------------------------------------
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
         l.rate, l.currency, l.fx_rate, 18
    from public.quote_lines l
   where l.quote_id = p_quote
   order by l.position;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

grant execute on function public.copy_quote_lines_to_invoice(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.quote_lines enable row level security;

drop policy if exists quote_lines_read on public.quote_lines;
create policy quote_lines_read on public.quote_lines for select to authenticated using (true);

drop policy if exists quote_lines_insert on public.quote_lines;
create policy quote_lines_insert on public.quote_lines for insert to authenticated with check (true);

drop policy if exists quote_lines_update on public.quote_lines;
create policy quote_lines_update on public.quote_lines for update to authenticated using (true) with check (true);

drop policy if exists quote_lines_delete on public.quote_lines;
create policy quote_lines_delete on public.quote_lines for delete to authenticated using (true);

revoke all on public.quote_lines from anon;
