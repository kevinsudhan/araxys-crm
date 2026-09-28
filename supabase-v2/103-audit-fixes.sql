-- 103: What the audit of 28 September found, fixed.
--
-- ---------------------------------------------------------------------------
-- 1. THE JOB HEADER'S MARGIN IS BEFORE GST, LIKE JOB CLOSING'S
--
-- shipment_margin and console_margin summed invoices' and bills' total_inr,
-- which carries the GST. Job closing (src/lib/jobPnl.ts) works before GST:
-- GST collected is owed to the government and GST paid is claimed back. So the
-- same job showed two profits (on a ₹1,70,000 + 18% invoice against ₹61,000 of
-- cost: ₹1,39,600 in the header, ₹1,09,000 in Job closing). Both views now
-- count what Job closing counts: an invoice's lines in rupees (its taxable
-- value when it has none), a bill's lines at its exchange rate (its taxable
-- value when it has none); credit notes and agent credit notes negative;
-- issued revenue, every bill not cancelled.
--
-- 2. A SHIPMENT CAN BE CANCELLED, AND REOPENED
--
-- Every screen understood a cancelled job, and the case file told the desk to
-- cancel one "on its own page", but nothing did. cancel_shipment and
-- reopen_shipment do, each with a reason, kept on the job and on the timeline.
-- set_shipment_stage, whose only remaining use was cancelling and reopening,
-- is dropped: the stage otherwise follows the customer milestones (102).
--
-- 3. THE VOICE-AGENT LEFTOVERS ARE GONE
--
-- 041 dropped the calls tables. promote_intake still updated public.calls for
-- an intake row with a call_id (none exist, so it never ran), and
-- capture_call_as_intake and forget_call failed whenever called.
--
-- 4. POLICIES READ THE CALLER ONCE, AND FOREIGN KEYS HAVE INDEXES
--
-- Ten policies called auth.uid() for every row they looked at; written as
-- (select auth.uid()) Postgres works it out once per query. The rules are the
-- same. mail_log grows by the server's copy every five minutes, so it mattered
-- most there. And every foreign key without an index gets one: joins on them
-- and deletes that cascade through them stop reading whole tables.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Margins before GST
-- ---------------------------------------------------------------------------

-- What one document is worth before GST, in rupees, signed as Job closing signs it.
create or replace function public.invoice_net_inr(p_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $fn$
  select case when i.kind = 'credit_note' then -1 else 1 end
         * coalesce((select sum(l.amount_inr) from public.invoice_lines l where l.invoice_id = i.id), i.taxable_value, 0)
    from public.invoices i where i.id = p_id
$fn$;

create or replace function public.bill_net_inr(p_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $fn$
  select case when b.kind = 'agent_credit_note' then -1 else 1 end
         * coalesce((select sum(l.amount) from public.bill_lines l where l.bill_id = b.id), b.taxable_value, 0)
         * coalesce(nullif(b.exchange_rate, 0), 1)
    from public.bills b where b.id = p_id
$fn$;

revoke execute on function public.invoice_net_inr(uuid) from public, anon;
revoke execute on function public.bill_net_inr(uuid) from public, anon;
grant execute on function public.invoice_net_inr(uuid) to authenticated;
grant execute on function public.bill_net_inr(uuid) to authenticated;

create or replace view public.shipment_margin with (security_invoker = true) as
select s.id as shipment_id,
       s.console_id,
       coalesce((select sum(public.invoice_net_inr(i.id))
                   from public.invoices i
                  where i.shipment_id = s.id
                    and i.status in ('issued', 'part_paid', 'paid')
                    and i.kind in ('tax_invoice', 'debit_note', 'credit_note')), 0::numeric) as revenue_inr,
       coalesce((select sum(public.bill_net_inr(b.id))
                   from public.bills b
                  where b.shipment_id = s.id and b.status <> 'cancelled'), 0::numeric) as cost_inr
  from public.shipments s;

create or replace view public.console_margin with (security_invoker = true) as
select c.id as console_id,
       c.console_no,
       coalesce((select sum(public.invoice_net_inr(i.id))
                   from public.invoices i
                   join public.shipments s on s.id = i.shipment_id
                  where s.console_id = c.id
                    and i.status in ('issued', 'part_paid', 'paid')
                    and i.kind in ('tax_invoice', 'debit_note', 'credit_note')), 0::numeric)
     + coalesce((select sum(public.invoice_net_inr(i.id))
                   from public.invoices i
                  where i.console_id = c.id
                    and i.status in ('issued', 'part_paid', 'paid')), 0::numeric) as revenue_inr,
       coalesce((select sum(public.bill_net_inr(b.id))
                   from public.bills b
                  where b.console_id = c.id and b.status <> 'cancelled'), 0::numeric)
     + coalesce((select sum(public.bill_net_inr(b.id))
                   from public.bills b
                   join public.shipments s on s.id = b.shipment_id
                  where s.console_id = c.id and b.console_id is null and b.status <> 'cancelled'), 0::numeric) as cost_inr
  from public.consoles c;


-- ---------------------------------------------------------------------------
-- 2. Cancelling a shipment, and reopening it
-- ---------------------------------------------------------------------------
alter table public.shipments
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references auth.users (id) on delete set null,
  add column if not exists cancel_reason text;

create or replace function public.cancel_shipment(p_id text, p_reason text)
returns public.shipments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.shipments;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into v_row from public.shipments where id = p_id for update;
  if not found then
    raise exception 'No shipment %', p_id;
  end if;
  if v_row.stage = 'cancelled' then
    return v_row;
  end if;
  if v_row.signed_off_at is not null then
    raise exception '% is signed off; an admin has to reopen it before it can be cancelled', p_id;
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why it is being cancelled'
      using hint = 'The case file and the job file show the reason.';
  end if;

  update public.shipments
     set stage = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = left(btrim(p_reason), 500), updated_at = now()
   where id = p_id
   returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'stage_changed', format('%s cancelled: %s', p_id, btrim(p_reason)),
          jsonb_build_object('shipment_id', p_id, 'to', 'cancelled', 'reason', btrim(p_reason)), auth.uid());
  return v_row;
end $fn$;

create or replace function public.reopen_shipment(p_id text, p_reason text)
returns public.shipments
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.shipments;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select * into v_row from public.shipments where id = p_id for update;
  if not found then
    raise exception 'No shipment %', p_id;
  end if;
  if v_row.stage <> 'cancelled' then
    return v_row;
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why it is being reopened';
  end if;

  -- Back to where its milestones say it is.
  update public.shipments
     set stage = 'booked', cancelled_at = null, cancelled_by = null, cancel_reason = null, updated_at = now()
   where id = p_id;
  perform public.derive_shipment_stage(p_id);

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'stage_changed', format('%s reopened: %s', p_id, btrim(p_reason)),
          jsonb_build_object('shipment_id', p_id, 'from', 'cancelled', 'reason', btrim(p_reason)), auth.uid());

  select * into v_row from public.shipments where id = p_id;
  return v_row;
