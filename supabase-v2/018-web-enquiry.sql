-- ---------------------------------------------------------------------------
-- Website form submissions into the queue, with their fields already read.
--
-- The live form posts through Netlify, which means the message arrives from
-- formresponses@netlify.com with the visitor's own details written into the
-- body under labels. The sender in the header is a mailer, not a customer.
--
-- Capturing one of these with the old function would have filed it as a plain
-- email with Netlify as the contact. So the capture takes the parsed fields
-- instead: the browser reads the labels, this writes what it read. Recognition
-- and parsing stay in the client because that is where the message is — mail is
-- fetched from Graph with the signed-in user's token and never touches this
-- database.
--
-- The old six-argument signature is dropped rather than left beside this one.
-- Two overloads differing only in defaulted arguments make every call
-- ambiguous, and PostgREST resolves that by picking one and failing oddly.
-- ---------------------------------------------------------------------------

drop function if exists public.capture_message_as_intake(
  text, text, text, text, text, text, timestamptz
);

create or replace function public.capture_message_as_intake(
  p_message_id      text,
  p_conversation_id text default null,
  p_subject         text default null,
  p_contact_name    text default null,
  p_email           text default null,
  p_preview         text default null,
  p_received_at     timestamptz default null,
  -- Everything below arrives only when the message was recognised as a website
  -- form submission and its body has been read.
  p_channel         text default 'email',
  p_company         text default null,
  p_phone           text default null,
  p_origin          text default null,
  p_destination     text default null,
  p_cargo           text default null
) returns public.intake
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row  public.intake;
  v_trim text;
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

  -- The channel is the caller's claim about what this is. Only the two values
  -- that can reach here are accepted, so a typo cannot invent a third.
  v_trim := lower(coalesce(nullif(trim(p_channel), ''), 'email'));
  if v_trim not in ('email', 'web') then
    raise exception 'a captured message is email or web, not %', p_channel;
  end if;

  insert into public.intake (
    channel, contact_name, company, email, phone,
    origin, destination, cargo,
    subject, notes,
    message_id, conversation_id, received_at, captured_by
  )
  values (
    v_trim,
    nullif(trim(coalesce(p_contact_name, '')), ''),
    nullif(trim(coalesce(p_company, '')), ''),
    lower(nullif(trim(coalesce(p_email, '')), '')),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_origin, '')), ''),
    nullif(trim(coalesce(p_destination, '')), ''),
    nullif(trim(coalesce(p_cargo, '')), ''),
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
  text, text, text, text, text, text, timestamptz, text, text, text, text, text, text
) to authenticated;
