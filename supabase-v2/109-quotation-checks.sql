-- 109: A quotation that cannot be right does not go to the customer.
--
-- Found in the enquiries sweep (30 Sep): a charge switched to USD kept the
-- rate of exchange of 1 it had as rupees, so "USD 15" counted as Rs 15 in the
-- total (ALG09011-26, ALG09012-26); a quotation totalling Rs 0 was sent and
-- accepted (ALG09009-26); a charge row with no name was left on a draft
-- (ALG09008-26). None of it was refused anywhere.
--
--   quote_problems(quote)       what is wrong with it, in sentences.
--   quote_ready_or_raise(quote) refuses, listing them.
--
-- Checked when a quotation is sent for approval, approved by its writer, and
-- when it leaves draft for the customer (require_approval_to_send, rule 4).
-- A charge priced at nothing is allowed on its own ("at actuals", "included")
-- as long as the quotation adds up to something. The screen shows the same
-- list before any of those buttons is pressed (lib/quoteChecks.ts).

create or replace function public.quote_problems(p_quote_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  with q as (
    select * from public.quotes where id = p_quote_id
  ),
  l as (
    select row_number() over (order by position, id) as n, *
      from public.quote_lines
     where quote_id = p_quote_id
  )
  select
    array_remove(array[
      case when not exists (select 1 from l) then 'It has no charges.' end,
      case when exists (select 1 from l) and coalesce((select sum(amount_inr) from l), 0) <= 0 then 'It adds up to nothing (Rs 0).' end
    ], null)
    || coalesce((select array_agg(format('Charge %s has no name.', n) order by n) from l where btrim(coalesce(description, '')) = ''), '{}')
    || coalesce((
         select array_agg(format('%s is in %s with no rate of exchange.', coalesce(nullif(btrim(description), ''), 'Charge ' || n), currency) order by n)
           from l
          where coalesce(currency, 'INR') <> 'INR' and (fx_rate is null or fx_rate <= 0 or fx_rate = 1)
       ), '{}')
    || coalesce((
         select array[format('The quotation is in %s with no rate of exchange.', currency)]
           from q
          where coalesce(currency, 'INR') <> 'INR' and (fx_rate is null or fx_rate <= 0 or fx_rate = 1)
       ), '{}')
$$;

create or replace function public.quote_ready_or_raise(p_quote_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems text[] := public.quote_problems(p_quote_id);
begin
  if cardinality(v_problems) > 0 then
    raise exception 'This quotation cannot go to the customer yet: %', array_to_string(v_problems, ' ')
      using hint = 'Put it right in the charges, then try again.';
  end if;
end $$;

revoke execute on function public.quote_problems(uuid) from public, anon, authenticated;
revoke execute on function public.quote_ready_or_raise(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_quote_for_approval(p_quote_id uuid)
 RETURNS quotes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.quotes;
begin
  -- 109: nothing is cleared that cannot go to the customer as it stands.
  perform public.quote_ready_or_raise(p_quote_id);

  if public.approval_exempt(auth.uid()) then
    update public.quotes
       set approval_status = 'approved',
           submitted_at    = coalesce(submitted_at, now()),
           submitted_by    = coalesce(submitted_by, auth.uid()),
           approved_at     = now(),
           approved_by     = auth.uid(),
           approval_note   = 'No approval needed: cleared by an admin'
     where id = p_quote_id
       and status = 'draft'
     returning * into v_row;
  else
    update public.quotes
       set approval_status = 'pending',
           submitted_at    = now(),
           submitted_by    = auth.uid(),
           approval_note   = ''
     where id = p_quote_id
       and status = 'draft'
     returning * into v_row;
  end if;

  if not found then
    raise exception 'that quote cannot be submitted: it is not a draft, or it does not exist';
  end if;
  return v_row;
end $function$;

CREATE OR REPLACE FUNCTION public.self_approve_quote(p_quote_id uuid, p_reason text)
 RETURNS quotes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row    public.quotes;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if length(v_reason) < 10 then
    raise exception 'Say why you are approving it yourself, in a sentence the admins will read';
  end if;

  select * into v_row from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'no such quote';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'That quotation has already gone to the customer';
  end if;
  if v_row.approval_status = 'rejected' then
    raise exception 'An approver sent this quotation back'
      using hint = 'Change it and send it for approval again; their decision stands until then.';
  end if;
  if v_row.approval_status = 'approved' then
    return v_row;
  end if;
  -- 109: nor approved by its writer.
  perform public.quote_ready_or_raise(p_quote_id);

  perform set_config('app.self_approving', 'on', true);
  update public.quotes
     set approval_status           = 'approved',
         submitted_at              = coalesce(submitted_at, now()),
         submitted_by              = coalesce(submitted_by, auth.uid()),
         approved_at               = now(),
         approved_by               = auth.uid(),
         approval_note             = 'Self-approved: ' || v_reason,
         self_approved             = true,
         self_approval_reason      = v_reason,
         self_approval_reviewed_at = null,
         self_approval_reviewed_by = null,
         self_approval_review_note = ''
   where id = p_quote_id
   returning * into v_row;
  perform set_config('app.self_approving', 'off', true);

  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = auth.uid();
  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_row.enquiry_ref,
    'quote_self_approved',
    format('Quotation v%s self-approved by %s: %s', v_row.version, coalesce(v_name, 'the writer'), v_reason),
    jsonb_build_object('quote_id', v_row.id, 'version', v_row.version, 'reason', v_reason),
    auth.uid()
  );
  return v_row;
end $function$;

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

  -- 4 (109). Nothing reaches the customer with no charges, a total of
  --    nothing, a charge with no name, or a foreign charge with no rate of
  --    exchange — whoever sends it, cleared or not.
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status in ('sent', 'accepted') then
    perform public.quote_ready_or_raise(new.id);
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

revoke execute on function public.submit_quote_for_approval(uuid) from public, anon;
revoke execute on function public.self_approve_quote(uuid, text) from public, anon;
revoke execute on function public.require_approval_to_send() from public, anon;
