-- 122: Who files the CSN on a co-load console.
--
-- ---------------------------------------------------------------------------
-- On our own box we are the consol agent and file the CSN ourselves (097).
-- On space bought from a co-loader (121) it goes either way, console by
-- console: we file our houses under the co-loader's B/L, or the co-loader
-- files them in theirs and needs our house list in time to.
--
--   csn_by            'us' (the default, and always on our own box) or
--                     'coloader'.
--   csn_list_sent_at  When our house list went to the co-loader for their
--   csn_list_sent_to  filing, and to whom.
--
-- Their CSN number, once they confirm it, is recorded where ours would be
-- (csn_no / csn_date, and on each job's customs record), so the jobs' "CSN
-- due" alerts clear the same way.
-- ---------------------------------------------------------------------------

alter table public.consoles add column if not exists csn_by text not null default 'us';
alter table public.consoles drop constraint if exists consoles_csn_by_check;
alter table public.consoles add constraint consoles_csn_by_check check (csn_by in ('us', 'coloader'));
alter table public.consoles add column if not exists csn_list_sent_at timestamptz;
alter table public.consoles add column if not exists csn_list_sent_to text not null default '';

notify pgrst, 'reload schema';
