-- ---------------------------------------------------------------------------
-- Handing an enquiry to somebody else.
--
-- WHY A FLAG ON THE PERSON RATHER THAN A ROLE
--
-- The two people who need this are the administrator and one employee, so a
-- role check would either give it to every employee or require inventing a
-- third role that means "Parasu". Neither describes the situation.
--
-- A column does. It is data, so the desk can grant or withdraw it later without
-- a deployment, and it says exactly what it grants rather than implying a rank.
-- An administrator has it implicitly, because an admin who cannot move work is
-- not an administrator of anything.
--
-- WHY IT IS SEPARATE FROM claim_enquiry
--
-- Claiming is taking responsibility for your own work. Assigning is putting it
-- on somebody else's list, which is a different act with a different guard and
-- reads differently in the timeline. Folding them into one function would mean
-- one call site that sometimes needs a permission and sometimes does not.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists can_assign boolean not null default false;

comment on column public.profiles.can_assign is
  'May hand an enquiry to another person. Administrators may regardless.';

-- The two who need it today. Written as an update rather than a fixed list in
-- code, so changing who can do this is a row edit and not a release.
update public.profiles
   set can_assign = true
 where email in ('aashish@aashishlogistics.com', 'parasu@aashishlogistics.com');

-- ---------------------------------------------------------------------------
-- Give it to somebody.
--
-- Takes it off whoever holds it and puts it on the named person, in one step,
-- because a hand-off is one decision. Passing null takes it back to the shared
-- board, which is the same thing release_enquiry does and is allowed here so
-- the interface has a single control rather than two that look alike.
-- ---------------------------------------------------------------------------
create or replace function public.assign_enquiry(p_ref text, p_to uuid)
returns public.enquiries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text := upper(p_ref);
  v_row  public.enquiries;
  v_me   uuid := auth.uid();
  v_may  boolean;
  v_name text;
  v_to   text;
  v_from text;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  select role = 'admin' or can_assign into v_may from public.profiles where id = v_me;
  if not coalesce(v_may, false) then
    raise exception 'you cannot hand enquiries to other people';
  end if;

  select * into v_row from public.enquiries where ref = v_ref for update;
  if not found then
    raise exception 'no enquiry %', v_ref;
  end if;

  if p_to is not null and not exists (select 1 from public.profiles where id = p_to) then
    raise exception 'no such person';
  end if;

  -- Already where it is being sent. Nothing to record.
  if v_row.assigned_to is not distinct from p_to then
    return v_row;
  end if;

  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = v_me;
  select coalesce(nullif(full_name, ''), email) into v_to   from public.profiles where id = p_to;
  select coalesce(nullif(full_name, ''), email) into v_from from public.profiles where id = v_row.assigned_to;

  update public.enquiries
     set assigned_to = p_to,
         assigned_at = case when p_to is null then null else now() end,
         updated_at  = now()
   where ref = v_ref
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ref,
    case when p_to is null then 'unassigned' else 'assigned' end,
    case
      when p_to is null and v_from is not null
        then format('%s took this off %s and put it back on the board', coalesce(v_name, 'An admin'), v_from)
      when p_to is null
        then format('%s put this back on the board', coalesce(v_name, 'An admin'))
      when v_from is not null
        then format('%s moved this from %s to %s', coalesce(v_name, 'An admin'), v_from, coalesce(v_to, 'somebody'))
      else format('%s gave this to %s', coalesce(v_name, 'An admin'), coalesce(v_to, 'somebody'))
    end,
    jsonb_build_object('assigned_to', p_to, 'was_assigned_to', v_row.assigned_to, 'by', v_me),
    v_me
  );

  return v_row;
end $fn$;

grant execute on function public.assign_enquiry(text, uuid) to authenticated;
