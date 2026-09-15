-- ---------------------------------------------------------------------------
-- Who is handling which enquiry.
--
-- WHY SELF-ASSIGNMENT RATHER THAN ALLOCATION
--
-- A desk of four people does not need a dispatcher. What it needs is for
-- everyone to see the same board and for it to be obvious which rows somebody
-- has already picked up, so two people do not ring the same customer an hour
-- apart. So the board stays visible to everyone and the act of claiming is the
-- record: one press, stamped with who and when.
--
-- The claim time is the point of the exercise for the admin view. An enquiry
-- that arrived at nine and was claimed at four tells you something an enquiry
-- that arrived at nine and was claimed at ten past does not, and neither number
-- means anything without the other.
-- ---------------------------------------------------------------------------

alter table public.enquiries add column if not exists assigned_to uuid references auth.users(id);
alter table public.enquiries add column if not exists assigned_at timestamptz;

create index if not exists enquiries_assigned_idx on public.enquiries (assigned_to, assigned_at desc);

-- ---------------------------------------------------------------------------
-- Colleagues become visible to each other.
--
-- profiles could previously only be read by its owner, which is the right
-- default and the wrong one here: a board that says an enquiry is taken but
-- cannot say by whom is worse than one that says nothing. The columns are a
-- name, a work address and a role, all of which every person on this desk
-- already knows about every other. Nothing here is writable from the client;
-- there is still no update policy, so nobody can promote themselves.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_colleagues on public.profiles;
create policy profiles_select_colleagues
  on public.profiles for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Take an enquiry.
--
-- Claiming one somebody else already holds is refused rather than silently
-- overwritten. Two people pressing the button a second apart is exactly the
-- collision this feature exists to prevent, so the second press has to say so
-- rather than quietly moving the work.
--
-- Pressing it on your own enquiry is not an error. It is somebody checking the
-- button worked, and it returns the row unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.claim_enquiry(p_ref text)
returns public.enquiries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref   text := upper(p_ref);
  v_row   public.enquiries;
  v_me    uuid := auth.uid();
  v_name  text;
  v_holder text;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  select * into v_row from public.enquiries where ref = v_ref for update;
  if not found then
    raise exception 'no enquiry %', v_ref;
  end if;

  if v_row.assigned_to = v_me then
    return v_row;
  end if;

  if v_row.assigned_to is not null then
    select coalesce(nullif(full_name, ''), email) into v_holder
      from public.profiles where id = v_row.assigned_to;
    raise exception '% is already handling this one', coalesce(v_holder, 'somebody else');
  end if;

  update public.enquiries
     set assigned_to = v_me,
         assigned_at = now(),
         updated_at  = now()
   where ref = v_ref
  returning * into v_row;

  select coalesce(nullif(full_name, ''), email) into v_name
    from public.profiles where id = v_me;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ref,
    'assigned',
    format('%s took this enquiry on', coalesce(v_name, 'An employee')),
    jsonb_build_object('assigned_to', v_me),
    v_me
  );

  return v_row;
end $fn$;

grant execute on function public.claim_enquiry(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Put it back on the shared board.
--
-- Anyone may release their own. An admin may release anybody's, because the one
-- thing a desk always eventually needs is to reassign the work of somebody who
-- is off sick.
-- ---------------------------------------------------------------------------
create or replace function public.release_enquiry(p_ref text)
returns public.enquiries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ref  text := upper(p_ref);
  v_row  public.enquiries;
  v_me   uuid := auth.uid();
  v_admin boolean;
  v_name text;
  v_was  text;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;

  select role = 'admin' into v_admin from public.profiles where id = v_me;

  select * into v_row from public.enquiries where ref = v_ref for update;
  if not found then
    raise exception 'no enquiry %', v_ref;
  end if;

  if v_row.assigned_to is null then
    return v_row;
  end if;

  if v_row.assigned_to <> v_me and not coalesce(v_admin, false) then
    raise exception 'this one is not yours to hand back';
  end if;

  select coalesce(nullif(full_name, ''), email) into v_was
    from public.profiles where id = v_row.assigned_to;
  select coalesce(nullif(full_name, ''), email) into v_name
    from public.profiles where id = v_me;

  update public.enquiries
     set assigned_to = null,
         assigned_at = null,
         updated_at  = now()
   where ref = v_ref
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ref,
    'unassigned',
    case
      when v_row.ref is not null and v_was is distinct from v_name
        then format('%s put this back on the board, from %s', coalesce(v_name, 'An admin'), coalesce(v_was, 'somebody'))
      else format('%s put this back on the board', coalesce(v_name, 'An employee'))
    end,
    jsonb_build_object('was_assigned_to', v_was),
    v_me
  );

  return v_row;
end $fn$;

grant execute on function public.release_enquiry(text) to authenticated;
