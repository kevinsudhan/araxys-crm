-- ---------------------------------------------------------------------------
-- Asking partners for a rate, and keeping track of what comes back.
--
-- WHAT THIS MODELS
--
-- One row per partner per ask. A "burst" — the same request sent to six agents
-- at once — is six rows sharing a batch id, because the interesting questions
-- are all per partner: did this one reply, what did they quote, how long did
-- they take. A single row for the batch would answer none of them.
--
-- WHY conversation_id IS THE KEY TO THE REPLY
--
-- It is the only identifier that survives the round trip. The subject gets
-- "RE:" prepended and sometimes rewritten; the sender address can be a shared
-- mailbox that differs from the one we wrote to; the message id changes. The
-- conversation is what Outlook itself threads on, so it is what we thread on.
--
-- Each partner is written to SEPARATELY rather than as one mail with six
-- recipients. Six recipients is one conversation, so every reply would land in
-- the same thread and there would be no way to attribute a rate to the agent
-- who sent it. It also means none of them can see who else was asked, which is
-- how a rate request should work.
-- ---------------------------------------------------------------------------

create table if not exists public.partner_quotes (
  id             uuid primary key default gen_random_uuid(),
  enquiry_ref    text not null references public.enquiries(ref) on delete cascade,
  partner_id     uuid references public.partners(id) on delete set null,

  -- Kept alongside partner_id rather than only joined: the address we actually
  -- wrote to is a fact about this ask, and a partner's address can change
  -- afterwards without rewriting what happened.
  partner_email  text not null,
  partner_label  text not null default '',

  -- One burst, one batch.
  batch_id       uuid not null,

  sent_at        timestamptz not null default now(),
  sent_by        uuid references auth.users(id),
  subject        text not null default '',
  conversation_id text,
  sent_message_id text,

  status         text not null default 'asked'
                   check (status in ('asked','replied','quoted','declined','no_reply')),

  -- What they came back with. All nullable: a reply is not always a quote, and
  -- a quote is not always complete.
  replied_at        timestamptz,
  reply_message_id  text,
  amount            numeric,
  currency          text,
  transit_days      int,
  valid_until       date,
  quote_notes       text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists pq_enquiry_idx      on public.partner_quotes (enquiry_ref, sent_at desc);
create index if not exists pq_conversation_idx on public.partner_quotes (conversation_id);
create index if not exists pq_batch_idx        on public.partner_quotes (batch_id);

-- One ask per partner per enquiry per batch. Pressing send twice on a slow
-- connection should not produce two rows for the same agent.
create unique index if not exists pq_once_per_batch
  on public.partner_quotes (batch_id, partner_email);

alter table public.partner_quotes enable row level security;

-- The desk is one team and these are the desk's own records. Same shape as the
-- other operational tables: any signed-in employee, nothing for anon.
drop policy if exists pq_select on public.partner_quotes;
create policy pq_select on public.partner_quotes for select to authenticated using (true);

drop policy if exists pq_insert on public.partner_quotes;
create policy pq_insert on public.partner_quotes for insert to authenticated with check (true);

drop policy if exists pq_update on public.partner_quotes;
create policy pq_update on public.partner_quotes for update to authenticated using (true);

revoke all on public.partner_quotes from anon;

-- ---------------------------------------------------------------------------
-- Recording that a partner was asked.
--
-- Written from the browser after each send succeeds rather than before, so a
-- send that fails leaves no row claiming somebody was asked when they were not.
-- ---------------------------------------------------------------------------
create or replace function public.record_rfq_sent(
  p_ref             text,
  p_batch_id        uuid,
  p_partner_email   text,
  p_partner_label   text default '',
  p_partner_id      uuid default null,
  p_subject         text default '',
  p_conversation_id text default null,
  p_message_id      text default null
) returns public.partner_quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.partner_quotes;
begin
  if coalesce(btrim(p_partner_email), '') = '' then
    raise exception 'a partner needs an address to be asked at';
  end if;

  insert into public.partner_quotes
    (enquiry_ref, partner_id, partner_email, partner_label, batch_id,
     sent_by, subject, conversation_id, sent_message_id)
  values
    (p_ref, p_partner_id, lower(btrim(p_partner_email)), coalesce(p_partner_label, ''),
     p_batch_id, auth.uid(), coalesce(p_subject, ''), p_conversation_id, p_message_id)
  on conflict (batch_id, partner_email) do update
    set conversation_id = coalesce(excluded.conversation_id, partner_quotes.conversation_id),
        sent_message_id = coalesce(excluded.sent_message_id, partner_quotes.sent_message_id),
        updated_at = now()
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function
  public.record_rfq_sent(text, uuid, text, text, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording what came back.
--
-- The reply and the quote are one function, because in practice they arrive
-- together: the mail IS the quote. Passing an amount moves the row to 'quoted';
-- passing none leaves it at 'replied', which is the honest state for "they
-- wrote back and it needs reading".
-- ---------------------------------------------------------------------------
create or replace function public.record_rfq_reply(
  p_id           uuid,
  p_message_id   text,
  p_replied_at   timestamptz default now(),
  p_amount       numeric default null,
  p_currency     text default null,
  p_transit_days int default null,
  p_valid_until  date default null,
  p_notes        text default null,
  p_declined     boolean default false
) returns public.partner_quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.partner_quotes;
  v_was text;
begin
  select status into v_was from public.partner_quotes where id = p_id;
  if not found then
    raise exception 'no partner quote %', p_id;
  end if;

  update public.partner_quotes
     set reply_message_id = coalesce(p_message_id, reply_message_id),
         replied_at       = coalesce(replied_at, p_replied_at),
         amount           = coalesce(p_amount, amount),
         currency         = coalesce(p_currency, currency),
         transit_days     = coalesce(p_transit_days, transit_days),
         valid_until      = coalesce(p_valid_until, valid_until),
         quote_notes      = coalesce(p_notes, quote_notes),
         status           = case
                              when p_declined then 'declined'
                              when coalesce(p_amount, amount) is not null then 'quoted'
                              else 'replied'
                            end,
         updated_at       = now()
   where id = p_id
  returning * into v_row;

  -- One timeline entry the first time a partner comes back, not on every
  -- re-scan of the same mail.
  if v_was = 'asked' then
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (
      v_row.enquiry_ref,
      'partner_replied',
      case
        when v_row.status = 'declined' then format('%s declined', coalesce(nullif(v_row.partner_label,''), v_row.partner_email))
        when v_row.amount is not null then format('%s quoted %s %s',
             coalesce(nullif(v_row.partner_label,''), v_row.partner_email),
             coalesce(v_row.currency,''), v_row.amount)
        else format('%s replied', coalesce(nullif(v_row.partner_label,''), v_row.partner_email))
      end,
      jsonb_build_object('partner_quote_id', v_row.id, 'message_id', p_message_id),
      auth.uid()
    );
  end if;

  return v_row;
end $fn$;

grant execute on function
  public.record_rfq_reply(uuid, text, timestamptz, numeric, text, int, date, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- A correction by hand.
--
-- The model reads a rate out of a reply and is sometimes wrong, so there has to
-- be a way to say what the number actually is. Same function as the automatic
-- path deliberately — one place where a quote is written.
-- ---------------------------------------------------------------------------
create or replace function public.set_quote(
  p_id           uuid,
  p_amount       numeric default null,
  p_currency     text default null,
  p_transit_days int default null,
  p_valid_until  date default null,
  p_notes        text default null,
  p_status       text default null
) returns public.partner_quotes
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.partner_quotes;
begin
  update public.partner_quotes
     set amount       = p_amount,
         currency     = p_currency,
         transit_days = p_transit_days,
         valid_until  = p_valid_until,
         quote_notes  = coalesce(p_notes, quote_notes),
         status       = coalesce(p_status,
                          case when p_amount is not null then 'quoted' else status end),
         updated_at   = now()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'no partner quote %', p_id;
  end if;
  return v_row;
end $fn$;

grant execute on function
  public.set_quote(uuid, numeric, text, int, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Marking the ones that never answered.
--
-- Not a cron job. "No reply" is a judgement about whether you are still waiting,
-- and the person chasing the rate is the one who knows.
-- ---------------------------------------------------------------------------
create or replace function public.mark_no_reply(p_id uuid)
returns public.partner_quotes
language sql
security definer
set search_path = public
as $$
  update public.partner_quotes
     set status = 'no_reply', updated_at = now()
   where id = p_id and status = 'asked'
  returning *;
$$;

grant execute on function public.mark_no_reply(uuid) to authenticated;
