-- ---------------------------------------------------------------------------
-- Pushing something through and putting it on a named person's list.
--
-- WHY THIS IS ONE CALL AND NOT TWO
--
-- Promoting and assigning could be done in sequence from the browser, and for
-- the self-claim case they are. Handing to somebody else is different: it needs
-- a permission, and a permission that is checked after the reference has
-- already been allocated is checked too late. A refusal would leave a new
-- enquiry sitting on the shared board that nobody asked for.
--
-- Inside one transaction the check comes with everything else, so a person
-- without the permission produces no enquiry, no customer and no reference.
--
-- The permission itself is not re-implemented here. assign_enquiry owns that
-- rule and raises if the caller may not, which rolls the whole thing back. One
-- rule, one place, and the same timeline entry either way.
-- ---------------------------------------------------------------------------

drop function if exists public.promote_intake(uuid, text, boolean);

create or replace function public.promote_intake(
  p_id          uuid,
  p_customer_id text default null,
  p_claim       boolean default false,
  -- Whom to hand it to. Null leaves it wherever p_claim decides.
  p_assign_to   uuid default null
) returns public.enquiries
language plpgsql
security definer
set search_path = public
as $fn$
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

  -- A call that started this now belongs to the case file, so the transcript is
  -- where somebody reading the enquiry will look for it.
  if v_in.call_id is not null then
    update public.calls
       set enquiry_ref = v_enq.ref,
           customer_id = coalesce(customer_id, v_customer.id),
           matched_by  = 'manual'
     where call_id = v_in.call_id;
  end if;

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
end $fn$;

grant execute on function public.promote_intake(uuid, text, boolean, uuid) to authenticated;