end $fn$;

revoke execute on function public.cancel_shipment(text, text) from public, anon;
revoke execute on function public.reopen_shipment(text, text) from public, anon;
grant execute on function public.cancel_shipment(text, text) to authenticated;
grant execute on function public.reopen_shipment(text, text) to authenticated;

drop function if exists public.set_shipment_stage(text, text);


-- ---------------------------------------------------------------------------
-- 3. The voice-agent leftovers
-- ---------------------------------------------------------------------------
drop function if exists public.capture_call_as_intake(text);
drop function if exists public.forget_call(text, text);

-- promote_intake, as it was, without the branch that updated public.calls.
CREATE OR REPLACE FUNCTION public.promote_intake(p_id uuid, p_customer_id text DEFAULT NULL::text, p_claim boolean DEFAULT false, p_assign_to uuid DEFAULT NULL::uuid)
 RETURNS enquiries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_in       public.intake;
  v_customer public.customers;
  v_enq      public.enquiries;
  v_source   text;
  v_me       uuid := auth.uid();
begin
  select * into v_in from public.intake where id = p_id for update;
  if not found then
    raise exception 'no intake row %', p_id;
  end if;

  -- Pressing the button twice is a question ("did that work?"), not a request
  -- for a second reference. Hand back what the first press produced, and let a
  -- claim or a hand-off still land if the first press did not make one.
  if v_in.status = 'promoted' then
    select * into v_enq from public.enquiries where ref = v_in.enquiry_ref;
    if p_assign_to is not null then
      v_enq := public.assign_enquiry(v_enq.ref, p_assign_to);
    elsif p_claim and v_enq.assigned_to is null and v_me is not null then
      v_enq := public.claim_enquiry(v_enq.ref);
    end if;
    return v_enq;
  end if;

  if v_in.status = 'dismissed' then
    raise exception 'intake % was dismissed; reopen it before pushing', p_id;
  end if;

  if p_customer_id is not null then
    select * into v_customer from public.customers where id = p_customer_id;
    if not found then
      raise exception 'no customer %', p_customer_id;
    end if;
  else
    if coalesce(nullif(trim(v_in.contact_name), ''), nullif(trim(v_in.company), '')) is null then
      raise exception 'give the caller a name or a company before pushing this through';
    end if;
    v_customer := public.create_customer(
      coalesce(nullif(trim(v_in.contact_name), ''), trim(v_in.company)),
      coalesce(v_in.company, ''),
      v_in.email,
      v_in.phone
    );
  end if;

  -- 'walk_in' has no equivalent on the enquiry, whose source column predates
  -- the intake table. It records as manual, which is what it is from the
  -- pipeline's point of view: a person typed it in.
  v_source := case when v_in.channel = 'walk_in' then 'manual' else v_in.channel end;

  v_enq := public.create_enquiry(
    v_customer.id,
    v_source,
    nullif(trim(coalesce(v_in.origin, '')), ''),
    nullif(trim(coalesce(v_in.destination, '')), ''),
    nullif(trim(coalesce(v_in.cargo, '')), '')
  );

  -- The arrival travels with it: the desk's response time is measured from when
  -- the customer wrote, not from when we got round to making a row for it.
  update public.enquiries
     set received_at = v_in.received_at,
         -- The subject is what the sender called it, so it leads the notes.
         notes = case
           when coalesce(v_in.subject, v_in.notes) is null then notes
           else trim(both e'\n' from
                  concat_ws(e'\n', nullif(trim(coalesce(v_in.subject, '')), ''),
                                   nullif(trim(coalesce(v_in.notes, '')), '')))
         end
   where ref = v_enq.ref
  returning * into v_enq;

  -- Bind the conversation, so every later reply files itself against this
  -- reference without anybody deciding to.
  if v_in.conversation_id is not null then
    insert into public.enquiry_threads (conversation_id, enquiry_ref, bound_by)
    values (v_in.conversation_id, v_enq.ref, v_me)
    on conflict (conversation_id) do nothing;
  end if;

  -- And pin the message itself, which covers the case where the customer
  -- starts a fresh conversation instead of replying.
  if v_in.message_id is not null then
    insert into public.enquiry_messages (message_id, enquiry_ref, via, linked_by)
    values (v_in.message_id, v_enq.ref, 'manual', v_me)
    on conflict (message_id, enquiry_ref) do nothing;
  end if;

  update public.intake
     set status      = 'promoted',
         enquiry_ref = v_enq.ref,
         settled_at  = now(),
         settled_by  = v_me,
         updated_at  = now()
   where id = p_id;

  -- Its own kind, not another 'created'. create_enquiry already logged the
  -- opening; a second row of the same kind would make the case file look like
  -- the enquiry had been opened twice.
  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_enq.ref,
    'promoted_from_intake',
    format('Pushed to inbound from the %s intake queue', v_in.channel),
    jsonb_build_object(
      'intake_id', p_id,
      'channel', v_in.channel,
      'call_id', v_in.call_id,
      'message_id', v_in.message_id,
      'conversation_id', v_in.conversation_id,
      'received_at', v_in.received_at
    ),
    v_me
  );

  if v_in.conversation_id is not null then
    insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
    values (v_enq.ref, 'mail_linked', 'Mail thread linked to this enquiry', v_me);
  end if;

  -- Handing it to somebody wins over claiming it. Both cannot be meant at once,
  -- and the explicit name is the more specific instruction.
  if p_assign_to is not null then
    v_enq := public.assign_enquiry(v_enq.ref, p_assign_to);
  elsif p_claim and v_me is not null then
    -- Taking it on is the same act as claiming it from the board, so it goes
    -- through the same function and leaves the same 'assigned' event.
    v_enq := public.claim_enquiry(v_enq.ref);
  end if;

  return v_enq;
