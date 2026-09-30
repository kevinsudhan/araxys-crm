-- 110: Enquiries sweep (30 Sep), the database half.
--
--   create_customer  counted every id's digits as a number, so a single id
--                    not shaped C0001 (a DEMO- showcase customer) failed every
--                    new customer; and two at once could take the same number.
--   create_enquiry   gave a manual enquiry no received date, so its first step
--                    and the board's age read blank.
--   promote_intake   wrote "Mail thread linked to this enquiry" even when the
--                    conversation was already filed on another enquiry and was
--                    left there — the new enquiry had no mail and said it had.

CREATE OR REPLACE FUNCTION public.create_customer(p_name text, p_company text DEFAULT ''::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS customers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n   int;
  v_id  text;
  v_row public.customers;
begin
  -- An address we already know belongs to a customer we already have.
  if p_email is not null then
    select * into v_row from public.customers
      where lower(p_email) = any (select lower(unnest(emails))) limit 1;
    if found then return v_row; end if;
  end if;

  -- 110: one at a time, and counting only ids shaped C0001 — a DEMO- id
  -- (seed-showcase) made the cast fail and every new customer with it.
  perform pg_advisory_xact_lock(hashtext('public.create_customer'));
  select coalesce(max((substring(id from '^C([0-9]+)$'))::int), 0) + 1 into v_n from public.customers;
  v_id := 'C' || lpad(v_n::text, 4, '0');

  insert into public.customers (id, name, company, emails, phones)
  values (
    v_id, p_name, coalesce(p_company, ''),
    case when p_email is null then '{}'::text[] else array[p_email] end,
    case when p_phone is null then '{}'::text[] else array[p_phone] end
  )
  returning * into v_row;

  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.create_enquiry(p_customer_id text, p_source text DEFAULT 'manual'::text, p_origin text DEFAULT NULL::text, p_destination text DEFAULT NULL::text, p_cargo text DEFAULT NULL::text)
 RETURNS enquiries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seq int;
  v_ref text;
  v_row public.enquiries;
begin
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.enquiries where customer_id = p_customer_id;

  v_ref := public.allocate_reference('ALG');

  -- 110: received now, unless the intake it came from says otherwise
  -- (promote_intake sets its own). A manual enquiry had no date at all.
  insert into public.enquiries (ref, customer_id, seq, source, origin, destination, cargo, received_at)
  values (v_ref, p_customer_id, v_seq, p_source, p_origin, p_destination, p_cargo, now())
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
  values (v_ref, 'created', format('Enquiry opened from %s', p_source), auth.uid());

  return v_row;
end $function$;

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
  v_linked   int := 0;
  v_owner    text;
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
    get diagnostics v_linked = row_count;
    if v_linked = 0 then
      select enquiry_ref into v_owner from public.enquiry_threads where conversation_id = v_in.conversation_id;
    end if;
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

  -- 110: said only when it happened. A conversation already filed on another
  -- enquiry stays there, and this one says where it is.
  if v_linked > 0 then
    insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
    values (v_enq.ref, 'mail_linked', 'Mail thread linked to this enquiry', v_me);
  elsif v_owner is not null then
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_enq.ref, 'mail_elsewhere', format('Its mail thread is filed on %s, and stays there', v_owner),
            jsonb_build_object('conversation_id', v_in.conversation_id, 'on', v_owner), v_me);
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

revoke execute on function public.create_customer(text, text, text, text) from public, anon;
revoke execute on function public.create_enquiry(text, text, text, text, text) from public, anon;
revoke execute on function public.promote_intake(uuid, text, boolean, uuid) from public, anon;
