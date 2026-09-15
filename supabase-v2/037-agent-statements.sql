-- ---------------------------------------------------------------------------
-- Settling up with an overseas agent.
--
-- WHAT AN SOA IS FOR
--
-- Two forwarders handling opposite ends of the same cargo bill each other
-- constantly and in both directions. We raise debit notes on them for our half
-- of jobs they nominated; they raise debit notes on us for their half of jobs
-- we nominated. Paying each of those individually across a currency border
-- would be dozens of small wire transfers a month, each with its own fee.
--
-- So it is netted. A period is agreed, everything outstanding in both
-- directions is listed, and one party remits the difference. That list is the
-- statement of account, and it is the document the two desks argue over — which
-- is why it has to be a snapshot of what was agreed rather than a live query
-- that answers differently next week.
--
-- WHY A LINE CANNOT BE ON TWO STATEMENTS
--
-- Because the whole point is that a settled item is settled. A debit note that
-- appears on March's statement and again on April's gets paid twice or
-- disputed, and both cost more than the unique index that prevents it.
--
-- WHY OUR SIDE IS AN INVOICE AND THEIR SIDE IS A BILL
--
-- An overseas debit note we raise is a sale — the agent owes us. 036 gave
-- `invoices` a `partner_id` for exactly this. Their debit note on us is a
-- purchase and is a `bill`. Netting them is this table's only job.
-- ---------------------------------------------------------------------------

create table if not exists public.agent_statements (
  id            uuid primary key default gen_random_uuid(),

  statement_no  text unique,
  fy            text,

  partner_id    uuid not null references public.partners(id) on delete restrict,

  period_from   date not null,
  period_to     date not null,
  statement_date date not null default current_date,
  -- When the money actually moved. Null until it has.
  remittance_date date,

  -- draft   — being built, lines can still be added and removed
  -- sent    — put to the agent
  -- agreed  — they have accepted the net figure
  -- settled — the remittance has happened
  status        text not null default 'draft'
                  check (status in ('draft','sent','agreed','settled','cancelled')),

  currency      text not null default 'USD',
  exchange_rate numeric not null default 1 check (exchange_rate > 0),

  -- Maintained by trigger from the lines. Both sides are kept rather than only
  -- the net, because "we owe you 4,000 and you owe us 9,000" is the
  -- conversation, and a single figure of 5,000 cannot be checked against
  -- anything.
  due_to_us     numeric not null default 0,
  due_to_them   numeric not null default 0,
  net_inr       numeric not null default 0,

  remarks       text not null default '',

  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  check (period_to >= period_from)
);

create index if not exists soa_partner_idx on public.agent_statements (partner_id, period_to desc);
create index if not exists soa_status_idx  on public.agent_statements (status);

create table if not exists public.statement_lines (
  id           uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.agent_statements(id) on delete cascade,

  -- Exactly one. Our debit note on them, or their debit note on us.
  invoice_id   uuid references public.invoices(id) on delete restrict,
  bill_id      uuid references public.bills(id)    on delete restrict,

  -- Snapshotted at the moment the statement was built, in INR. An agent's note
  -- in USD is worth something different by the time the statement is agreed,
  -- and what was netted is what was on the paper.
  amount_inr   numeric not null default 0,

  created_at   timestamptz not null default now(),

  constraint statement_line_one_target
    check ((invoice_id is not null) <> (bill_id is not null))
);

-- A document appears on one statement, ever. This is the control the whole
-- arrangement rests on.
create unique index if not exists statement_once_per_invoice
  on public.statement_lines (invoice_id) where invoice_id is not null;
create unique index if not exists statement_once_per_bill
  on public.statement_lines (bill_id) where bill_id is not null;

create index if not exists statement_lines_idx on public.statement_lines (statement_id);


