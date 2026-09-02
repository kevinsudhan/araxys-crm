-- Operational schema for v2. Real data, in v2's own project, v1 untouched.
--
-- Scope is the inbound half: an enquiry arrives, details are captured, a quote
-- goes out, the customer accepts. Booking, allocation and documents are
-- deliberately not modelled here yet.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id          text primary key,                -- C0042
  name        text not null,
  company     text not null default '',
  phones      text[] not null default '{}',
  emails      text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customers_emails_idx on public.customers using gin (emails);
create index if not exists customers_phones_idx on public.customers using gin (phones);

-- ---------------------------------------------------------------------------
-- Enquiries
--
-- The reference is ours and issued here, because an enquiry exists before any
-- email does -- a phone call creates one -- and because a shipment spans many
-- mail threads that no single conversationId could cover.
-- ---------------------------------------------------------------------------
create table if not exists public.enquiries (
  ref               text primary key,          -- ARX-C0042-E01
  customer_id       text not null references public.customers(id) on delete restrict,
  seq               int  not null,             -- per customer, not global
  status            text not null default 'new'
                      check (status in ('new','qualifying','quoted','accepted','declined','lost')),
  source            text not null default 'email'
                      check (source in ('email','call','whatsapp','web','manual')),

  origin            text,
  destination       text,
  cargo             text,
  cargo_type        text,
  incoterm          text,
  ready_date        date,
  pickup_location   text,

  piece_count         int,
  piece_length_cm     numeric,
  piece_width_cm      numeric,
  piece_height_cm     numeric,
  weight_per_piece_kg numeric,
  gross_weight_kg     numeric,
  volume_cbm          numeric,
  stackable           boolean,
  upright_only        boolean,
  special_handling    text,

  consignee_name    text,
  consignee_country text,

  notes             text,
  opened_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (customer_id, seq)
);

create index if not exists enquiries_status_idx   on public.enquiries (status);
create index if not exists enquiries_customer_idx on public.enquiries (customer_id);

-- ---------------------------------------------------------------------------
-- Parties
--
-- Roles are recorded, never inferred from the address. An unknown sender stays
-- unknown until somebody says who they are.
-- ---------------------------------------------------------------------------
create table if not exists public.enquiry_parties (
  id           uuid primary key default gen_random_uuid(),
  enquiry_ref  text not null references public.enquiries(ref) on delete cascade,
  role         text not null
                 check (role in ('client','consol_partner','carrier','cha_customs','cfs_transport','other')),
  name         text not null default '',
  organisation text not null default '',
  emails       text[] not null default '{}',
  created_at   timestamptz not null default now()
);

create index if not exists parties_enquiry_idx on public.enquiry_parties (enquiry_ref);
create index if not exists parties_emails_idx  on public.enquiry_parties using gin (emails);

-- ---------------------------------------------------------------------------
-- Mail threads bound to an enquiry
--
-- conversationId is not the identity, it is one filing signal. Storing it is
-- what lets the rest of a conversation file itself once the first message has
-- been placed.
-- ---------------------------------------------------------------------------
create table if not exists public.enquiry_threads (
  conversation_id text primary key,
  enquiry_ref     text not null references public.enquiries(ref) on delete cascade,
  bound_by        uuid references auth.users(id),
  bound_at        timestamptz not null default now()
);

create index if not exists threads_enquiry_idx on public.enquiry_threads (enquiry_ref);

-- Individual messages pinned to an enquiry, for those a thread cannot reach.
-- The composite key allows one message to concern several shipments, which
-- happens whenever a carrier writes about four bookings at once.
create table if not exists public.enquiry_messages (
  message_id  text not null,
  enquiry_ref text not null references public.enquiries(ref) on delete cascade,
  via         text not null default 'manual'
                check (via in ('thread','subject','reference-in-body','manual')),
  linked_by   uuid references auth.users(id),
  linked_at   timestamptz not null default now(),
  primary key (message_id, enquiry_ref)
);

