-- Shipments: what an accepted enquiry becomes.
--
-- Kept as its own row rather than more columns on the enquiry, because the two
-- answer different questions. The enquiry is a record of a sales conversation
-- and stops being interesting once it is won or lost; the shipment is an
-- operational object that outlives it and gets asked "where is my cargo".
--
-- One shipment per enquiry, enforced. Pressing the button twice is a thing
-- people do, and a duplicate booking is expensive to unpick.

create table if not exists public.shipments (
  id            text primary key,                -- ARX-SHP-0001
  enquiry_ref   text not null unique references public.enquiries(ref) on delete restrict,
  customer_id   text not null references public.customers(id) on delete restrict,

  stage         text not null default 'booked'
                  check (stage in ('booked','cargo_received','stuffed','gated_in',
                                   'sailed','arrived','delivered','cancelled')),

  -- Copied from the enquiry at the moment of acceptance, not read through it.
  -- What was agreed is what the shipment is; later edits to the enquiry are a
  -- correction of the sales record, not a silent change to a live booking.
  origin        text,
  destination   text,
  cargo         text,
  piece_count   int,
  volume_cbm    numeric,
  gross_weight_kg numeric,
  agreed_inr    numeric,
  sailing_date  date,

  -- Filled in as operations progresses.
  carrier         text,
  booking_number  text,
  container_number text,
  bl_number       text,
  vessel          text,
  voyage          text,
  etd             date,
  eta             date,

  sailing_id    text references public.sailings(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shipments_stage_idx    on public.shipments (stage);
create index if not exists shipments_customer_idx on public.shipments (customer_id);
create index if not exists shipments_bl_idx       on public.shipments (bl_number);

do $rls$
declare t text;
begin
  foreach t in array array['shipments'] loop
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
-- Promotion
--
-- Refuses unless the customer has accepted. That is the whole point of the
-- inbound half: a booking is a commitment somebody made, and creating one from
-- an enquiry nobody said yes to would put cargo on a sailing on the strength of
-- a conversation.
--
-- Done in one statement so the shipment, the enquiry's stage and the audit
-- entry cannot end up disagreeing with each other.
-- ---------------------------------------------------------------------------
create or replace function public.promote_enquiry(p_ref text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_enq    public.enquiries;
  v_quote  public.quotes;
  v_n      int;
  v_id     text;
  v_row    public.shipments;
begin
  select * into v_enq from public.enquiries where ref = upper(p_ref);
  if not found then
    raise exception 'No enquiry %', p_ref;
  end if;

  select * into v_quote
    from public.quotes
   where enquiry_ref = v_enq.ref and status = 'accepted'
   order by version desc limit 1;

  if not found then
    raise exception 'Cannot start a shipment: the customer has not accepted a quote on % yet', v_enq.ref
      using hint = 'Record their acceptance on the quote first.';
  end if;

  -- Pressing twice returns what already exists rather than raising, because the
  -- second press means "did that work?" and an error there reads as a failure.
  select * into v_row from public.shipments where enquiry_ref = v_enq.ref;
  if found then
    return v_row;
  end if;

  select coalesce(max(substring(id from 9)::int), 0) + 1 into v_n from public.shipments;
  v_id := 'ARX-SHP-' || lpad(v_n::text, 4, '0');

  insert into public.shipments (
    id, enquiry_ref, customer_id, stage,
    origin, destination, cargo, piece_count, volume_cbm, gross_weight_kg,
    agreed_inr, sailing_date
  ) values (
    v_id, v_enq.ref, v_enq.customer_id, 'booked',
    v_enq.origin, v_enq.destination, v_enq.cargo, v_enq.piece_count,
    v_enq.volume_cbm, v_enq.gross_weight_kg,
    v_quote.amount_inr, coalesce(v_quote.sailing_date, v_enq.ready_date)
  )
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_enq.ref, 'promoted',
    format('Moved to in-process shipments as %s', v_id),
    jsonb_build_object('shipment_id', v_id, 'agreed_inr', v_quote.amount_inr),
    auth.uid()
  );

  return v_row;
end $fn$;

grant execute on function public.promote_enquiry(text) to authenticated;

create or replace function public.set_shipment_stage(p_id text, p_stage text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.shipments;
begin
  update public.shipments
     set stage = p_stage, updated_at = now()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'No shipment %', p_id;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, actor)
  values (v_row.enquiry_ref, 'stage_changed',
          format('%s moved to %s', v_row.id, replace(p_stage, '_', ' ')), auth.uid());

  return v_row;
end $fn$;

grant execute on function public.set_shipment_stage(text, text) to authenticated;
