-- 101: Live rates. Every Sunday at 10:30 pm IST the desk's partners are mailed
-- for the coming week's rates on a service the desk names.
--
--   live_rate_requests    a service to ask about ("FCL 20'/40' Chennai → Jebel
--                         Ali"), what to quote, the mailbox it is sent from,
--                         and whether it is running.
--   live_rate_recipients  the partners each request goes to. One mail each: no
--                         partner sees who else was asked (as services/rfq.ts).
--   live_rate_sends       every mail sent or refused, per partner: the weekly
--                         run, "Send now" and "Send a test to me". Written only
--                         by the live-rates function (service role).
--
-- The weekly run claims each partner once per Sunday (a unique index over the
-- week's claims and sends), so the job's retries every ten minutes until 23:20
-- IST pick up what failed or was not reached, and never mail anyone twice.
--
-- The mailbox it is sent from must be a CRM login, and only an administrator
-- may change it: the mail goes out in that mailbox's name, by the Azure app's
-- Mail.Send permission, without that person signing in.

create table if not exists public.live_rate_requests (
  id            uuid primary key default gen_random_uuid(),
  service       text not null check (length(btrim(service)) between 2 and 200),
  details       text not null default '' check (length(details) <= 2000),
  from_mailbox  text not null default 'info@aashishlogistics.com',
  active        boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.live_rate_recipients (
  request_id  uuid not null references public.live_rate_requests (id) on delete cascade,
  partner_id  uuid not null references public.partners (id) on delete cascade,
  primary key (request_id, partner_id)
);
create index if not exists live_rate_recipients_partner_idx on public.live_rate_recipients (partner_id);

create table if not exists public.live_rate_sends (
  id            bigserial primary key,
  request_id    uuid references public.live_rate_requests (id) on delete cascade,
  partner_id    uuid references public.partners (id) on delete set null,
  kind          text not null check (kind in ('weekly', 'now', 'test')),
  -- The IST date of the Sunday a weekly mail belongs to; null for the others.
  week_of       date,
  status        text not null check (status in ('sending', 'sent', 'failed')),
  from_mailbox  text not null default '',
  to_addresses  text[] not null default '{}',
  subject       text not null default '',
  error         text,
  sent_by       uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists live_rate_sends_request_idx on public.live_rate_sends (request_id, created_at desc);
-- One claim per partner per Sunday; a failure does not hold the place.
create unique index if not exists live_rate_sends_once_a_week
  on public.live_rate_sends (request_id, partner_id, week_of)
  where kind = 'weekly' and status in ('sending', 'sent');

-- ---------------------------------------------------------------------------
-- The mailbox: a CRM login, changed only by an administrator.
-- ---------------------------------------------------------------------------
create or replace function public.live_rate_request_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin boolean := exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
begin
  new.service := btrim(new.service);
  new.from_mailbox := lower(btrim(new.from_mailbox));
  if (tg_op = 'INSERT' and new.from_mailbox <> 'info@aashishlogistics.com')
     or (tg_op = 'UPDATE' and new.from_mailbox is distinct from old.from_mailbox) then
    -- auth.uid() is null for the service role (migrations, the function): allowed.
    if auth.uid() is not null and not v_admin then
      raise exception 'Only an administrator can change the mailbox rate requests are sent from.';
    end if;
  end if;
  if not exists (select 1 from public.profiles p where lower(p.email) = new.from_mailbox) then
    raise exception 'Rate requests can only be sent from a CRM login''s mailbox (%).', new.from_mailbox;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists live_rate_request_guard on public.live_rate_requests;
create trigger live_rate_request_guard
  before insert or update on public.live_rate_requests
  for each row execute function public.live_rate_request_guard();
revoke execute on function public.live_rate_request_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Staff read and write requests and their partners (as partners, 013); the
-- log is read-only to them.
-- ---------------------------------------------------------------------------
alter table public.live_rate_requests   enable row level security;
alter table public.live_rate_recipients enable row level security;
alter table public.live_rate_sends      enable row level security;

revoke all on public.live_rate_requests, public.live_rate_recipients, public.live_rate_sends from public, anon;
grant select, insert, update, delete on public.live_rate_requests, public.live_rate_recipients to authenticated;
-- Supabase grants every new table to authenticated by default: the log is the
-- function's to write, so take the rest back.
revoke insert, update, delete, truncate, references, trigger on public.live_rate_sends from authenticated;
revoke all on sequence public.live_rate_sends_id_seq from public, anon, authenticated;
grant select on public.live_rate_sends to authenticated;
grant all on public.live_rate_requests, public.live_rate_recipients, public.live_rate_sends to service_role;
grant usage, select on sequence public.live_rate_sends_id_seq to service_role;

drop policy if exists live_rate_requests_all on public.live_rate_requests;
create policy live_rate_requests_all on public.live_rate_requests
  for all to authenticated using (true) with check (true);

drop policy if exists live_rate_recipients_all on public.live_rate_recipients;
create policy live_rate_recipients_all on public.live_rate_recipients
  for all to authenticated using (true) with check (true);

drop policy if exists live_rate_sends_read on public.live_rate_sends;
create policy live_rate_sends_read on public.live_rate_sends
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Sunday 22:30 IST = 17:00 GMT (pg_cron's clock here), then every ten minutes
-- until 23:20 IST for anything not yet sent. The credentials are the
-- scheduler's, read from Vault when the job runs (087, set-mail-sync-secret).
-- ---------------------------------------------------------------------------
select cron.unschedule('araxys-v2-live-rates')
  where exists (select 1 from cron.job where jobname = 'araxys-v2-live-rates');

select cron.schedule(
  'araxys-v2-live-rates',
  '0,10,20,30,40,50 17 * * 0',
  $cron$
  select net.http_post(
    url     := 'https://izgbrdeybhbepftloxgk.supabase.co/functions/v1/live-rates',
    headers := jsonb_build_object(
      'Content-Type',        'application/json',
      'Authorization',       'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sync_anon_key'),
      'x-scheduler-secret',  (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sync_secret')
    ),
    body    := jsonb_build_object('mode', 'weekly'),
    timeout_milliseconds := 150000
  );
  $cron$
);
