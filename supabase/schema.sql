-- Araxys — Supabase schema
--
-- Two tables carry the state that must survive a restart:
--   real_records — customers captured from actual calls
--   call_logs    — what was said, and what we extracted from it
--
-- The seeded demo shipments deliberately stay in code (src/data/mockData.ts). They are
-- scaffolding, not business data, and keeping them out of the database preserves the
-- real-vs-dummy separation the CRM shows.

-- ---------------------------------------------------------------- real_records

create table if not exists public.real_records (
  ref               text primary key,              -- ARX-ENQ-0001, issued at first contact
  phone             text not null,                 -- primary identity; a BL may never exist
  phone_key         text not null,                 -- last 10 digits, for reliable matching
  customer_name     text,
  company           text,
  bl_number         text,                          -- null until a booking is confirmed
  stage             text not null default 'processing'
                      check (stage in ('processing','processed')),
  status            text not null default 'enquiry received',
  origin            text,
  destination       text,
  cargo_description text,
  volume_cbm        numeric,
  container_type    text,
  quoted_amount_inr numeric,
  agreed_amount_inr numeric,
  sailing_date      text,
  notes             text,
  source_call_id    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One record per caller. This is what makes a returning caller recognisable when they
-- have no reference number and never finished the booking.
create unique index if not exists real_records_phone_key_idx on public.real_records (phone_key);
create index if not exists real_records_bl_idx on public.real_records (bl_number);
create index if not exists real_records_stage_idx on public.real_records (stage);
create index if not exists real_records_company_idx on public.real_records (lower(company));

-- ---------------------------------------------------------------- call_logs

create table if not exists public.call_logs (
  call_id        text primary key,                 -- SnapServe call id
  agent_name     text,
  direction      text,
  from_number    text,
  to_number      text,
  phone_key      text,                             -- links a call to a customer
  status         text,
  duration_secs  integer,
  transcript     text,                             -- what was actually said
  summary        text,
  -- SnapServe's own disposition extraction never fires (dispositionResult is null on
  -- every call), so structured fields are extracted from the transcript on our side and
  -- kept here rather than depending on a feature that does not work.
  extracted      jsonb,
  started_at     timestamptz,
  ended_at       timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists call_logs_phone_key_idx on public.call_logs (phone_key);
create index if not exists call_logs_started_idx on public.call_logs (started_at desc);

-- ---------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists real_records_touch on public.real_records;
create trigger real_records_touch
  before update on public.real_records
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- access control
--
-- RLS on, with no public policies: the anon/publishable key can read nothing. All access
-- goes through the backend using the service_role key, which bypasses RLS. This matters
-- because these rows hold real customer names and phone numbers — exactly the data that
-- must not be readable from a browser.

alter table public.real_records enable row level security;
alter table public.call_logs   enable row level security;
