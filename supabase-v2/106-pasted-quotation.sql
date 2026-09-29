-- 106: A quotation pasted in, laid out by the AI, and sent as plain text.
--
-- ---------------------------------------------------------------------------
-- Quotation → "Paste a quotation": the rate as the desk has it (a mail, a
-- WhatsApp message, a rate sheet) is read by the AI into charge lines, each
-- one filed under Ex works or Other charges. The lines are the quotation's
-- ordinary lines — approval, the total (quote_lines_touch), the PDF and the
-- invoice all work from them as before.
--
--   quote_lines.section   'ex_works' | 'other' | null. The PDF prints the
--                         groups under their own titles when any line has one.
--   quotes.mail_text      The quotation as plain text, laid out by the app from
--                         those lines (not by the AI: the AI never adds up), for
--                         the body of the mail. When present the mail is this
--                         text rather than the designed letter; the PDF goes
--                         with it either way.
--   quotes.pasted_text    What was pasted, kept so the figures can be checked
--                         against their source.
--
-- The mail text is something the customer reads, so changing it after approval
-- un-approves the draft, as a change to the amount or the terms does (052).
-- ---------------------------------------------------------------------------

alter table public.quote_lines add column if not exists section text;
alter table public.quote_lines drop constraint if exists quote_lines_section_check;
alter table public.quote_lines add constraint quote_lines_section_check check (section is null or section in ('ex_works', 'other'));

alter table public.quotes add column if not exists mail_text text;
alter table public.quotes add column if not exists pasted_text text;

CREATE OR REPLACE FUNCTION public.require_approval_to_send()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 1. A change to what the customer reads un-approves an approved draft.
  if tg_op = 'UPDATE'
     and old.status = 'draft'
     and old.approval_status = 'approved'
     and new.approval_status = 'approved'
     and auth.uid() is not null
     and not public.approval_exempt(auth.uid())
     and (   new.amount_inr    is distinct from old.amount_inr
          or new.currency      is distinct from old.currency
          or new.fx_rate       is distinct from old.fx_rate
          or new.basis         is distinct from old.basis
          or new.valid_until   is distinct from old.valid_until
          or new.sailing_date  is distinct from old.sailing_date
          or new.quote_type    is distinct from old.quote_type
          or new.multi_carrier is distinct from old.multi_carrier
          or new.terms         is distinct from old.terms
          or new.mail_text     is distinct from old.mail_text)
  then
    new.approval_status := 'draft';
    new.approved_at     := null;
    new.approved_by     := null;
    new.approval_note   := 'Changed after approval — send it for approval again';
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (
      new.enquiry_ref,
      'quote_approval_reset',
      'Quotation v' || new.version || ' changed after approval — needs approving again',
      jsonb_build_object('quote_id', new.id, 'version', new.version),
      auth.uid()
    );
  end if;

  -- 2. Only an exempt caller, or the system, can make a quotation approved.
  --    Or self_approve_quote (091), which sets the flag for its own
  --    transaction only; nothing a browser sends can set it.
  if new.approval_status = 'approved'
     and (tg_op = 'INSERT' or old.approval_status is distinct from 'approved')
     and auth.uid() is not null
     and not public.approval_exempt(auth.uid())
     and coalesce(current_setting('app.self_approving', true), '') <> 'on'
  then
    raise exception 'only an admin can approve a quotation';
  end if;

  -- 3. Nothing reaches the customer uncleared; an exempt sender clears it.
  if new.status in ('sent', 'accepted')
     and (tg_op = 'INSERT' or old.status = 'draft')
     and coalesce(new.approval_status, 'draft') <> 'approved'
  then
    if public.approval_exempt(auth.uid()) then
      new.approval_status := 'approved';
      new.approved_by     := auth.uid();
      new.approved_at     := now();
      new.approval_note   := 'No approval needed: sent by an admin';
    else
      raise exception 'quotation v% has not been approved, so it cannot be %',
        new.version, new.status
        using hint = 'Send it for approval first.';
    end if;
  end if;

  return new;
end $function$;

-- Unchanged from before: a trigger function is not called through the API, and
-- nobody should be able to call it directly.
revoke execute on function public.require_approval_to_send() from public, anon;
