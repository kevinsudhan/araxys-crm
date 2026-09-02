-- Per-user email signature.
--
-- Microsoft Graph does not expose a user's Outlook signature -- it lives in
-- OWA's own settings, not the mail API -- so the CRM keeps its own copy that
-- each person pastes in once.
--
-- This is the first thing a user is allowed to write to their own profile row,
-- which is why an UPDATE policy appears here for the first time. It is scoped
-- deliberately: the WITH CHECK clause pins role to its current value, so the
-- policy cannot be used to self-promote. Without that line, granting signature
-- editing would quietly hand every employee the ability to make themselves an
-- administrator.

alter table public.profiles
  add column if not exists signature text not null default '';

drop policy if exists profiles_update_own_signature on public.profiles;
create policy profiles_update_own_signature
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );
