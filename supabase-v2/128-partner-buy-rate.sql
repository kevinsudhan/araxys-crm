-- 128: The partner's original rate on an enquiry, and the profit on the job.
--
-- ---------------------------------------------------------------------------
-- The desk asks a partner for a rate, the partner sends it — by mail, on
-- WhatsApp, as a sheet — and the customer is quoted that rate with the desk's
-- commission on top, or below it to win a job. The difference is the job's
-- profit, or its loss, and the CRM had nowhere to keep the partner's rate as
-- it came: the quotation's own cost cells were typed one by one, and pasting
-- the quotation again replaced them.
--
-- So the partner's rate is pasted as it came, read into charges by the same
-- reader as a quotation (classify-enquiry, paste_quote), checked, and kept
-- here, one per enquiry — the rate the quotation is built on. It is kept
-- apart from the quotation, so a quotation pasted again, revised or sent
-- leaves it standing. The profit is worked out charge by charge against the
-- quotation (lib/jobProfit.ts), and the job P&L's quoted cost is this rate.
--
--   lines      The charges as checked (PastedLine[]: section, description,
--              currency, unit, quantity, rate, note), percentages worked out.
--   roe        The rates of exchange they are turned into rupees at.
--   total_inr  The partner's charges in rupees before GST, on their own
--              quantities; null while a rate of exchange is missing.
-- ---------------------------------------------------------------------------

create table if not exists public.enquiry_buy_rates (
  enquiry_ref   text primary key references public.enquiries(ref) on delete cascade,
  partner_id    uuid references public.partners(id) on delete set null,
  partner_label text not null default '',
  pasted_text   text not null default '',
  lines         jsonb not null default '[]'::jsonb,
  roe           jsonb not null default '{}'::jsonb,
  total_inr     numeric,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint enquiry_buy_rates_lines_array check (jsonb_typeof(lines) = 'array'),
  constraint enquiry_buy_rates_total_check check (total_inr is null or total_inr >= 0)
);
create index if not exists enquiry_buy_rates_partner_idx on public.enquiry_buy_rates (partner_id);

alter table public.enquiry_buy_rates enable row level security;
drop policy if exists enquiry_buy_rates_all on public.enquiry_buy_rates;
create policy enquiry_buy_rates_all on public.enquiry_buy_rates for all to authenticated using (true) with check (true);

-- Who last changed it, and when, whoever writes it.
create or replace function public.enquiry_buy_rates_touch()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $fn$;

drop trigger if exists enquiry_buy_rates_touch on public.enquiry_buy_rates;
create trigger enquiry_buy_rates_touch
  before update on public.enquiry_buy_rates
  for each row execute function public.enquiry_buy_rates_touch();

revoke execute on function public.enquiry_buy_rates_touch() from public, anon, authenticated;

notify pgrst, 'reload schema';
