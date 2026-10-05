-- ---------------------------------------------------------------------------
-- 132: The company's own registrations, house B/Ls under its own MTO, and
-- the electronic B/L.
--
-- REGISTRATIONS
--
-- What lets Aashish Logistics do the work, each with its number, who issued
-- it, when, until when, and (for a bond or a guarantee) for how much: its own
-- MTO registration with the DG Shipping, under which its house B/Ls are
-- issued; its registration with Customs as consol agent; the bond Customs
-- holds for it and the bank guarantee behind the bond; the eBL platform it
-- issues electronic B/Ls on. A lapsed one is how a console is held at the
-- port, so each one's expiry is watched (lib/registrations.ts). An
-- administrator keeps the list; everybody reads it. Renewed, the old one is
-- kept, inactive, for the record.
--
-- OUR OWN MTO
--
-- 085 issued every house B/L under a partner's MTO registration, because
-- Aashish had none. With its own on the list a house B/L can be issued under
-- it (`mto_own`), and is refused if the registration it names is not on the
-- list or has expired.
--
-- THE ELECTRONIC B/L
--
-- A fourth way to release a house B/L, beside originals, telex and the sea
-- waybill: issued as an electronic record on a platform, its title passed on
-- the platform, and surrendered there to our agent at destination, who then
-- releases the cargo. No paper originals. The database refuses the release
-- before the surrender, as it refuses a telex release before every original
-- is back (089). The same for an agent's eBL on an import (088): the
-- surrender to us is the one that matters.
-- ---------------------------------------------------------------------------

create table if not exists public.company_registrations (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('mto', 'consol_agent', 'customs_bond', 'bank_guarantee', 'ebl_platform', 'other')),
  -- What it is called: "MTO registration", the bank's name for a guarantee, the platform's name.
  title       text not null default '',
  number      text not null default '',
  -- Who issued it or holds it: DG Shipping, the Customs house, the bank.
  authority   text not null default '',
  issued_on   date,
  valid_until date,
  amount_inr  numeric check (amount_inr is null or amount_inr >= 0),
  notes       text not null default '',
  active      boolean not null default true,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  check (valid_until is null or issued_on is null or valid_until >= issued_on)
);

-- One MTO registration, one Customs registration, one platform in force at a time.
create unique index if not exists company_registrations_one_live
  on public.company_registrations (kind) where active and kind in ('mto', 'consol_agent', 'ebl_platform');

alter table public.company_registrations enable row level security;
revoke all on public.company_registrations from public, anon;
grant select, insert, update, delete on public.company_registrations to authenticated;

drop policy if exists company_registrations_read on public.company_registrations;
create policy company_registrations_read on public.company_registrations
  for select to authenticated using (true);

drop policy if exists company_registrations_admin on public.company_registrations;
create policy company_registrations_admin on public.company_registrations
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create or replace function public.company_registrations_touch()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.number := btrim(new.number);
  new.title := btrim(new.title);
  return new;
end $fn$;

drop trigger if exists company_registrations_touch on public.company_registrations;
create trigger company_registrations_touch
  before insert or update on public.company_registrations
  for each row execute function public.company_registrations_touch();


-- ---------------------------------------------------------------------------
-- The house B/L: under our own MTO, and as an eBL
-- ---------------------------------------------------------------------------
alter table public.house_bills
  add column if not exists mto_own            boolean not null default false,
  add column if not exists ebl_platform       text not null default '',
  add column if not exists ebl_ref            text not null default '',
  add column if not exists ebl_issued_on      date,
  -- Who holds the title on the platform now: the shipper, their bank, the consignee.
  add column if not exists ebl_holder         text not null default '',
  add column if not exists ebl_surrendered_on date;

alter table public.house_bills drop constraint if exists house_bills_mto_one;
alter table public.house_bills add constraint house_bills_mto_one check (not (mto_own and mto_partner_id is not null));

alter table public.house_bills drop constraint if exists house_bills_release_mode_check;
alter table public.house_bills add constraint house_bills_release_mode_check
  check (release_mode in ('original', 'telex', 'express', 'ebl'));

