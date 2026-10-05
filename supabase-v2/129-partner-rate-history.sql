-- 129: The partner's original rate builds up over several pastes (128).
--
-- A partner revises a rate, or sends half the charges today and the rest
-- tomorrow. Each paste is added to the original rate (lib/buyRate.ts): a
-- charge already there is updated, keeping what it was; a new one is added;
-- one not in the paste stays. Each paste is kept here — when, from whom, what
-- was pasted, and what it changed — so the original rate can be read back to
-- the mails it came from.

alter table public.enquiry_buy_rates add column if not exists history jsonb not null default '[]'::jsonb;
alter table public.enquiry_buy_rates drop constraint if exists enquiry_buy_rates_history_array;
alter table public.enquiry_buy_rates add constraint enquiry_buy_rates_history_array check (jsonb_typeof(history) = 'array');

notify pgrst, 'reload schema';
