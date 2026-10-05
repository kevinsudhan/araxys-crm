-- 123: The shipper approves our house B/L draft; a correction after issue is an amendment.
--
-- ---------------------------------------------------------------------------
-- THE DRAFT, APPROVED BY THE SHIPPER
--
-- The step that matters most before a B/L is issued is the shipper checking
-- the draft: the bank negotiates the B/L against their letter of credit, and
-- a wrong word on an original is a correction with originals to take back.
-- Until now the draft could only be downloaded. Now it is mailed to them with
-- a link, the way a quotation is (053): the page shows the draft as it was
-- sent, and the shipper approves it or says what to correct. The link is the
-- whole of their authority, through two functions with a fixed shape.
--
--   approval        none · sent · approved · changes
--   approval_token  the link's token, minted on the first send
--   draft_sent      the draft as sent ({data, hbl_no, release_mode,
--                   originals, amendment}): what an approval is an approval of
--   draft_sent_at / draft_sent_to
--   approval_at / approval_by / approval_note
--                   when they answered, the name they gave (or, recorded by
--                   the desk, how they approved), and the corrections asked
--
-- An approval is of the draft as sent: a B/L changed after it is shown as
-- changed since, and needs sending again. Issuing without one is the desk's
-- call, asked on screen, not refused here.
--
-- A CORRECTION AFTER ISSUE
--
-- 089 already refuses to reopen a B/L whose originals are out. Now reopening
-- also needs a reason, refuses once the cargo has been released against it,
-- counts the amendment (printed on the B/L from then on), withdraws the
-- shipper's approval, and on reissue starts the release again with the new
-- set of originals: the old ones are back with us, and the release steps
-- recorded against them were for a document that no longer stands.
-- ---------------------------------------------------------------------------

alter table public.house_bills
  add column if not exists amendment      int  not null default 0,
  add column if not exists reopen_reason  text not null default '',
  add column if not exists approval       text not null default 'none',
  add column if not exists approval_token uuid,
  add column if not exists draft_sent     jsonb,
  add column if not exists draft_sent_at  timestamptz,
  add column if not exists draft_sent_to  text not null default '',
  add column if not exists approval_at    timestamptz,
  add column if not exists approval_by    text not null default '',
  add column if not exists approval_note  text not null default '';

alter table public.house_bills drop constraint if exists house_bills_amendment_check;
alter table public.house_bills add constraint house_bills_amendment_check check (amendment >= 0);
alter table public.house_bills drop constraint if exists house_bills_approval_check;
alter table public.house_bills add constraint house_bills_approval_check check (approval in ('none', 'sent', 'approved', 'changes'));
create unique index if not exists house_bills_approval_token_idx on public.house_bills (approval_token) where approval_token is not null;

alter table public.house_bill_history drop constraint if exists house_bill_history_action_check;
alter table public.house_bill_history add constraint house_bill_history_action_check
  check (action in ('created', 'updated', 'numbered', 'issued', 'reopened', 'printed', 'released', 'draft_sent', 'approved', 'changes_requested'));


-- ---------------------------------------------------------------------------
-- The guard and the history, on every write (085, 089, with the amendment)
-- ---------------------------------------------------------------------------
create or replace function public.house_bill_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_changes  jsonb;
  v_release  jsonb;
  v_admin    boolean;
  v_ref      text;
  v_moved    boolean;
