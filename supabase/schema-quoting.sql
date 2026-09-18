-- Araxys v1 — the quoting pipeline
--
-- What this adds: the desk can already capture an enquiry off a call (real_records) and
-- check whether cargo fits (space_slots). What it cannot do is the middle of the job —
-- ask partners for rates, compare what comes back, put a margin on it, and quote the
-- customer. These four tables are that middle.
--
-- ---------------------------------------------------------------------------------
-- WHY THIS EXTENDS real_records RATHER THAN ADDING AN `enquiries` TABLE
--
-- real_records already IS the enquiry. It has the ref (ARX-ENQ-0001), the phone identity,
-- the stage machine (enquiry -> processing -> processed), the route, the cargo, and
-- quoted_amount_inr. A second table holding the same facts would mean two rows that
-- disagree the first time someone edits one, and the voice agents write to this one.
--
-- So partner_quotes and quote_lines hang off real_records.ref, and quoted_amount_inr
-- becomes the roll-up of the sell lines rather than a number typed in separately.
--
-- The shapes here follow araxys-crm-v2, which already runs this pipeline against a live
-- desk. v2 is not modified by any of this and does not read these tables.
-- ---------------------------------------------------------------------------------

-- ---------------------------------------------------------------- partners

-- Who the desk can ask for a rate. Carriers, co-loaders, CHAs, transporters.
--
-- `tags` is what makes a partner findable: route lanes ("Chennai-Singapore"), ports,
-- cargo types, incoterms. An agent scores a partner by how many tags touch the enquiry,
-- so a partner with no tags is one nobody will ever be asked.
create table if not exists public.partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  organisation  text not null default '',
  role          text not null default 'other'
                  check (role in ('carrier','coloader','cha','transporter','warehouse','other')),
  emails        text[] not null default '{}',
  phones        text[] not null default '{}',
  tags          text[] not null default '{}',
  notes         text not null default '',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists partners_active_idx on public.partners (active) where active;
create index if not exists partners_tags_idx   on public.partners using gin (tags);

-- ---------------------------------------------------------------- partner quotes (RFQ)