end $function$;


-- ---------------------------------------------------------------------------
-- 4. Policies that read the caller once; indexes on every foreign key
-- ---------------------------------------------------------------------------
alter policy backup_runs_admin_read on public.backup_runs
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy enquiry_files_delete on public.enquiry_files
  using ((exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'))
         or ((not protected) and filed_by = (select auth.uid())));

alter policy enquiry_files_insert on public.enquiry_files
  with check (filed_by = (select auth.uid()));

alter policy icegate_settings_admin on public.icegate_settings
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy mail_log_read on public.mail_log
  using (synced_by = (select auth.uid())
         or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy mail_log_mailboxes_read on public.mail_log_mailboxes
  using (synced_by = (select auth.uid())
         or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

alter policy mail_replies_insert on public.mail_replies
  with check (replied_by = (select auth.uid()));

alter policy mail_replies_read on public.mail_replies
  using (replied_by = (select auth.uid())
         or exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'));

alter policy profiles_select_own on public.profiles
  using ((select auth.uid()) = id);

alter policy profiles_update_own_signature on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id and role = (select p.role from public.profiles p where p.id = (select auth.uid())));

-- One index per foreign key that has none leading an index already.
do $$
declare
  r      record;
  v_name text;
begin
  for r in
    select c.conrelid::regclass as tbl, cl.relname, array_agg(a.attname order by k.ord) as cols
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (select array_agg(x order by o) from unnest(i.indkey::int2[]) with ordinality as u(x, o)
                  where o <= array_length(c.conkey, 1)) = c.conkey)
     group by c.conrelid, cl.relname, c.conname
  loop
    v_name := left(r.relname || '_' || array_to_string(r.cols, '_'), 48) || '_' || left(md5(r.relname || array_to_string(r.cols, ',')), 6) || '_fkx';
    execute format('create index if not exists %I on %s (%s)', v_name, r.tbl,
                   (select string_agg(quote_ident(x), ', ') from unnest(r.cols) as x));
  end loop;
end $$;