begin
  if exists (select 1 from public.shipments where id = new.shipment_id and signed_off_at is not null) then
    raise exception '% is signed off; its house B/L is closed with it', new.shipment_id
      using hint = 'Reopen the sign-off first.';
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.status = 'issued' then
      raise exception 'Save the house B/L before issuing it';
    end if;
    insert into public.house_bill_history (shipment_id, actor, action)
    values (new.shipment_id, auth.uid(), 'created');
    return new;
  end if;

  select enquiry_ref into v_ref from public.shipments where id = new.shipment_id;

  -- ---- the release (089) ----
  v_moved := new.charges_received_on   is distinct from old.charges_received_on
          or new.originals_released_on is distinct from old.originals_released_on
          or new.originals_released_to is distinct from old.originals_released_to
          or new.originals_returned    is distinct from old.originals_returned
          or new.originals_returned_on is distinct from old.originals_returned_on
          or new.release_sent_on       is distinct from old.release_sent_on
          or new.release_sent_to       is distinct from old.release_sent_to
          or new.released_on           is distinct from old.released_on
          or new.release_note          is distinct from old.release_note;

  if v_moved then
    if new.status <> 'issued' then
      raise exception 'Issue the house B/L before recording its release';
    end if;
    if new.release_mode = 'telex' and new.release_sent_on is not null and new.originals_returned < new.originals then
      raise exception 'A telex release goes only once all % originals are back (% returned)', new.originals, new.originals_returned
        using hint = 'Record the full set surrendered to us first.';
    end if;
    if new.release_mode = 'express' and (new.originals_released_on is not null or new.originals_returned > 0) then
      raise exception 'A sea waybill has no originals to hand over or take back';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('field', f, 'from', o, 'to', n) order by f), '[]'::jsonb)
      into v_release
      from (values
        ('charges_received_on',   to_jsonb(old.charges_received_on),   to_jsonb(new.charges_received_on)),
        ('originals_released_on', to_jsonb(old.originals_released_on), to_jsonb(new.originals_released_on)),
        ('originals_released_to', to_jsonb(old.originals_released_to), to_jsonb(new.originals_released_to)),
        ('originals_returned',    to_jsonb(old.originals_returned),    to_jsonb(new.originals_returned)),
        ('originals_returned_on', to_jsonb(old.originals_returned_on), to_jsonb(new.originals_returned_on)),
        ('release_sent_on',       to_jsonb(old.release_sent_on),       to_jsonb(new.release_sent_on)),
        ('release_sent_to',       to_jsonb(old.release_sent_to),       to_jsonb(new.release_sent_to)),
        ('released_on',           to_jsonb(old.released_on),           to_jsonb(new.released_on)),
        ('release_note',          to_jsonb(old.release_note),          to_jsonb(new.release_note))
      ) as t(f, o, n)
     where o is distinct from n;

    insert into public.house_bill_history (shipment_id, actor, action, changes)
    values (new.shipment_id, auth.uid(), 'released', v_release);

    -- The moments a colleague reading the case file needs to see.
    if v_ref is not null then
      if new.originals_released_on is not null and old.originals_released_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'hbl_originals_out',
                format('%s original%s of B/L %s handed over%s', new.originals, case when new.originals = 1 then '' else 's' end,
                       coalesce(new.hbl_no, ''), case when btrim(new.originals_released_to) <> '' then ' to ' || btrim(new.originals_released_to) else '' end),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
      if new.originals_returned = new.originals and new.originals > 0 and old.originals_returned < old.originals then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'hbl_surrendered', format('Full set of B/L %s surrendered to us', coalesce(new.hbl_no, '')),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
      if new.release_sent_on is not null and old.release_sent_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'telex_released',
                format('%s for B/L %s sent%s', case when new.release_mode = 'express' then 'Release instructions' else 'Telex release' end,
                       coalesce(new.hbl_no, ''), case when btrim(new.release_sent_to) <> '' then ' to ' || btrim(new.release_sent_to) else '' end),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
      if new.released_on is not null and old.released_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'cargo_released', format('Cargo released at destination against B/L %s', coalesce(new.hbl_no, '')),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
    end if;
  end if;

  -- Reopening an issued B/L is an administrator's call, with a reason. Judged
  -- by the signed-in person: inside this function current_user is its owner.
  -- Not once the originals are out: they are in somebody's hands as printed.
  -- Not once the cargo is released against it: it has done its work.
  if old.status = 'issued' and new.status = 'draft' then
    select coalesce(bool_or(role = 'admin'), false) into v_admin from public.profiles where id = auth.uid();
    if auth.uid() is not null and not v_admin then
      raise exception 'Only an administrator can reopen an issued house B/L';
    end if;
    if old.released_on is not null then
      raise exception 'The cargo has been released against %', coalesce(old.hbl_no, 'this B/L')
        using hint = 'A released B/L can no longer be corrected.';
    end if;
    if old.originals_released_on is not null and old.originals_returned < old.originals then
      raise exception 'The originals of % are out with %', coalesce(old.hbl_no, 'this B/L'), coalesce(nullif(btrim(old.originals_released_to), ''), 'the shipper')
        using hint = 'Take the full set back (record them surrendered) before reopening it for a correction.';
    end if;
    if auth.uid() is not null and btrim(coalesce(new.reopen_reason, '')) = '' then
      raise exception 'Say why % is being reopened', coalesce(old.hbl_no, 'the B/L');
    end if;
    new.issued_at := null;
    new.issued_by := null;
    new.amendment := old.amendment + 1;
    new.reopen_reason := btrim(coalesce(new.reopen_reason, ''));
    -- The shipper approved the B/L as it was; the corrected one is theirs to approve again.
    new.approval := 'none';
    insert into public.house_bill_history (shipment_id, actor, action, note)
    values (new.shipment_id, auth.uid(), 'reopened', format('Reopened for amendment %s: %s', new.amendment, new.reopen_reason));
    if v_ref is not null then
      insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
      values (v_ref, 'hbl_reopened', format('B/L %s reopened for amendment %s: %s', coalesce(old.hbl_no, ''), new.amendment, new.reopen_reason),
              jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', old.hbl_no, 'amendment', new.amendment), auth.uid());
    end if;
    return new;
  end if;

  -- An issued B/L is not edited in place: the shipper, the bank or the
  -- consignee is holding it.
  if old.status = 'issued' and new.status = 'issued'
     and (new.data is distinct from old.data or new.release_mode is distinct from old.release_mode
          or new.originals is distinct from old.originals or new.hbl_no is distinct from old.hbl_no
          or new.mto_partner_id is distinct from old.mto_partner_id or new.amendment is distinct from old.amendment)
  then
    raise exception 'House B/L % has been issued', coalesce(old.hbl_no, '')
      using hint = 'An administrator can set it back to draft to correct it.';
  end if;

  if old.status = 'draft' and new.status = 'issued' then
    if new.hbl_no is null then
      raise exception 'Number the house B/L before issuing it';
    end if;
    new.issued_at := now();
    new.issued_by := auth.uid();
    new.reopen_reason := '';
    -- Reissued after a correction: a new set of originals, so the release
    -- starts again. Whether the freight is paid does not change.
    if new.amendment > 0 then
      new.originals_released_on := null;
      new.originals_released_to := '';
      new.originals_returned    := 0;
      new.originals_returned_on := null;
      new.release_sent_on       := null;
      new.release_sent_to       := '';
      new.released_on           := null;
    end if;
    insert into public.house_bill_history (shipment_id, actor, action, note)
    values (new.shipment_id, auth.uid(), 'issued',
            case new.release_mode
              when 'express' then 'Issued as a sea waybill (express release)'
              else format('%s original%s issued%s', new.originals, case when new.originals = 1 then '' else 's' end,
                          case when new.release_mode = 'telex' then ', for telex release' else '' end)
            end
            || case when new.amendment > 0 then format(' — amendment %s; the release starts again with the new set', new.amendment) else '' end);
    return new;
  end if;

  -- Which boxes changed, from what to what.
  select coalesce(jsonb_agg(jsonb_build_object('field', k, 'from', old.data -> k, 'to', new.data -> k) order by k), '[]'::jsonb)
    into v_changes
    from (select jsonb_object_keys(old.data) as k union select jsonb_object_keys(new.data)) keys
   where (old.data -> k) is distinct from (new.data -> k);

  if new.release_mode is distinct from old.release_mode then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'release_mode', 'from', old.release_mode, 'to', new.release_mode));
  end if;
  if new.originals is distinct from old.originals then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'originals', 'from', old.originals, 'to', new.originals));
  end if;
  if new.mto_partner_id is distinct from old.mto_partner_id then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'mto_partner_id', 'from', old.mto_partner_id, 'to', new.mto_partner_id));
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.house_bill_history (shipment_id, actor, action, changes)
    values (new.shipment_id, auth.uid(), 'updated', v_changes);
  end if;
  return new;
