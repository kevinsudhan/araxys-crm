-- ---------------------------------------------------------------------------
-- 130: Sharing the profit with the overseas agent.
--
-- An agency agreement says what share of the profit on the cargo the agent at
-- the other end gets — 50/50 is the usual one — and whether a loss is shared
-- the same way. The profit is the console's (or, for a job on no console, the
-- job's), worked out as the P&L works it out, before the share itself.
--
-- The share is settled as a note on the agent, through the notes 037 built
-- and the statement of account nets:
--
--   a profit, their share   → our credit note to them (OCN): we owe them;
--   a loss shared           → our debit note on them (ODN): they owe us.
--
-- Or the agent works it out and sends their own note, which is recorded as a
-- bill and marked as their profit share. Either way the notes are marked, so
-- the profit the share is worked out on never includes the share itself.
-- ---------------------------------------------------------------------------

-- The agreement, on the agent.
alter table public.partners
  add column if not exists profit_share_pct numeric
    check (profit_share_pct is null or (profit_share_pct > 0 and profit_share_pct <= 100)),
  add column if not exists profit_share_losses boolean not null default true;

comment on column public.partners.profit_share_pct is
  'The agent''s share of the profit on cargo they handle with us, per cent. Null: no profit share agreed.';
comment on column public.partners.profit_share_losses is
  'Whether a loss is shared in the same proportion.';

-- A console agreed differently from the agreement; 0 means no share on it.
alter table public.consoles
  add column if not exists profit_share_pct numeric
    check (profit_share_pct is null or (profit_share_pct >= 0 and profit_share_pct <= 100));

-- Our note that settles a share: what share, of what profit.
alter table public.invoices
  add column if not exists profit_share_pct numeric,
  add column if not exists profit_share_base_inr numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_profit_share_note' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices
      add constraint invoices_profit_share_note
      check (profit_share_pct is null or (partner_id is not null and kind in ('debit_note', 'credit_note')));
  end if;
end $$;

-- Their note that settles a share.
alter table public.bills
  add column if not exists profit_share boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bills_profit_share_agent' and conrelid = 'public.bills'::regclass) then
    alter table public.bills
      add constraint bills_profit_share_agent
      check (not profit_share or kind in ('agent_debit_note', 'agent_credit_note'));
  end if;
end $$;

create index if not exists invoices_profit_share_idx on public.invoices (partner_id, console_id, shipment_id) where profit_share_pct is not null;


-- ---------------------------------------------------------------------------
-- Issuing a note on an agent
--
-- 042 asked every credit and debit note for the invoice it corrects, as Rule
-- 53(1A) wants of a GST note to a customer. A note on an overseas agent (037)
-- corrects nothing: it is the agent's share of a job, raised on its own. So
-- the rule is for notes to customers, as it always meant to be.
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
  -- printed on the note itself. A note on an overseas agent relates to none.
  if v_row.kind in ('credit_note','debit_note')
     and v_row.partner_id is null
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
-- Drafting the note for a share
--
-- The figure is worked out on the screen from the P&L (lib/profitShare.ts) and
-- handed here with what it was worked out on; this makes the note, in the
-- agent's currency, with the one line. A draft, for the desk to look over and
-- issue. One draft at a time per console or job: two people pressing the
-- button make one note, not two.
-- ---------------------------------------------------------------------------
create or replace function public.raise_profit_share(
  p_partner     uuid,
  p_console     uuid,
  p_shipment    text,
  p_kind        text,
  p_currency    text,
  p_roe         numeric,
  p_amount      numeric,
  p_pct         numeric,
  p_base_inr    numeric,
  p_description text
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_p   public.partners;
  v_row public.invoices;
  v_ref text;
  v_cur text := upper(coalesce(nullif(trim(p_currency), ''), 'USD'));
  v_fx  numeric;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if (p_console is null) = (p_shipment is null) then
    raise exception 'A profit share is on a console or on a job, one of the two';
  end if;
  if p_kind not in ('debit_note', 'credit_note') then
    raise exception 'A profit share is settled by a debit note or a credit note, not %', p_kind;
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'The amount must be more than nothing';
  end if;
  if p_pct is null or p_pct <= 0 or p_pct > 100 then
    raise exception 'The share must be more than 0 and at most 100 per cent';
  end if;
  v_fx := case when v_cur = 'INR' then 1 else p_roe end;
  if coalesce(v_fx, 0) <= 0 then
    raise exception 'Give the rate of exchange for %', v_cur;
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Say what the note is for';
  end if;

  select * into v_p from public.partners where id = p_partner;
  if not found then
    raise exception 'No partner %', p_partner;
  end if;

  if p_shipment is not null then
    select enquiry_ref into v_ref from public.shipments where id = p_shipment;
    if not found then
      raise exception 'No job %', p_shipment;
    end if;
  elsif not exists (select 1 from public.consoles where id = p_console) then
    raise exception 'No console %', p_console;
  end if;

  perform pg_advisory_xact_lock(hashtext('profit_share:' || coalesce(p_console::text, p_shipment)));
  if exists (
    select 1 from public.invoices
     where partner_id = p_partner
       and profit_share_pct is not null
       and status = 'draft'
       and (console_id = p_console or shipment_id = p_shipment)
  ) then
    raise exception 'A profit-share note for this is already drafted'
      using hint = 'Issue it, or cancel it, first.';
  end if;

  insert into public.invoices (
    kind, series, partner_id, console_id, shipment_id, enquiry_ref,
    currency, exchange_rate,
    bill_to_name, bill_to_address, bill_to_country,
    -- An overseas agent is outside India: an export of service, as 037
    -- suggests for every note on an agent. Changeable on the note.
    tax_treatment,
    profit_share_pct, profit_share_base_inr,
    created_by
  ) values (
    p_kind, case when p_kind = 'credit_note' then 'OCN' else 'ODN' end,
    p_partner, p_console, p_shipment, v_ref,
    v_cur, v_fx,
    coalesce(nullif(v_p.organisation, ''), v_p.name), coalesce(v_p.address, ''), coalesce(v_p.country, ''),
    'export_lut',
    p_pct, round(p_base_inr, 2),
    auth.uid()
  )
  returning * into v_row;

  insert into public.invoice_lines (invoice_id, position, description, quantity, unit, rate, currency, fx_rate, tax_rate)
  values (v_row.id, 0, trim(p_description), 1, 'Lumpsum', round(p_amount, 2), v_cur, v_fx, 0);

  select * into v_row from public.invoices where id = v_row.id;
  return v_row;
end $fn$;

revoke execute on function public.raise_profit_share(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.raise_profit_share(uuid, uuid, text, text, text, numeric, numeric, numeric, numeric, text) to authenticated;
