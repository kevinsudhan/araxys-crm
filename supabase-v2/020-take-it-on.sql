-- ---------------------------------------------------------------------------
-- Push it through and take it, in one press.
--
-- WHY THE QUEUE CAN BE SKIPPED HERE
--
-- The queue exists so that a reference is not allocated for every message that
-- lands in the inbox. It earns its place on a morning's unread mail, most of
-- which is replies and circulars.
--
-- It earns nothing at all when somebody has the message open, has read it, and
-- knows it is theirs. In that moment the decision the queue exists to defer has
-- already been made, and making them queue it, find it again and push it is
-- three steps to record a choice made in the first one.
--
-- So this is not a bypass of the rule. The row still passes through intake, is
-- still promoted by the same function under the same guards, and still leaves
-- the same trail. What changes is that all of it happens in one transaction
-- rather than three presses, and the enquiry comes out assigned.
--
-- p_claim defaults to false, so every existing caller behaves exactly as it
-- did. The old two-argument signature is dropped rather than left beside this
-- one: overloads differing only by a defaulted argument make every call
-- ambiguous, and PostgREST resolves that by picking one and failing oddly.
-- ---------------------------------------------------------------------------

drop function if exists public.promote_intake(uuid, text);

create or replace function public.promote_intake(
  p_id          uuid,
  p_customer_id text default null,
  p_claim       boolean default false
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
  v_name     text;
begin
  select * into v_in from public.intake where id = p_id for update;
  if not found then
    raise exception 'no intake row %', p_id;
  end if;

  -- Pressing the button twice is a question ("did that work?"), not a request
  -- for a second reference. Hand back what the first press produced, and let a
  -- claim still land if the first press did not make one.
  if v_in.status = 'promoted' then
    select * into v_enq from public.enquiries where ref = v_in.enquiry_ref;
    if p_claim and v_enq.assigned_to is null and v_me is not null then
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

  -- The subject is what the sender called it, so it leads the notes.
  if coalesce(v_in.subject, v_in.notes) is not null then
    update public.enquiries
       set notes = trim(both e'\n' from
             concat_ws(e'\n', nullif(trim(coalesce(v_in.subject, '')), ''),
                              nullif(trim(coalesce(v_in.notes, '')), '')))
     where ref = v_enq.ref
    returning notes into v_enq.notes;
  end if;

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
      'conversation_id', v_in.conversation_id
    ),
    v_me
  );

  if v_in.conversation_id is not null then
    insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
    values (v_enq.ref, 'mail_linked', 'Mail thread linked to this enquiry', v_me);
  end if;

  -- Taking it on is the same act as claiming it from the board, so it goes
  -- through the same function and leaves the same 'assigned' event. Somebody
  -- reading the trail later cannot tell which button was pressed, and should
  -- not need to: the fact recorded is identical.
  if p_claim and v_me is not null then
    v_enq := public.claim_enquiry(v_enq.ref);
    select coalesce(nullif(full_name, ''), email) into v_name
      from public.profiles where id = v_me;
  end if;

  return v_enq;
end $fn$;

grant execute on function public.promote_intake(uuid, text, boolean) to authenticated;