end $fn$;

revoke execute on function public.house_bill_write() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- The desk's side: the link, the send, an approval given another way
-- ---------------------------------------------------------------------------

-- The draft as it stands, in the shape the page and the PDF read.
create or replace function public.house_bill_snapshot(h public.house_bills)
returns jsonb
language sql
immutable
set search_path = public
as $fn$
  select jsonb_build_object('data', h.data, 'hbl_no', h.hbl_no, 'release_mode', h.release_mode, 'originals', h.originals, 'amendment', h.amendment);
$fn$;

revoke execute on function public.house_bill_snapshot(public.house_bills) from public, anon;

-- The link for the shipper, minted once and kept: a draft sent again reaches
-- the same page.
create or replace function public.hbl_draft_link(p_shipment text)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  h public.house_bills;
  v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into h from public.house_bills where shipment_id = p_shipment for update;
  if not found then
    raise exception 'Save the house B/L first';
  end if;
  if h.status <> 'draft' then
    raise exception 'House B/L % is issued: there is no draft to approve', coalesce(h.hbl_no, '');
  end if;
  if h.hbl_no is null then
    raise exception 'Number the house B/L first: name the consignee and save';
  end if;
  v_token := coalesce(h.approval_token, gen_random_uuid());
  if h.approval_token is null then
    update public.house_bills set approval_token = v_token where shipment_id = p_shipment;
  end if;
  return v_token;
