-- v2 auth schema.
--
-- The role lives here, in a table only the service key can write, and NOT in
-- auth.users.raw_user_meta_data. user_metadata is editable by the user who owns
-- it -- a signed-in employee could PATCH their own role to "admin" and the app
-- would believe them. app_metadata or a locked table are the only safe homes
-- for an authorisation claim.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null default '',
  role        text not null default 'employee' check (role in ('admin','employee')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A signed-in user may read their own profile and nothing else. There is
-- deliberately no UPDATE policy: nobody changes their own role from the client,
-- and the service key bypasses RLS for legitimate admin changes.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select
  using (auth.uid() = id);

-- Keep the profile in step with the account it belongs to.
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
    -- Reads app_metadata, which the user cannot write to. Anything a user puts
    -- in their own user_metadata is ignored here on purpose.
    coalesce(new.raw_app_meta_data->>'role', 'employee')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
