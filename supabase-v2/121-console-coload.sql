-- 121: A console on space bought from another consolidator (co-loading).
--
-- ---------------------------------------------------------------------------
-- When Aashish has cargo for a lane it runs no box on, it books LCL space with
-- a co-loader: the co-loader's house B/L names Aashish as shipper and our
-- agent as consignee, and is our master for that cargo; we still issue each
-- shipper our own house B/L under it. Everything a console already does — the
-- houses, the manifest to our agent, the instruction and the draft checked
-- (119), the master at this end (120) — applies with the co-loader in the
-- line's place. What is new is who the space is bought from and at what rate:
--
--   space_from         'line' (our own box, the default) or 'coloader'.
--   coloader_id        The co-loader, from the partner directory.
--   coloader_rate      Their rate per W/M (the greater of CBM and tonnes).
--   coloader_currency  The rate's currency.
--   coloader_min_wm    The least W/M they charge for (usually 1).
--
-- Their invoice is the cost: a bill in Accounts against the console
-- (bills.console_id), set beside what the rate says it should be.
-- ---------------------------------------------------------------------------

alter table public.consoles add column if not exists space_from text not null default 'line';
alter table public.consoles drop constraint if exists consoles_space_from_check;
alter table public.consoles add constraint consoles_space_from_check check (space_from in ('line', 'coloader'));

alter table public.consoles add column if not exists coloader_id uuid references public.partners(id) on delete set null;
create index if not exists consoles_coloader_id_idx on public.consoles (coloader_id);

alter table public.consoles add column if not exists coloader_rate numeric;
alter table public.consoles drop constraint if exists consoles_coloader_rate_check;
alter table public.consoles add constraint consoles_coloader_rate_check check (coloader_rate is null or coloader_rate >= 0);

alter table public.consoles add column if not exists coloader_currency text not null default 'USD';
alter table public.consoles drop constraint if exists consoles_coloader_currency_check;
alter table public.consoles add constraint consoles_coloader_currency_check check (coloader_currency ~ '^[A-Z]{3}$');

alter table public.consoles add column if not exists coloader_min_wm numeric not null default 1;
alter table public.consoles drop constraint if exists consoles_coloader_min_wm_check;
alter table public.consoles add constraint consoles_coloader_min_wm_check check (coloader_min_wm >= 0);

notify pgrst, 'reload schema';