end $fn$;

-- The draft has gone to the shipper: what they were sent is what they approve.
create or replace function public.hbl_draft_sent(p_shipment text, p_to text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  h public.house_bills;
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into h from public.house_bills where shipment_id = p_shipment for update;
  if not found or h.approval_token is null then
    raise exception 'Make the draft''s link first';
  end if;
  if h.status <> 'draft' then
    raise exception 'House B/L % is issued: there is no draft to approve', coalesce(h.hbl_no, '');
  end if;
  update public.house_bills
     set approval = 'sent', draft_sent = public.house_bill_snapshot(h), draft_sent_at = now(),
         draft_sent_to = left(btrim(coalesce(p_to, '')), 500), approval_at = null, approval_by = '', approval_note = ''
   where shipment_id = p_shipment;
  insert into public.house_bill_history (shipment_id, actor, action, note)
  values (p_shipment, auth.uid(), 'draft_sent', format('Draft sent to the shipper%s', case when btrim(coalesce(p_to, '')) <> '' then ' at ' || btrim(p_to) else '' end));
  select enquiry_ref into v_ref from public.shipments where id = p_shipment;
  if v_ref is not null then
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_ref, 'hbl_draft_sent', format('Draft B/L %s sent to the shipper for approval', coalesce(h.hbl_no, '')),
            jsonb_build_object('shipment_id', p_shipment, 'hbl_no', h.hbl_no), auth.uid());
  end if;
end $fn$;

-- Approved by mail or on the phone: recorded by the desk, of the draft as it stands.
create or replace function public.hbl_record_approval(p_shipment text, p_how text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  h public.house_bills;
  v_ref text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if btrim(coalesce(p_how, '')) = '' then
    raise exception 'Say how the shipper approved it';
  end if;
  select * into h from public.house_bills where shipment_id = p_shipment for update;
  if not found then
    raise exception 'Save the house B/L first';
  end if;
  if h.status <> 'draft' then
    raise exception 'House B/L % is issued already', coalesce(h.hbl_no, '');
  end if;
  update public.house_bills
     set approval = 'approved', draft_sent = public.house_bill_snapshot(h), approval_at = now(),
         approval_by = left(btrim(p_how), 200), approval_note = ''
   where shipment_id = p_shipment;
  insert into public.house_bill_history (shipment_id, actor, action, note)
  values (p_shipment, auth.uid(), 'approved', 'Recorded by the desk: ' || left(btrim(p_how), 200));
  select enquiry_ref into v_ref from public.shipments where id = p_shipment;
  if v_ref is not null then
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_ref, 'hbl_draft_approved', format('Shipper approved draft B/L %s (%s)', coalesce(h.hbl_no, ''), left(btrim(p_how), 200)),
            jsonb_build_object('shipment_id', p_shipment, 'hbl_no', h.hbl_no), auth.uid());
  end if;
