-- ---------------------------------------------------------------------------
-- Intake: things that have arrived and are not yet a case.
--
-- WHY THERE IS A STAGE BEFORE THE PIPELINE
--
-- Until now anything that reached the desk became an enquiry immediately. A
-- call landed, ingest created a customer and a reference, and the inbound board
-- grew a row. That is fine when every call is a real shipper, and wrong the
-- rest of the time: a wrong number, a test call, somebody asking a question,
-- an existing customer chasing a booking. Each of those minted a permanent
-- reference and a customer record that nobody can tidy away, because an enquiry
-- is never deleted — the correspondence attached to it is the record of what
-- was said.
--
-- So intake is the holding area. A row here costs nothing and commits to
-- nothing. Somebody looks at it and either pushes it into the inbound pipeline,
-- where it becomes a reference the customer will see, or dismisses it with a
-- reason. Both outcomes are recorded; neither is silent.
--
-- WHAT THIS TABLE IS NOT
--
-- It is not a second copy of the enquiry. It holds only what you need to decide
-- whether this is worth opening: who rang, roughly what about, and where it
-- came from. Everything else is captured on the case file afterwards, by the
-- code that already does it. Duplicating the cargo fields here would mean two
-- places to fix when a dimension is wrong.
-- ---------------------------------------------------------------------------

create table if not exists public.intake (
  id            uuid primary key default gen_random_uuid(),

  status        text not null default 'new'
                  check (status in ('new', 'promoted', 'dismissed')),
  channel       text not null default 'manual'
                  check (channel in ('call', 'email', 'whatsapp', 'web', 'walk_in', 'manual')),

  -- Who got in touch. All optional: a missed call has a number and nothing
  -- else, and inventing a name to satisfy a NOT NULL is exactly the habit this
  -- system exists to refuse.
  contact_name  text,
  company       text,
  phone         text,
  email         text,

  -- Roughly what about. Enough to triage, not enough to quote.
  origin        text,
  destination   text,
  cargo         text,
  notes         text,

  -- Where it came from, so the trail back to the source survives promotion.
  call_id       text references public.calls(call_id) on delete set null,
  message_id    text,

  -- How it ended.
  enquiry_ref       text references public.enquiries(ref) on delete set null,
  dismissed_reason  text,

  received_at   timestamptz not null default now(),
  captured_by   uuid references auth.users(id),
  settled_at    timestamptz,
  settled_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now()
);

create index if not exists intake_status_idx  on public.intake (status, received_at desc);
-- One intake row per call, so pressing capture twice on the same call cannot
-- produce two queue entries that then become two enquiries.
create unique index if not exists intake_call_uniq
  on public.intake (call_id) where call_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: same shape as the rest of the operational tables.
-- ---------------------------------------------------------------------------
alter table public.intake enable row level security;

drop policy if exists intake_read on public.intake;
create policy intake_read on public.intake
  for select to authenticated using (true);

drop policy if exists intake_insert on public.intake;
create policy intake_insert on public.intake
  for insert to authenticated with check (true);

drop policy if exists intake_update on public.intake;
create policy intake_update on public.intake
  for update to authenticated using (true) with check (true);

-- Deliberately no delete policy. A dismissed row stays, with its reason, so
-- "we decided this was not a shipment" is answerable six months later.

-- ---------------------------------------------------------------------------
-- Capture an unmatched call into the queue.
--
-- A call the ingest could not tie to a customer currently sits in the calls
-- table and appears on no board at all. This lifts it into intake with the
-- little that is known about it, and is idempotent: called twice on the same
-- call it returns the row that already exists rather than making a second one.
-- ---------------------------------------------------------------------------
create or replace function public.capture_call_as_intake(p_call_id text)
returns public.intake
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_call public.calls;
  v_row  public.intake;
begin
  select * into v_call from public.calls where call_id = p_call_id;
  if not found then
    raise exception 'no call %', p_call_id;
  end if;

  if v_call.enquiry_ref is not null then
    raise exception 'call % is already on enquiry %', p_call_id, v_call.enquiry_ref;
  end if;

  select * into v_row from public.intake where call_id = p_call_id;
  if found then
    return v_row;
  end if;

  insert into public.intake (channel, phone, notes, call_id, received_at, captured_by)
  values (
    'call',
    v_call.from_number,
    nullif(v_call.summary, ''),
    p_call_id,
    coalesce(v_call.started_at, now()),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.capture_call_as_intake(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Push an intake row into the inbound pipeline.
--
-- This is the moment the desk commits: a customer record and a reference the
-- caller will be quoted under. Everything happens in one transaction, because
-- a customer created without its enquiry is a duplicate waiting to be made on
-- the retry.
--
-- p_customer_id is optional. Given, the enquiry attaches to that existing
-- customer — which is the common case for a caller the desk already knows.
-- Omitted, create_customer decides: it returns the existing customer when the
-- email is one it has already seen, and mints a new one otherwise.
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

  if v_in.notes is not null and trim(v_in.notes) <> '' then
    update public.enquiries set notes = v_in.notes where ref = v_enq.ref;
    v_enq.notes := v_in.notes;
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
    jsonb_build_object('intake_id', p_id, 'channel', v_in.channel, 'call_id', v_in.call_id),
    auth.uid()
  );

  return v_enq;
end $fn$;

grant execute on function public.promote_intake(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Set it aside, with a reason.
--
-- The reason is required. "Dismissed" on its own tells the next person nothing,
-- and the whole value of keeping the row is being able to answer why later.
-- ---------------------------------------------------------------------------
create or replace function public.dismiss_intake(p_id uuid, p_reason text)
returns public.intake
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.intake;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'say why this is being set aside';
  end if;

  update public.intake
     set status           = 'dismissed',
         dismissed_reason = trim(p_reason),
         settled_at       = now(),
         settled_by       = auth.uid(),
         updated_at       = now()
   where id = p_id and status = 'new'
  returning * into v_row;

  if not found then
    raise exception 'intake % is not open', p_id;
  end if;

  return v_row;
end $fn$;

grant execute on function public.dismiss_intake(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Put a dismissed row back in the queue.
--
-- Dismissing is a judgement, and judgements get revisited when the same caller
-- rings again. The old reason is cleared rather than kept, because a row that
-- is open again has no current reason for having been closed.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_intake(p_id uuid)
returns public.intake
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.intake;
begin
  update public.intake
     set status           = 'new',
         dismissed_reason = null,
         settled_at       = null,
         settled_by       = null,
         updated_at       = now()
   where id = p_id and status = 'dismissed'
  returning * into v_row;

  if not found then
    raise exception 'intake % is not dismissed', p_id;
  end if;

  return v_row;
end $fn$;

grant execute on function public.reopen_intake(uuid) to authenticated;
