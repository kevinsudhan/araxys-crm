-- Calls, and how a phone number comes to be attached to a customer.
--
-- A call and an email are two sightings of the same person under two different
-- identifiers. The customer record is where they meet: phones[] is what a call
-- matches on, emails[] is what mail matches on. Once both are on the same row,
-- the case file assembles itself with no manual step.
--
-- The interesting case is a customer who mailed first and then rings from a
-- number nobody has seen. Nothing links the two -- until they read out the
-- reference from the reply, which identifies the customer and lets the phone
-- number be written onto that record. From then on they are one person.

create table if not exists public.calls (
  call_id        text primary key,               -- SnapServe's id
  enquiry_ref    text references public.enquiries(ref) on delete set null,
  customer_id    text references public.customers(id) on delete set null,

  agent_name     text not null default '',
  direction      text not null default 'inbound',
  from_number    text not null default '',
  to_number      text not null default '',

  -- Last ten digits, so +91 98401 12233 and 09840112233 are the same caller.
  -- Matching on the raw string fails the moment a carrier formats it differently.
  phone_key      text generated always as (
                   right(regexp_replace(from_number, '[^0-9]', '', 'g'), 10)
                 ) stored,

  status         text not null default '',
  duration_secs  int  not null default 0,
  language       text not null default '',
  transcript     text,
  summary        text,
  started_at     timestamptz,
  ended_at       timestamptz,

  /** How the caller was tied to a customer, kept because a guess should not look like a fact. */
  matched_by     text check (matched_by in ('phone','reference','manual','unmatched')),

  ingested_at    timestamptz not null default now()
);

create index if not exists calls_phone_idx   on public.calls (phone_key);
create index if not exists calls_enquiry_idx on public.calls (enquiry_ref);
create index if not exists calls_started_idx on public.calls (started_at desc);

do $rls$
declare t text;
begin
  foreach t in array array['calls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
                   t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)',
                   t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)',
                   t || '_update', t);
  end loop;
end $rls$;

-- ---------------------------------------------------------------------------
-- Attach a phone number to a customer.
--
-- Used when a caller identifies themselves by reading out a reference from an
-- email we sent. The number is added rather than replacing what is there: a
-- company has several people, and a second number is another way to reach the
-- same customer, not a correction of the first.
-- ---------------------------------------------------------------------------
create or replace function public.link_phone_to_customer(
  p_customer_id text,
  p_phone       text
) returns public.customers
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.customers;
begin
  update public.customers
     set phones = case
                    when p_phone = any (phones) then phones
                    else array_append(phones, p_phone)
                  end,
         updated_at = now()
   where id = p_customer_id
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.link_phone_to_customer(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Find a customer by caller ID, on the last ten digits.
-- ---------------------------------------------------------------------------
create or replace function public.customer_by_phone(p_phone text)
returns public.customers
language sql
stable
security definer
set search_path = public
as $fn$
  select c.*
    from public.customers c,
         lateral unnest(c.phones) as ph
   where right(regexp_replace(ph, '[^0-9]', '', 'g'), 10)
       = right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 10)
   limit 1;
$fn$;

grant execute on function public.customer_by_phone(text) to authenticated;
