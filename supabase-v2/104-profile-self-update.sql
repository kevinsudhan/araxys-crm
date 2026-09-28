-- 104: Saving your own signature works again, and is all you can change.
--
-- ---------------------------------------------------------------------------
-- WHAT BROKE
--
-- 103 rewrote the profile policies to read auth.uid() once per query:
-- (select auth.uid()). The self-update policy (003) pins the role with a
-- subquery on profiles itself, and once profiles_select_own held a subquery
-- too, Postgres refused every update of a profile by its owner: "infinite
-- recursion detected in policy for relation profiles". Nobody could save a
-- signature from 28 Sep until this.
--
-- WHAT WAS OPEN BEFORE THAT
--
-- The pin covered `role` only. An employee could PATCH their own row to
-- can_approve_quotes = true (or can_assign), become exempt from quote approval
-- (approval_exempt, 052), and approve their own quotations. The UI never
-- offered it; the API allowed it.
--
-- NOW
--
-- The policy says only "your own row" and reads nothing, so it cannot recurse.
-- A trigger says what a signed-in person may change on it: the signature. Role
-- and the approval and assignment rights change only through Staff accounts
-- (the staff-accounts function, as the service role) or a migration.
-- ---------------------------------------------------------------------------

alter policy profiles_update_own_signature on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- `authenticated` is a browser's request; the service role and the owner of a
  -- function (a migration, Staff accounts) are not held to this.
  if current_user = 'authenticated'
     and (to_jsonb(new) - 'signature' - 'updated_at') is distinct from (to_jsonb(old) - 'signature' - 'updated_at')
  then
    raise exception 'Only your signature can be changed here'
      using hint = 'Roles and permissions are changed by an admin, on Staff accounts.';
  end if;
  return new;
end $fn$;

revoke execute on function public.guard_profile_self_update() from public, anon, authenticated;

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();
