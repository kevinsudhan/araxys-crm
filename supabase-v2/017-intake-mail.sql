-- ---------------------------------------------------------------------------
-- Mail into the intake queue.
--
-- WHY A CONVERSATION ID AND NOT JUST THE MESSAGE
--
-- A message id names one email. A conversation id names the exchange it
-- belongs to, and that is what the CRM files replies against: bind the
-- conversation to a reference once, and everything the customer sends
-- afterwards attaches itself without anybody touching it again.
--
-- Capturing only the message would mean the reply to the email that started
-- the case arrives unattached, and somebody has to file it by hand. So the
-- conversation is carried through the queue and bound at the moment the row
-- becomes an enquiry — the same instant the reference it would be bound to
-- comes into existence.
--
-- The subject gets its own column rather than being folded into notes. Notes
-- are what an operator wrote; the subject is what the sender wrote, and the
-- two answer different questions when you are deciding whether this is worth
-- opening.
-- ---------------------------------------------------------------------------

alter table public.intake add column if not exists conversation_id text;
alter table public.intake add column if not exists subject text;

-- One queue row per message, so pressing push on the same email twice cannot
-- produce two entries that then become two references for one conversation.
create unique index if not exists intake_message_uniq
  on public.intake (message_id) where message_id is not null;

-- ---------------------------------------------------------------------------
-- Capture an email into the queue.
--
-- Unlike a call, mail does not live in a table here — it is read from Graph at
-- the moment somebody looks at it. So the fields arrive as arguments rather
-- than being looked up, and this function's job is the part the browser cannot
-- do safely: decide whether this message is already queued, and return the
-- existing row if it is.
-- ---------------------------------------------------------------------------
create or replace function public.capture_message_as_intake(
  p_message_id      text,
  p_conversation_id text default null,
  p_subject         text default null,
  p_contact_name    text default null,
  p_email           text default null,
  p_preview         text default null,
  p_received_at     timestamptz default null
) returns public.intake
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.intake;
begin
  if p_message_id is null or trim(p_message_id) = '' then
    raise exception 'a message id is required';
  end if;

  select * into v_row from public.intake where message_id = p_message_id;
  if found then
    return v_row;
  end if;

  -- An email already filed against an enquiry is not a new enquiry. Catching it
  -- here rather than in the interface means it holds however the row was made.
  if exists (select 1 from public.enquiry_messages where message_id = p_message_id) then
    raise exception 'that message is already filed against an enquiry';
  end if;

  insert into public.intake (
    channel, contact_name, email, subject, notes,
    message_id, conversation_id, received_at, captured_by
  )
  values (
    'email',
    nullif(trim(coalesce(p_contact_name, '')), ''),
    lower(nullif(trim(coalesce(p_email, '')), '')),
    nullif(trim(coalesce(p_subject, '')), ''),
    nullif(trim(coalesce(p_preview, '')), ''),
    p_message_id,
    nullif(trim(coalesce(p_conversation_id, '')), ''),
    coalesce(p_received_at, now()),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.capture_message_as_intake(
  text, text, text, text, text, text, timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- promote_intake, now binding the mail thread as well.
--
-- Replaced whole rather than patched, because this is the one function where
-- the ordering matters and reading it in one piece is how you check that.
-- ---------------------------------------------------------------------------
create or replace function public.promote_intake(
  p_id          uuid,
  p_customer_id text default null
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
begin
  select * into v_in from public.intake where id = p_id for update;
  if not found then
    raise exception 'no intake row %', p_id;
  end if;

  -- Pressing the button twice is a question ("did that work?"), not a request
  -- for a second reference. Hand back what the first press produced.
  if v_in.status = 'promoted' then
    select * into v_enq from public.enquiries where ref = v_in.enquiry_ref;
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
  -- this table. It records as manual, which is what it is from the pipeline's
  -- point of view: a person typed it in.
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

  -- The call that started this now belongs to the case file, so the transcript
  -- is where somebody reading the enquiry will look for it.
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
    values (v_in.conversation_id, v_enq.ref, auth.uid())
    on conflict (conversation_id) do nothing;
  end if;

  -- And pin the message itself, which covers the case where the customer
  -- starts a fresh conversation instead of replying.
  if v_in.message_id is not null then
    insert into public.enquiry_messages (message_id, enquiry_ref, via, linked_by)
    values (v_in.message_id, v_enq.ref, 'manual', auth.uid())
    on conflict (message_id, enquiry_ref) do nothing;
  end if;

  update public.intake
     set status      = 'promoted',
         enquiry_ref = v_enq.ref,
         settled_at  = now(),
         settled_by  = auth.uid(),
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
    auth.uid()
  );

  if v_in.conversation_id is not null then
    insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
    values (v_enq.ref, 'mail_linked', 'Mail thread linked to this enquiry', auth.uid());
  end if;

  return v_enq;
end $fn$;

grant execute on function public.promote_intake(uuid, text) to authenticated;