create or replace function public.recompute_statement(p_statement uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_us   numeric := 0;
  v_them numeric := 0;
begin
  select coalesce(sum(l.amount_inr) filter (where l.invoice_id is not null), 0),
         coalesce(sum(l.amount_inr) filter (where l.bill_id is not null), 0)
    into v_us, v_them
    from public.statement_lines l
   where l.statement_id = p_statement;

  update public.agent_statements
     set due_to_us   = v_us,
         due_to_them = v_them,
         -- Positive means they owe us and should remit. Negative means we do.
         net_inr     = v_us - v_them,
         updated_at  = now()
   where id = p_statement;
end $fn$;

create or replace function public.statement_lines_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id     uuid := coalesce(new.statement_id, old.statement_id);
  v_status text;
begin
  select status into v_status from public.agent_statements where id = v_id;

  -- Once a statement has been put to the agent, its contents are what they are
  -- looking at. Changing them underneath is how two desks end up holding
  -- different versions of the same document.
  if v_status is distinct from 'draft' then
    raise exception 'That statement has been sent and its lines cannot be changed'
      using hint = 'Build a new statement for the next period instead.';
  end if;

  perform public.recompute_statement(v_id);
  return coalesce(new, old);
end $fn$;

drop trigger if exists statement_lines_totals on public.statement_lines;
create trigger statement_lines_totals
  after insert or update or delete on public.statement_lines
  for each row execute function public.statement_lines_touch();


-- ---------------------------------------------------------------------------
-- Building one
--
-- Pulls every document in both directions with this agent, dated inside the
-- period, that is not already on a statement. That last clause is what makes
-- running it twice safe: the second run finds nothing left to add.
-- ---------------------------------------------------------------------------
create or replace function public.build_agent_statement(
  p_partner uuid,
  p_from    date,
  p_to      date
)
returns public.agent_statements
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.agent_statements;
  v_n   int;
begin
  if p_to < p_from then
    raise exception 'The period ends before it starts';
  end if;

  insert into public.agent_statements (
    statement_no, fy, partner_id, period_from, period_to, created_by
  ) values (
    public.allocate_invoice_number('SOA', current_date),
    public.fy_of(current_date),
    p_partner, p_from, p_to, auth.uid()
  )
  returning * into v_row;

  -- Our debit and credit notes on them. A credit note reduces what they owe,
  -- so it goes on with the sign it carries.
  insert into public.statement_lines (statement_id, invoice_id, amount_inr)
  select v_row.id, i.id,
         case when i.kind = 'credit_note' then -i.total_inr else i.total_inr end
    from public.invoices i
   where i.partner_id = p_partner
     and i.invoice_date between p_from and p_to
     and i.status in ('issued','part_paid','paid')
     and not exists (select 1 from public.statement_lines sl where sl.invoice_id = i.id);

  -- Their notes on us, same treatment in the other direction.
  insert into public.statement_lines (statement_id, bill_id, amount_inr)
  select v_row.id, b.id,
         case when b.kind = 'agent_credit_note' then -b.total_inr else b.total_inr end
    from public.bills b
   where b.partner_id = p_partner
     and b.bill_date between p_from and p_to
     and b.status not in ('cancelled','draft')
     and not exists (select 1 from public.statement_lines sl where sl.bill_id = b.id);

  select count(*) into v_n from public.statement_lines where statement_id = v_row.id;
  if v_n = 0 then
    -- Nothing to settle. Removing it rather than leaving an empty statement
    -- lying about, and the number is spent — which is correct, because a
    -- statement was genuinely raised and found to be empty.
    delete from public.agent_statements where id = v_row.id;
    raise exception 'Nothing outstanding with that agent between % and %', p_from, p_to
      using hint = 'Everything in that period is already on a statement, or there is nothing there.';
  end if;

  select * into v_row from public.agent_statements where id = v_row.id;
  return v_row;
end $fn$;


-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['agent_statements','statement_lines'] loop
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

drop policy if exists statement_lines_delete on public.statement_lines;
create policy statement_lines_delete on public.statement_lines
  for delete to authenticated using (true);

revoke all on public.agent_statements from anon;
revoke all on public.statement_lines  from anon;

grant execute on function public.build_agent_statement(uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------------
-- Raising a note on an agent
--
-- The same invoice machinery, addressed to a partner instead of a customer.
-- An overseas debit note is a sale: we are charging the agent their share of a
-- job we handled, in their currency, and it nets on the next statement.
-- ---------------------------------------------------------------------------
create or replace function public.start_agent_note(
  p_partner  uuid,
  p_kind     text default 'debit_note',
  p_console  uuid default null,
  p_currency text default 'USD'
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.invoices;
  v_p   public.partners;
begin
  if p_kind not in ('debit_note','credit_note') then
    raise exception 'An agent note is a debit note or a credit note, not %', p_kind;
  end if;

  select * into v_p from public.partners where id = p_partner;
  if not found then
    raise exception 'No partner %', p_partner;
  end if;

  select * into v_row
    from public.invoices
   where partner_id = p_partner and kind = p_kind and status = 'draft'
     and coalesce(console_id::text, '') = coalesce(p_console::text, '')
   order by created_at desc limit 1;
  if found then
    return v_row;
  end if;

  insert into public.invoices (
    kind, series, partner_id, console_id, currency,
    bill_to_name, bill_to_country,
    -- An overseas agent is outside India, so the supply is an export of
    -- service. Suggested, and changeable like every other treatment.
    tax_treatment,
    created_by
  ) values (
    p_kind,
    case when p_kind = 'credit_note' then 'OCN' else 'ODN' end,
    p_partner,
    p_console,
    coalesce(p_currency, 'USD'),
    coalesce(nullif(v_p.organisation, ''), v_p.name),
    '',
    'export_lut',
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.start_agent_note(uuid, text, uuid, text) to authenticated;