-- A sea waybill and an eBL have no paper originals.
alter table public.house_bills drop constraint if exists house_bills_originals_check;
alter table public.house_bills add constraint house_bills_originals_check check (
  (release_mode in ('express', 'ebl') and originals = 0) or (release_mode not in ('express', 'ebl') and originals between 1 and 3)
);

alter table public.received_house_bills drop constraint if exists received_house_bills_release_mode_check;
alter table public.received_house_bills add constraint received_house_bills_release_mode_check
  check (release_mode in ('original', 'telex', 'express', 'ebl'));
alter table public.received_house_bills drop constraint if exists received_house_bills_check;
alter table public.received_house_bills add constraint received_house_bills_check
  check (release_mode not in ('express', 'ebl') or originals = 0);


-- ---------------------------------------------------------------------------
-- The guard and the history (123, with our own MTO and the eBL added)
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

  -- ---- the release (089, the eBL 132) ----
  v_moved := new.charges_received_on   is distinct from old.charges_received_on
          or new.originals_released_on is distinct from old.originals_released_on
          or new.originals_released_to is distinct from old.originals_released_to
          or new.originals_returned    is distinct from old.originals_returned
          or new.originals_returned_on is distinct from old.originals_returned_on
          or new.release_sent_on       is distinct from old.release_sent_on
          or new.release_sent_to       is distinct from old.release_sent_to
          or new.released_on           is distinct from old.released_on
          or new.release_note          is distinct from old.release_note
          or new.ebl_issued_on         is distinct from old.ebl_issued_on
          or new.ebl_holder            is distinct from old.ebl_holder
          or new.ebl_surrendered_on    is distinct from old.ebl_surrendered_on
          or (new.ebl_ref is distinct from old.ebl_ref and new.status = 'issued')
          or (new.ebl_platform is distinct from old.ebl_platform and new.status = 'issued');

  if v_moved then
    if new.status <> 'issued' then
      raise exception 'Issue the house B/L before recording its release';
    end if;
    if new.release_mode = 'telex' and new.release_sent_on is not null and new.originals_returned < new.originals then
      raise exception 'A telex release goes only once all % originals are back (% returned)', new.originals, new.originals_returned
        using hint = 'Record the full set surrendered to us first.';
    end if;
    if new.release_mode in ('express', 'ebl') and (new.originals_released_on is not null or new.originals_returned > 0) then
      raise exception 'A % has no paper originals to hand over or take back', case when new.release_mode = 'ebl' then 'electronic B/L' else 'sea waybill' end;
    end if;
    if new.release_mode <> 'ebl' and (new.ebl_issued_on is not null or new.ebl_surrendered_on is not null) then
      raise exception 'This B/L is not released as an eBL';
    end if;
    if new.release_mode = 'ebl' then
      if new.ebl_issued_on is not null and (btrim(new.ebl_ref) = '' or btrim(new.ebl_platform) = '') then
        raise exception 'Say which platform the eBL is on and its reference there';
      end if;
      if new.ebl_surrendered_on is not null and new.ebl_issued_on is null then
        raise exception 'The eBL has not been issued yet';
      end if;
      if new.released_on is not null and new.ebl_surrendered_on is null then
        raise exception 'The cargo is released only once the eBL is surrendered to our agent on %', coalesce(nullif(btrim(new.ebl_platform), ''), 'the platform')
          using hint = 'Record the surrender first.';
      end if;
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
        ('release_note',          to_jsonb(old.release_note),          to_jsonb(new.release_note)),
        ('ebl_platform',          to_jsonb(old.ebl_platform),          to_jsonb(new.ebl_platform)),
        ('ebl_ref',               to_jsonb(old.ebl_ref),               to_jsonb(new.ebl_ref)),
        ('ebl_issued_on',         to_jsonb(old.ebl_issued_on),         to_jsonb(new.ebl_issued_on)),
        ('ebl_holder',            to_jsonb(old.ebl_holder),            to_jsonb(new.ebl_holder)),
        ('ebl_surrendered_on',    to_jsonb(old.ebl_surrendered_on),    to_jsonb(new.ebl_surrendered_on))
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
      if new.ebl_issued_on is not null and old.ebl_issued_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'ebl_issued',
                format('eBL %s issued on %s, ref %s%s', coalesce(new.hbl_no, ''), btrim(new.ebl_platform), btrim(new.ebl_ref),
                       case when btrim(new.ebl_holder) <> '' then ', to ' || btrim(new.ebl_holder) else '' end),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no, 'ebl_ref', new.ebl_ref), auth.uid());
      end if;
      if new.ebl_holder is distinct from old.ebl_holder and old.ebl_issued_on is not null and btrim(new.ebl_holder) <> '' then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'ebl_transferred', format('Title to eBL %s now with %s', coalesce(new.hbl_no, ''), btrim(new.ebl_holder)),
                jsonb_build_object('shipment_id', new.shipment_id, 'hbl_no', new.hbl_no), auth.uid());
      end if;
      if new.ebl_surrendered_on is not null and old.ebl_surrendered_on is null then
        insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
        values (v_ref, 'ebl_surrendered', format('eBL %s surrendered to our agent on %s', coalesce(new.hbl_no, ''), btrim(new.ebl_platform)),
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
  -- Not once the originals are out, or the eBL is with somebody on the
  -- platform: they hold it as issued. Not once the cargo is released against it.
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
    if old.release_mode = 'ebl' and old.ebl_issued_on is not null and old.ebl_surrendered_on is null then
      raise exception 'The eBL % is out on % with %', coalesce(old.hbl_no, ''), coalesce(nullif(btrim(old.ebl_platform), ''), 'the platform'), coalesce(nullif(btrim(old.ebl_holder), ''), 'its holder')
        using hint = 'Have it surrendered back on the platform before reopening it for a correction.';
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
          or new.mto_partner_id is distinct from old.mto_partner_id or new.mto_own is distinct from old.mto_own
          or new.amendment is distinct from old.amendment)
  then
    raise exception 'House B/L % has been issued', coalesce(old.hbl_no, '')
      using hint = 'An administrator can set it back to draft to correct it.';
  end if;

  if old.status = 'draft' and new.status = 'issued' then
    if new.hbl_no is null then
      raise exception 'Number the house B/L before issuing it';
    end if;
    -- Under our own MTO: the registration it names is ours, on the list and in force today.
    if new.mto_own and not exists (
      select 1 from public.company_registrations r
       where r.kind = 'mto' and r.active
         and upper(r.number) = upper(btrim(coalesce(new.data ->> 'mto_registration', '')))
         and r.number <> ''
         and (r.valid_until is null or r.valid_until >= (now() at time zone 'Asia/Kolkata')::date)
    ) then
      raise exception 'Our own MTO registration on this B/L is not the one in force'
        using hint = 'Check the registration in Admin → Registrations, then fetch it onto the B/L again.';
    end if;
    new.issued_at := now();
    new.issued_by := auth.uid();
    new.reopen_reason := '';
    -- Reissued after a correction: a new set of originals (a new eBL), so
    -- the release starts again. Whether the freight is paid does not change.
    if new.amendment > 0 then
      new.originals_released_on := null;
      new.originals_released_to := '';
      new.originals_returned    := 0;
      new.originals_returned_on := null;
      new.release_sent_on       := null;
      new.release_sent_to       := '';
      new.released_on           := null;
      new.ebl_ref               := '';
      new.ebl_issued_on         := null;
      new.ebl_holder            := '';
      new.ebl_surrendered_on    := null;
    end if;
    insert into public.house_bill_history (shipment_id, actor, action, note)
    values (new.shipment_id, auth.uid(), 'issued',
            case new.release_mode
              when 'express' then 'Issued as a sea waybill (express release)'
              when 'ebl' then 'Issued as an electronic B/L'
              else format('%s original%s issued%s', new.originals, case when new.originals = 1 then '' else 's' end,
                          case when new.release_mode = 'telex' then ', for telex release' else '' end)
            end
            || case when new.mto_own then ', under our own MTO registration' else '' end
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
  if new.mto_own is distinct from old.mto_own then
    v_changes := v_changes || jsonb_build_array(jsonb_build_object('field', 'mto_own', 'from', old.mto_own, 'to', new.mto_own));
  end if;

  if jsonb_array_length(v_changes) > 0 then
    insert into public.house_bill_history (shipment_id, actor, action, changes)
    values (new.shipment_id, auth.uid(), 'updated', v_changes);
  end if;
  return new;
end $fn$;

revoke execute on function public.house_bill_write() from public, anon, authenticated;
