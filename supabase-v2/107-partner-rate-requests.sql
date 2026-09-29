-- 107: Rate requests to partners for a job, each partner for the services the
-- desk chose for them — from the enquiry's Partner quotes or from Live rates.
--
--   partner_quotes.services   what that partner was asked to price ("Ocean
--                             freight", "Destination charges", ...). Empty
--                             for asks made before 107.
--   partner_quotes.sent_from  the mailbox it went from: the sender's login.
--                             The thread, and the partner's reply, are in
--                             that mailbox.
--   partner_quotes.source     where it was sent from: the case file or Live
--                             rates.
--
-- record_rfq_sent now also files the mail on the job, in the same
-- transaction as the record of it:
--   * the conversation is bound to the enquiry (enquiry_threads), so the
--     request and every reply show in the case file's correspondence;
--   * the partner joins the enquiry's parties under their directory role,
--     unless someone with that address is already on it, so the case file
--     knows whose mail it is;
--   * the enquiry's timeline says who was asked for what.

alter table public.partner_quotes
  add column if not exists services  text[] not null default '{}',
  add column if not exists sent_from text,
  add column if not exists source    text not null default 'case_file';

alter table public.partner_quotes drop constraint if exists partner_quotes_source_check;
alter table public.partner_quotes
  add constraint partner_quotes_source_check check (source in ('case_file', 'live_rates'));

alter table public.partner_quotes drop constraint if exists partner_quotes_services_check;
alter table public.partner_quotes
  add constraint partner_quotes_services_check
  check (cardinality(services) <= 15 and length(array_to_string(services, '|')) <= 2000);

-- The new signature replaces the old one outright: two overloads would leave
-- the old one callable without services.
drop function if exists public.record_rfq_sent(text, uuid, text, text, uuid, text, text, text);

create or replace function public.record_rfq_sent(
  p_ref             text,
  p_batch_id        uuid,
  p_partner_email   text,
  p_partner_label   text default '',
  p_partner_id      uuid default null,
  p_subject         text default '',
  p_conversation_id text default null,
  p_message_id      text default null,
  p_services        text[] default '{}',
  p_source          text default 'case_file'
)
returns public.partner_quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.partner_quotes;
  v_ref      text := upper(btrim(coalesce(p_ref, '')));
  v_email    text := lower(btrim(coalesce(p_partner_email, '')));
  v_services text[];
  v_from     text;
  v_partner  public.partners;
  v_role     text := 'other';
  v_new      boolean;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid()) then
    raise exception 'Staff only.';
  end if;
  if v_email = '' then
    raise exception 'a partner needs an address to be asked at';
  end if;
  if not exists (select 1 from public.enquiries e where e.ref = v_ref) then
    raise exception 'No enquiry %.', v_ref;
  end if;
  if coalesce(p_source, '') not in ('case_file', 'live_rates') then
    raise exception 'Unknown source %.', p_source;
  end if;

  -- Trimmed, blanks and repeats dropped, in the order given.
  select coalesce(array_agg(s order by o), '{}')
    into v_services
    from (
      select btrim(x) as s, min(o) as o
        from unnest(coalesce(p_services, '{}')) with ordinality as u(x, o)
       where btrim(x) <> ''
       group by btrim(x)
    ) z;

  select lower(p.email) into v_from from public.profiles p where p.id = auth.uid();
  -- A repeat for the same partner and batch updates the row; it is not a second ask.
  v_new := not exists (select 1 from public.partner_quotes q where q.batch_id = p_batch_id and q.partner_email = v_email);

  insert into public.partner_quotes
    (enquiry_ref, partner_id, partner_email, partner_label, batch_id,
     sent_by, subject, conversation_id, sent_message_id, services, sent_from, source)
  values
    (v_ref, p_partner_id, v_email, coalesce(p_partner_label, ''),
     p_batch_id, auth.uid(), coalesce(p_subject, ''), p_conversation_id, p_message_id,
     v_services, v_from, p_source)
  on conflict (batch_id, partner_email) do update
    set conversation_id = coalesce(excluded.conversation_id, partner_quotes.conversation_id),
        sent_message_id = coalesce(excluded.sent_message_id, partner_quotes.sent_message_id),
        services        = case when cardinality(excluded.services) > 0 then excluded.services else partner_quotes.services end,
        updated_at      = now()
  returning * into v_row;

  -- The thread, on the job. A conversation already filed elsewhere stays
  -- where it is: this one was just started, so that is never ours to move.
  if p_conversation_id is not null and btrim(p_conversation_id) <> '' then
    insert into public.enquiry_threads (conversation_id, enquiry_ref, bound_by)
    values (p_conversation_id, v_ref, auth.uid())
    on conflict (conversation_id) do nothing;
  end if;

  -- The partner, among the job's parties.
  if p_partner_id is not null then
    select * into v_partner from public.partners pa where pa.id = p_partner_id;
    if found then v_role := v_partner.role; end if;
  end if;
  if not exists (
    select 1 from public.enquiry_parties ep
     where ep.enquiry_ref = v_ref
       and exists (select 1 from unnest(ep.emails) em where lower(em) = v_email)
  ) then
    insert into public.enquiry_parties (enquiry_ref, role, name, organisation, emails)
    values (
      v_ref,
      v_role,
      coalesce(nullif(btrim(v_partner.name), ''), nullif(btrim(p_partner_label), ''), v_email),
      coalesce(v_partner.organisation, ''),
      array[v_email]
    );
  end if;

  if v_new then
  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ref,
    'partner_asked',
    'Rate requested from ' || coalesce(nullif(btrim(p_partner_label), ''), v_email)
      || case when cardinality(v_services) > 0 then ' for ' || array_to_string(v_services, ', ') else '' end
      || case when p_source = 'live_rates' then ' (from Live rates)' else '' end,
    jsonb_build_object('partner_quote_id', v_row.id, 'partner_email', v_email, 'services', to_jsonb(v_services), 'source', p_source),
    auth.uid()
  );
  end if;

  return v_row;
end $$;

revoke execute on function public.record_rfq_sent(text, uuid, text, text, uuid, text, text, text, text[], text) from public, anon;
grant execute on function public.record_rfq_sent(text, uuid, text, text, uuid, text, text, text, text[], text) to authenticated;