-- One row per partner we asked, per enquiry. The buying side of the deal.
--
-- `status` is the life of a request: asked -> quoted, or asked -> declined, or asked and
-- never answered. The agent creates these in a burst when it sends the RFQs, and the
-- cut-off sentinel chases the ones still sitting at 'asked' when their deadline nears.
--
-- `thread_ref` is how a reply gets matched back to the request. Gmail gives a threadId;
-- without it, a reply is just mail from a partner and nobody knows which enquiry it
-- answers.
create table if not exists public.partner_quotes (
  id            uuid primary key default gen_random_uuid(),
  enquiry_ref   text not null references public.real_records(ref) on delete cascade,
  partner_id    uuid references public.partners(id) on delete set null,
  -- Kept as text as well as a join, so a quote survives a partner being deleted and a
  -- one-off partner can be asked without being registered first.
  partner_email text not null,
  partner_label text not null default '',

  status        text not null default 'asked'
                  check (status in ('asked','quoted','declined','expired')),
  thread_ref    text,

  amount        numeric,
  currency      text,
  transit_days  int,
  valid_until   date,
  notes         text not null default '',

  asked_at      timestamptz not null default now(),
  replied_at    timestamptz,
  -- When we expect an answer. The sentinel reads this; a null means nobody is chasing.
  due_at        timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists partner_quotes_enquiry_idx on public.partner_quotes (enquiry_ref);
create index if not exists partner_quotes_status_idx  on public.partner_quotes (status);
create index if not exists partner_quotes_thread_idx  on public.partner_quotes (thread_ref)
  where thread_ref is not null;

-- The same partner should not be asked twice for one enquiry. A duplicate burst is the
-- easy mistake for an agent to make, and the partner sees it as disorganisation.
create unique index if not exists partner_quotes_once_idx
  on public.partner_quotes (enquiry_ref, partner_email);

-- ---------------------------------------------------------------- quote lines

-- What the customer is charged, and what each charge costs us.
--
-- ---------------------------------------------------------------------------------
-- THE COST SITS BESIDE THE SELL, NEVER INSTEAD OF IT
--
-- `amount_inr` is the selling price — the figure the customer sees. `cost_inr` is what a
-- partner quoted us for that same charge. They live on one row so the margin is visible
-- while the quotation is being built, which is the only moment anyone can do anything
-- about it.
--
-- cost_inr must never be rendered into a customer-facing document. A partner's figure is
-- a buying price, and putting one in front of a customer hands the shipper our cost.
-- This rule is v2's, it is right, and the quote builder asserts it rather than trusting
-- everyone to remember.
-- ---------------------------------------------------------------------------------
create table if not exists public.quote_lines (
  id               uuid primary key default gen_random_uuid(),
  enquiry_ref      text not null references public.real_records(ref) on delete cascade,
  version          int  not null default 1,
  position         int  not null default 0,

  description      text not null,
  sac_code         text,
  quantity         numeric not null default 1,
  unit             text not null default 'shipment',
  rate             numeric not null default 0,
  currency         text not null default 'INR',
  amount_inr       numeric not null default 0,

  -- Null until a partner has actually priced this charge. Margin is unknown, not zero.
  cost_inr         numeric,
  partner_quote_id uuid references public.partner_quotes(id) on delete set null,

  created_at       timestamptz not null default now()
);

create index if not exists quote_lines_enquiry_idx on public.quote_lines (enquiry_ref, version, position);

-- ---------------------------------------------------------------- the agent's trail

-- Everything the agent did, in the order it did it, in words a human reads.
--
-- This is what makes an autonomous pipeline reviewable. A desk that cannot see why four
-- partners were asked, which replied, and how the margin was arrived at will not trust
-- the quote in front of it — and should not.
--
-- `actor` is text rather than a user id because v1 has no Supabase Auth; it holds
-- 'shipmate' for autonomous actions and a name for human ones.
create table if not exists public.enquiry_events (
  id           bigserial primary key,
  enquiry_ref  text not null references public.real_records(ref) on delete cascade,
  kind         text not null,
  summary      text not null,
  detail       jsonb not null default '{}'::jsonb,
  actor        text not null default 'shipmate',
  at           timestamptz not null default now()
);

create index if not exists enquiry_events_enquiry_idx on public.enquiry_events (enquiry_ref, at desc);

-- ---------------------------------------------------------------- pipeline state

-- Where an enquiry sits inside the quoting middle, which real_records.stage does not say.
--
-- stage answers "is this live work" (enquiry / processing / processed). This answers "how
-- far through quoting are we", which is a different question with its own dead ends: an
-- enquiry can sit at 'sourcing' for a week because no partner replied, while its stage
-- never moves.
alter table public.real_records
  add column if not exists pipeline text not null default 'captured'
    check (pipeline in ('captured','scoping','sourcing','collecting','pricing','awaiting_approval','quoted','accepted','declined'));

-- The margin the desk is working to on this enquiry, when it differs from the default.
alter table public.real_records
  add column if not exists target_margin_pct numeric;

create index if not exists real_records_pipeline_idx on public.real_records (pipeline);

-- ---------------------------------------------------------------- access control
--
-- Same rule as the rest of this schema: RLS on, no policies, so the anon key reads
-- nothing and every access goes through the backend with the service_role key. These
-- tables hold partner rates and our own margins, which is commercially the most sensitive
-- data in the system — a competitor who reads quote_lines knows exactly what the desk buys
-- at and what it charges.

alter table public.partners       enable row level security;
alter table public.partner_quotes enable row level security;
alter table public.quote_lines    enable row level security;
alter table public.enquiry_events enable row level security;

-- ---------------------------------------------------------------- touch triggers

create or replace function public.touch_updated_at_quoting()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists partners_touch on public.partners;
create trigger partners_touch before update on public.partners
  for each row execute function public.touch_updated_at_quoting();

drop trigger if exists partner_quotes_touch on public.partner_quotes;
create trigger partner_quotes_touch before update on public.partner_quotes
  for each row execute function public.touch_updated_at_quoting();
