-- ---------------------------------------------------------------------------
-- A booking needs the customer's yes in writing.
--
-- Until now a caller saying "ok proceed pannunga" set the quote to accepted and
-- the enquiry moved straight to in-process. That is a container committed on
-- the strength of a sentence in a transcript, half of which the ASR guessed --
-- and on call 19094 the ASR rendered the caller's Tamil as Kannada. If the
-- customer later says they never agreed, there is nothing to show them.
--
-- So "accepted" now means confirmed in writing, and nothing else. A yes on the
-- phone is recorded as exactly what it is: a verbal indication, visible on the
-- case file, which the desk then gets in writing before anything is booked.
-- ---------------------------------------------------------------------------

alter table public.quotes
  add column if not exists verbal_accept_at      timestamptz,
  add column if not exists accepted_via          text,
  add column if not exists accepted_message_id   text,
  add column if not exists acceptance_note       text not null default '';

alter table public.quotes drop constraint if exists quotes_accepted_via_check;
alter table public.quotes add constraint quotes_accepted_via_check
  check (accepted_via is null or accepted_via in ('email', 'manual'));

comment on column public.quotes.verbal_accept_at is
  'The caller said yes on the phone. Not an acceptance -- evidence that one is worth chasing.';
comment on column public.quotes.accepted_via is
  'How the written confirmation arrived. Null means it has not.';

-- Quotes already accepted under the old rules keep their standing. Retroactively
-- invalidating somebody's live booking would be a worse error than the one this
-- migration exists to prevent.
update public.quotes
   set accepted_via = 'manual',
       acceptance_note = 'Accepted before written confirmation was required'
 where status = 'accepted' and accepted_via is null;

-- ---------------------------------------------------------------------------
-- Record the written confirmation.
--
-- Takes the message it came from, so the acceptance points at the evidence
-- rather than at somebody's memory of having seen it. A manual confirmation has
-- no message and must therefore carry a note saying where the yes came from.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_acceptance(
  p_ref        text,
  p_quote_id   uuid,
  p_via        text,
  p_message_id text default null,
  p_note       text default ''
) returns public.quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_quote public.quotes;
begin
  if p_via not in ('email', 'manual') then
    raise exception 'Acceptance must be confirmed by email or recorded manually, not %', p_via;
  end if;

  if p_via = 'manual' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say where the confirmation came from'
      using hint = 'A manual acceptance with no note is indistinguishable from a guess.';
  end if;

  update public.quotes
     set status              = 'accepted',
         accepted_via        = p_via,
         accepted_message_id = p_message_id,
         acceptance_note     = coalesce(p_note, ''),
         responded_at        = coalesce(responded_at, now())
   where id = p_quote_id and enquiry_ref = upper(p_ref)
  returning * into v_quote;

  if not found then
    raise exception 'No quote % on %', p_quote_id, p_ref;
  end if;

  -- Everything else on this enquiry is superseded by the one they said yes to.
  update public.quotes
     set status = 'superseded'
   where enquiry_ref = upper(p_ref)
     and id <> p_quote_id
     and status in ('draft', 'sent');

  update public.enquiries
     set status = 'accepted', updated_at = now()
   where ref = upper(p_ref);

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    upper(p_ref),
    'accepted',
    case p_via
      when 'email' then 'Customer confirmed in writing — ₹' ||
        to_char(v_quote.amount_inr, 'FM9,99,99,999')
      else 'Acceptance recorded by the desk — ₹' ||
        to_char(v_quote.amount_inr, 'FM9,99,99,999')
    end,
    jsonb_build_object('quote_id', p_quote_id, 'via', p_via, 'message_id', p_message_id,
                       'note', p_note),
    auth.uid()
  );

  return v_quote;
end $fn$;

grant execute on function public.confirm_acceptance(text, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The promote guard, tightened.
--
-- It already refused without an accepted quote. Now "accepted" carries the
-- written-confirmation requirement, so the same rule means what it was always
-- supposed to mean, and the error says which step is actually missing.
-- ---------------------------------------------------------------------------
create or replace function public.promote_enquiry(p_ref text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_enq    public.enquiries;
  v_quote  public.quotes;
  v_verbal public.quotes;
  v_n      int;
  v_id     text;
  v_row    public.shipments;
begin
  select * into v_enq from public.enquiries where ref = upper(p_ref);
  if not found then
    raise exception 'No enquiry %', p_ref;
  end if;

  select * into v_quote
    from public.quotes
   where enquiry_ref = v_enq.ref
     and status = 'accepted'
     and accepted_via is not null
   order by version desc limit 1;

  if not found then
    -- Distinguish "they have not answered" from "they said yes on the phone
    -- and nobody got it in writing", because those need different actions.
    select * into v_verbal
      from public.quotes
     where enquiry_ref = v_enq.ref and verbal_accept_at is not null
     order by version desc limit 1;

    if found then
      raise exception 'Cannot start a shipment: % was accepted on a call but not confirmed in writing', v_enq.ref
        using hint = 'Send the quotation and confirm from their reply, or record the confirmation with a note.';
    end if;

    raise exception 'Cannot start a shipment: the customer has not accepted a quote on % yet', v_enq.ref
      using hint = 'Quote them first, then confirm their acceptance.';
  end if;

  -- Pressing twice returns what already exists rather than raising, because the
  -- second press means "did that work?" and an error there reads as a failure.
  select * into v_row from public.shipments where enquiry_ref = v_enq.ref;
  if found then
    return v_row;
  end if;

  select count(*) into v_n from public.shipments;
  v_id := 'ARX-SHP-' || lpad((v_n + 1)::text, 4, '0');

  insert into public.shipments (id, enquiry_ref, customer_id, stage, sailing_date, agreed_inr)
  values (v_id, v_enq.ref, v_enq.customer_id, 'booked', v_quote.sailing_date, v_quote.amount_inr)
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (upper(p_ref), 'promoted', 'Moved to in-process shipments as ' || v_id,
          jsonb_build_object('shipment_id', v_id), auth.uid());

  return v_row;
end $fn$;

grant execute on function public.promote_enquiry(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The newest address the customer gave us goes first.
--
-- Still appended rather than replaced -- a company has more than one person,
-- and a second address is another way to reach them, not proof the first is
-- wrong. But when somebody gives a different address on a later call, that is
-- the one they want used, so it moves to the front and everything that reads
-- "their email" reads the latest.
-- ---------------------------------------------------------------------------
create or replace function public.link_email_to_customer(
  p_customer_id text,
  p_email       text
) returns public.customers
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row   public.customers;
  v_email text := lower(btrim(p_email));
begin
  if v_email = '' then
    raise exception 'No email address given';
  end if;

  update public.customers
     set emails = array_prepend(
                    v_email,
                    array(select e from unnest(emails) as e where lower(e) <> v_email)
                  ),
         updated_at = now()
   where id = p_customer_id
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.link_email_to_customer(text, text) to authenticated;
