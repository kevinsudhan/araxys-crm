-- Araxys — forgetting a caller
--
-- SnapServe has no way to delete a call. DELETE /calls/{id} returns 404 and the call is
-- still there afterwards, so its history is permanent whatever we do on our side. That
-- makes "delete the record" insufficient on its own: ingest re-reads SnapServe every five
-- minutes, so a deleted customer reappears, fully reconstructed, before anyone notices.
--
-- So forgetting is a cutoff rather than a deletion. Everything that caller said up to a
-- moment is ignored from then on; everything they say after it is captured normally. That
-- is what makes a fresh test possible against a number that has already rung fifty times,
-- and it is honest about the thing we do not control — the transcripts still exist in
-- SnapServe, we simply stop reading them.

create table if not exists public.caller_resets (
  phone_key     text primary key,               -- last 10 digits, as everywhere else
  forget_before timestamptz not null,           -- ignore calls at or before this instant
  reason        text,
  created_at    timestamptz not null default now()
);

alter table public.caller_resets enable row level security;