-- ---------------------------------------------------------------------------
-- Quotes
--
-- Rows rather than a column on the enquiry: a quote gets revised, and what was
-- offered the first time is exactly what you need when a customer says "you
-- told me a different number last week".
-- ---------------------------------------------------------------------------
create table if not exists public.quotes (
  id            uuid primary key default gen_random_uuid(),
  enquiry_ref   text not null references public.enquiries(ref) on delete cascade,
  version       int  not null default 1,
  amount_inr    numeric not null,
  basis         text not null default '',
  valid_until   date,
  sailing_date  date,
  status        text not null default 'draft'
                  check (status in ('draft','sent','accepted','declined','expired','superseded')),
  sent_at       timestamptz,
  responded_at  timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (enquiry_ref, version)
);

create index if not exists quotes_enquiry_idx on public.quotes (enquiry_ref);

-- ---------------------------------------------------------------------------
-- Events -- the audit trail behind the case-file timeline
-- ---------------------------------------------------------------------------
create table if not exists public.enquiry_events (
  id          uuid primary key default gen_random_uuid(),
  enquiry_ref text not null references public.enquiries(ref) on delete cascade,
  kind        text not null,
  summary     text not null,
  detail      jsonb not null default '{}'::jsonb,
  actor       uuid references auth.users(id),
  at          timestamptz not null default now()
);

create index if not exists events_enquiry_idx on public.enquiry_events (enquiry_ref, at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- These tables are company-internal: any signed-in member of the tenant may
-- read and write. The boundary that matters is authenticated versus anonymous,
-- not user versus user -- a desk where one operator cannot see another's
-- enquiries would not function.
--
-- Deletes are granted to nobody. An enquiry that comes to nothing is marked
-- 'lost', never erased, because the correspondence attached to it is the record
-- of what was said to a customer.
-- ---------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array[
    'customers','enquiries','enquiry_parties','enquiry_threads',
    'enquiry_messages','quotes','enquiry_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (true)',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (true) with check (true)',
      t || '_update', t);
  end loop;
end $rls$;

-- ---------------------------------------------------------------------------
-- Reference allocation
--
-- Issuing the next number in application code would race: two operators taking
-- an enquiry from the same customer at the same moment would both read the same
-- maximum and both write E03. It is decided inside one statement here, and the
-- unique constraint on (customer_id, seq) is the backstop if that ever fails.
-- ---------------------------------------------------------------------------
create or replace function public.create_enquiry(
  p_customer_id text,
  p_source      text default 'manual',
  p_origin      text default null,
  p_destination text default null,
  p_cargo       text default null
) returns public.enquiries
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_seq int;
  v_ref text;
  v_row public.enquiries;
begin
  select coalesce(max(seq), 0) + 1 into v_seq
    from public.enquiries where customer_id = p_customer_id;

  v_ref := format('ARX-%s-E%s', p_customer_id, lpad(v_seq::text, 2, '0'));

  insert into public.enquiries (ref, customer_id, seq, source, origin, destination, cargo)
  values (v_ref, p_customer_id, v_seq, p_source, p_origin, p_destination, p_cargo)
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
  values (v_ref, 'created', format('Enquiry opened from %s', p_source), auth.uid());

  return v_row;
end $fn$;

grant execute on function public.create_enquiry(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Customer allocation, same reasoning
-- ---------------------------------------------------------------------------
create or replace function public.create_customer(
  p_name    text,
  p_company text default '',
  p_email   text default null,
  p_phone   text default null
) returns public.customers
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_n   int;
  v_id  text;
  v_row public.customers;
begin
  -- An address we already know belongs to a customer we already have.
  if p_email is not null then
    select * into v_row from public.customers
      where lower(p_email) = any (select lower(unnest(emails))) limit 1;
    if found then return v_row; end if;
  end if;

  select coalesce(max(substring(id from 2)::int), 0) + 1 into v_n from public.customers;
  v_id := 'C' || lpad(v_n::text, 4, '0');

  insert into public.customers (id, name, company, emails, phones)
  values (
    v_id, p_name, coalesce(p_company, ''),
    case when p_email is null then '{}'::text[] else array[p_email] end,
    case when p_phone is null then '{}'::text[] else array[p_phone] end
  )
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.create_customer(text, text, text, text) to authenticated;
