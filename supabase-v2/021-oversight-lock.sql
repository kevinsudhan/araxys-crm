-- ---------------------------------------------------------------------------
-- A second lock on the team oversight page.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
--
-- It is a second thing you have to know to open a page that shows what every
-- person on the desk has been doing. Being signed in as the administrator is no
-- longer enough on its own, which matters when a laptop is left unlocked in an
-- office where everyone knows everyone.
--
-- It is NOT a data boundary. The enquiries and events that page reads are
-- readable by any signed-in employee under the existing policies, because a
-- desk where one operator cannot see another's work does not function. Somebody
-- determined and technical could read the same rows without ever meeting this
-- prompt. Tightening that is a separate decision about who may read what, and
-- it would change how the rest of the CRM behaves.
--
-- HOW THE PASSWORD IS STORED
--
-- As a bcrypt hash, never as text. The table carries RLS with no policies at
-- all, which in Postgres means no client can read or write it under any
-- circumstances — not the anon key, not a signed-in admin. The only way in is
-- through the two functions below, which are security definer and therefore run
-- as the owner rather than the caller.
--
-- Verification happens in the database. The hash never travels to the browser,
-- so there is nothing in the bundle to read and nothing on the wire to capture
-- and compare offline.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_locks (
  key        text primary key,
  hash       text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- Enabled with no policies: deny by default, for everybody, forever. The
-- absence of a policy here is the security property, so do not add one.
alter table public.app_locks enable row level security;

revoke all on public.app_locks from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Set or change the password.
--
-- Administrators only, and it will not accept something trivially short. The
-- plaintext exists for the length of this call and is never written anywhere:
-- what lands in the table is the output of crypt() with a fresh salt.
-- ---------------------------------------------------------------------------
create or replace function public.set_oversight_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_me uuid := auth.uid();
begin
  if v_me is not null then
    if not exists (select 1 from public.profiles where id = v_me and role = 'admin') then
      raise exception 'only an administrator can change this';
    end if;
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'use at least eight characters';
  end if;

  insert into public.app_locks (key, hash, updated_at, updated_by)
  values ('oversight', extensions.crypt(p_password, extensions.gen_salt('bf', 12)), now(), v_me)
  on conflict (key) do update
    set hash = excluded.hash, updated_at = now(), updated_by = excluded.updated_by;
end $fn$;

grant execute on function public.set_oversight_password(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Check a password.
--
-- Returns a boolean and nothing else — no hint about whether the attempt was
-- close, and no distinction between a wrong password and one that is not set,
-- because the difference is only useful to somebody guessing.
--
-- Restricted to administrators so this cannot be used as an open oracle by any
-- signed-in account. bcrypt at cost 12 takes a few hundred milliseconds per
-- attempt, which is what makes guessing at scale impractical.
-- ---------------------------------------------------------------------------
create or replace function public.verify_oversight_password(p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_me   uuid := auth.uid();
  v_hash text;
begin
  if v_me is null
     or not exists (select 1 from public.profiles where id = v_me and role = 'admin') then
    return false;
  end if;

  select hash into v_hash from public.app_locks where key = 'oversight';
  if v_hash is null or p_password is null then
    return false;
  end if;

  return v_hash = extensions.crypt(p_password, v_hash);
end $fn$;

grant execute on function public.verify_oversight_password(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Whether a password has been set at all.
--
-- The page needs this to tell an administrator "nobody has set one yet" rather
-- than refusing them at a prompt that can never be satisfied. It reveals only
-- that a row exists, which is not a secret.
-- ---------------------------------------------------------------------------
create or replace function public.oversight_lock_is_set()
returns boolean
language sql
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.app_locks where key = 'oversight');
$fn$;

grant execute on function public.oversight_lock_is_set() to authenticated;