end $fn$;


-- ---------------------------------------------------------------------------
-- The shipper's side: the page, and their answer. The token is the whole of
-- their authority; nothing else of the B/L row or the job can be reached.
-- ---------------------------------------------------------------------------
create or replace function public.hbl_draft_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_token uuid;
  h public.house_bills;
begin
  begin
    v_token := p_token::uuid;
  exception when others then
    return jsonb_build_object('state', 'unknown');
  end;
  select * into h from public.house_bills where approval_token = v_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;
  return jsonb_build_object(
    'state', case when h.status = 'issued' then 'issued' when h.approval = 'none' then 'withdrawn' else h.approval end,
    'hbl_no', h.hbl_no,
    'draft', case when h.approval <> 'none' then h.draft_sent end,
    'sent_at', h.draft_sent_at,
    'answered_at', h.approval_at,
    'answered_by', nullif(h.approval_by, ''),
    'note', nullif(h.approval_note, '')
  );
end $fn$;

create or replace function public.hbl_answer_by_token(p_token text, p_approve boolean, p_name text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_token uuid;
  h public.house_bills;
  v_ref text;
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_note text := left(btrim(coalesce(p_note, '')), 2000);
begin
  begin
    v_token := p_token::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end;
  select * into h from public.house_bills where approval_token = v_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if h.status = 'issued' then
    return jsonb_build_object('ok', false, 'reason', 'issued');
  end if;
  if h.approval = 'none' then
    return jsonb_build_object('ok', false, 'reason', 'withdrawn');
  end if;
  if p_approve and h.approval = 'approved' then
    return jsonb_build_object('ok', true, 'reason', 'already');
  end if;
  if not p_approve and v_note = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  update public.house_bills
     set approval = case when p_approve then 'approved' else 'changes' end,
         approval_at = now(), approval_by = v_name, approval_note = case when p_approve then '' else v_note end
   where shipment_id = h.shipment_id;

  insert into public.house_bill_history (shipment_id, actor, action, note)
  values (h.shipment_id, null, case when p_approve then 'approved' else 'changes_requested' end,
          case when p_approve then 'Approved by the shipper on the link' || case when v_name <> '' then ' (' || v_name || ')' else '' end
               else 'Corrections asked by the shipper' || case when v_name <> '' then ' (' || v_name || ')' else '' end || ': ' || v_note end);

  select enquiry_ref into v_ref from public.shipments where id = h.shipment_id;
  if v_ref is not null then
    insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
    values (v_ref, case when p_approve then 'hbl_draft_approved' else 'hbl_draft_changes' end,
            case when p_approve then format('Shipper approved draft B/L %s', coalesce(h.hbl_no, ''))
                 else format('Shipper asks for corrections to draft B/L %s: %s', coalesce(h.hbl_no, ''), left(v_note, 300)) end,
            jsonb_build_object('shipment_id', h.shipment_id, 'hbl_no', h.hbl_no, 'name', v_name), null);
  end if;
  return jsonb_build_object('ok', true, 'reason', case when p_approve then 'approved' else 'changes' end);
end $fn$;

revoke execute on function public.hbl_draft_link(text) from public, anon;
revoke execute on function public.hbl_draft_sent(text, text) from public, anon;
revoke execute on function public.hbl_record_approval(text, text) from public, anon;
grant execute on function public.hbl_draft_link(text) to authenticated;
grant execute on function public.hbl_draft_sent(text, text) to authenticated;
grant execute on function public.hbl_record_approval(text, text) to authenticated;

revoke execute on function public.hbl_draft_by_token(text) from public;
revoke execute on function public.hbl_answer_by_token(text, boolean, text, text) from public;
grant execute on function public.hbl_draft_by_token(text) to anon, authenticated;
grant execute on function public.hbl_answer_by_token(text, boolean, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
