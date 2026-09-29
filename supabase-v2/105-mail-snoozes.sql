-- 105: Snooze, for mail.
--
-- ---------------------------------------------------------------------------
-- Outlook's snooze is not in Microsoft Graph, so the CRM does what Outlook
-- does underneath: the message moves to a "Snoozed" folder in the person's
-- own mailbox, and comes back to the Inbox, unread, at the chosen time.
--
-- This table remembers when. One row per snoozed message, owned by the person
-- who snoozed it — only they can see or change it, because the message is in
-- their mailbox and only their Outlook connection can move it back. The Mail
-- page brings back what is due when it opens and every minute while it is
-- open (services/snooze.ts); a snooze that falls due while nobody has the CRM
-- open comes back the next time its owner opens Mail.
--
-- `message_id` is the message's id in the Snoozed folder: Graph gives a moved
-- message a new id, and this is the one that moves it back.
-- ---------------------------------------------------------------------------

create table if not exists public.mail_snoozes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mailbox text not null,
  message_id text not null,
  conversation_id text,
  subject text not null default '',
  sender text not null default '',
  until timestamptz not null,
  returned_at timestamptz,
  created_at timestamptz not null default now()
);

-- When it came back, and when its owner opened it since. Moving a message
-- keeps its received date, so back in the Inbox it would sit wherever that
-- date puts it; the Mail page pins it to the top, "Back from snooze", until
-- it is opened. `message_id` becomes its id in the Inbox when it returns.
alter table public.mail_snoozes add column if not exists seen_at timestamptz;

create index if not exists mail_snoozes_due on public.mail_snoozes (user_id, until) where returned_at is null;

alter table public.mail_snoozes enable row level security;

drop policy if exists mail_snoozes_own on public.mail_snoozes;
create policy mail_snoozes_own on public.mail_snoozes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.mail_snoozes from anon, public;
grant select, insert, update, delete on public.mail_snoozes to authenticated;
