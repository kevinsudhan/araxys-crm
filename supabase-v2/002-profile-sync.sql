-- Fixes a race between GoTrue and the profile trigger.
--
-- Creating a user through the admin API is two writes, not one: GoTrue inserts
-- the auth.users row with only {provider, providers} in raw_app_meta_data, then
-- updates it with the app_metadata the caller supplied. An AFTER INSERT trigger
-- therefore reads the row before the role has landed, and every account was
-- written to profiles as 'employee' -- including the administrator.
--
-- So the trigger has to fire on UPDATE as well, and the conflict path has to
-- actually re-apply the role. The previous version updated email and name on
-- conflict but silently left role at whatever it was first written as, which is
-- what made this survive re-running the seed.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_app_meta_data->>'role', 'employee')
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = excluded.full_name,
        role       = excluded.role,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of raw_app_meta_data, raw_user_meta_data, email on auth.users
  for each row execute function public.handle_new_user();

-- Backfill the rows written before the trigger was fixed.
update public.profiles p
   set role = coalesce(u.raw_app_meta_data->>'role', 'employee'),
       updated_at = now()
  from auth.users u
 where u.id = p.id
   and p.role is distinct from coalesce(u.raw_app_meta_data->>'role', 'employee');
