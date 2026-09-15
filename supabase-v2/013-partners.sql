-- ---------------------------------------------------------------------------
-- Partners: the companies outside this one that a shipment needs.
--
-- A forwarder does not move freight alone. Every shipment pulls in an overseas
-- agent at the far end, a consol partner for the box, a CHA for customs, a
-- transporter for the leg to the port. Until now those people existed only as
-- email addresses that happened to appear on a thread, which meant the desk
-- rebuilt the same knowledge from memory on every enquiry.
--
-- Tags are the point of the table. "textiles", "singapore", "LCL" against a
-- partner is what lets an enquiry for textiles to Singapore suggest the right
-- two people instead of presenting a list of forty and hoping.
-- ---------------------------------------------------------------------------

create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  -- The person you actually ring, and the company they answer for.
  name          text not null,
  organisation  text not null default '',
  role          text not null default 'other'
                  check (role in ('overseas_agent','consol_partner','carrier',
                                  'cha_customs','cfs_transport','other')),
  emails        text[] not null default '{}',
  phones        text[] not null default '{}',
  -- Free text on purpose. A fixed vocabulary would be wrong within a week --
  -- the desk knows distinctions ("hazmat", "reefer", "Jebel Ali") that no
  -- enum written up front would have contained.
  tags          text[] not null default '{}',
  notes         text not null default '',
  -- Archived rather than deleted. A partner named on a past shipment must stay
  -- resolvable, so retiring one hides it from the pickers and nothing more.
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists partners_tags_idx   on public.partners using gin (tags);
create index if not exists partners_emails_idx on public.partners using gin (emails);
create index if not exists partners_active_idx on public.partners (active);

-- ---------------------------------------------------------------------------
-- Who is on this enquiry.
--
-- Separate from enquiry_parties, which records correspondents discovered from
-- mail. This records a deliberate choice by somebody at the desk: we are using
-- this agent for this shipment. Assigning writes a party too, so their mail
-- files under the right heading -- but the assignment is the decision and the
-- party is a consequence of it.
-- ---------------------------------------------------------------------------
create table if not exists public.partner_assignments (
  id           uuid primary key default gen_random_uuid(),
  enquiry_ref  text not null references public.enquiries(ref) on delete cascade,
  partner_id   uuid not null references public.partners(id)   on delete cascade,
  -- Copied from the partner at assignment time, because a partner can act in
  -- one capacity on one shipment and another elsewhere.
  role         text not null default 'other'
                  check (role in ('overseas_agent','consol_partner','carrier',
                                  'cha_customs','cfs_transport','other')),
  note         text not null default '',
  assigned_by  uuid references auth.users(id),
  assigned_at  timestamptz not null default now(),
  unique (enquiry_ref, partner_id)
);

create index if not exists assignments_enquiry_idx on public.partner_assignments (enquiry_ref);
create index if not exists assignments_partner_idx on public.partner_assignments (partner_id);

-- ---------------------------------------------------------------------------
-- An overseas agent is not "other".
--
-- The case file groups correspondence by who somebody is to the shipment, and
-- the far-end agent is the party the desk writes to most after the customer.
-- Filing them under "Other" was already wrong; it becomes untenable once
-- assigning a partner starts creating parties automatically.
-- ---------------------------------------------------------------------------
alter table public.enquiry_parties drop constraint if exists enquiry_parties_role_check;
alter table public.enquiry_parties add constraint enquiry_parties_role_check
  check (role in ('client','overseas_agent','consol_partner','carrier',
                  'cha_customs','cfs_transport','other'));

-- ---------------------------------------------------------------------------
-- RLS, matching the rest of the schema: signed-in staff read and write.
--
-- partner_assignments gets a DELETE policy and partners does not. Unassigning
-- somebody from a shipment is an ordinary correction; deleting a partner would
-- orphan the history of every shipment they worked on, which is what `active`
-- is for.
-- ---------------------------------------------------------------------------
alter table public.partners            enable row level security;
alter table public.partner_assignments enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['partners','partner_assignments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (true)',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (true) with check (true)',
      t || '_update', t);
  end loop;
end $rls$;

drop policy if exists partner_assignments_delete on public.partner_assignments;
create policy partner_assignments_delete on public.partner_assignments
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Assign a partner, and put them on the correspondence at the same time.
--
-- One statement, because the two must not come apart: an assignment whose
-- party write failed would show the agent on the shipment while their emails
-- kept landing in triage as though nobody knew who they were.
--
-- Idempotent. Assigning twice updates the role rather than failing, which is
-- what somebody fixing a mis-picked role expects the button to do.
-- ---------------------------------------------------------------------------
create or replace function public.assign_partner(
  p_ref        text,
  p_partner_id uuid,
  p_role       text default null,
  p_note       text default ''
) returns public.partner_assignments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_partner public.partners;
  v_role    text;
  v_row     public.partner_assignments;
begin
  select * into v_partner from public.partners where id = p_partner_id;
  if not found then
    raise exception 'no such partner';
  end if;

  v_role := coalesce(nullif(p_role, ''), v_partner.role);

  insert into public.partner_assignments (enquiry_ref, partner_id, role, note, assigned_by)
  values (upper(p_ref), p_partner_id, v_role, coalesce(p_note, ''), auth.uid())
  on conflict (enquiry_ref, partner_id)
    do update set role = excluded.role,
                  note = excluded.note
  returning * into v_row;

  -- The correspondence side. Matched on the partner's own addresses so a
  -- second assignment does not create a duplicate heading on the case file.
  if not exists (
    select 1 from public.enquiry_parties p
     where p.enquiry_ref = upper(p_ref)
       and p.organisation = v_partner.organisation
       and p.name = v_partner.name
  ) then
    insert into public.enquiry_parties (enquiry_ref, role, name, organisation, emails)
    values (upper(p_ref), v_role, v_partner.name, v_partner.organisation, v_partner.emails);
  else
    update public.enquiry_parties
       set role = v_role, emails = v_partner.emails
     where enquiry_ref = upper(p_ref)
       and organisation = v_partner.organisation
       and name = v_partner.name;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    upper(p_ref),
    'partner_assigned',
    coalesce(nullif(v_partner.organisation, ''), v_partner.name) || ' assigned as ' ||
      replace(v_role, '_', ' '),
    jsonb_build_object('partner_id', p_partner_id, 'role', v_role),
    auth.uid()
  );

  return v_row;
end $fn$;

grant execute on function public.assign_partner(text, uuid, text, text) to authenticated;
