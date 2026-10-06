-- ---------------------------------------------------------------------------
-- 138 · Arrival notices heard as they are sent
--
-- The console's destination panel (components/ConsoleDestination.tsx) listens
-- for changes to arrival_notice_sends, but the table was never added to the
-- realtime publication, so the panel only learnt of a notice sent by the
-- server's run, or by a colleague, at its next reload. Found by the audit's
-- schema-drift check during the end-to-end check of 7 Oct 2026.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'arrival_notice_sends'
  ) then
    alter publication supabase_realtime add table public.arrival_notice_sends;
  end if;
end $$;
