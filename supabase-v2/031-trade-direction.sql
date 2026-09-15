-- ---------------------------------------------------------------------------
-- Which way the cargo is going.
--
-- WHY IT MATTERS HERE RATHER THAN ANYWHERE ELSE
--
-- Because the charges differ, and a list of charge heads that ignores the
-- direction offers a delivery-order fee on an export and a VGM filing on an
-- import. Both are wrong, and the operator has to know to skip them — which is
-- exactly the kind of knowledge a CRM is supposed to hold so that the person
-- does not have to.
--
-- Half the document registry turns on it too: an arrival notice and a delivery
-- order only exist on an import.
--
-- WHY IT WAS NEVER RECORDED
--
-- Because it was never in doubt. Every sailing on this desk is Chennai to
-- somewhere and every enquiry in the database is an export, so the direction
-- was carried in everybody's head and in the word "origin". That works until
-- the first import, at which point nothing in the schema disagrees with the
-- assumption and every screen quietly stays wrong.
--
-- NOT DERIVED AT READ TIME
--
-- A guess from the port names is good enough to fill the column in once, and
-- not good enough to be re-run on every query — the day somebody books Colombo
-- to Singapore, a cross trade, the guess says "import" because neither end is
-- India. So it is guessed once, stored, and editable.
-- ---------------------------------------------------------------------------

/**
 * Whether a place name is an Indian port this desk works through.
 *
 * A list, not a lookup service. Twelve names cover everything this company has
 * ever shipped through, and a wrong answer here only affects a default that a
 * person can change — which is the right trade for not adding a dependency on
 * a port database to fill in one field.
 */
create or replace function public.is_indian_port(p_place text)
returns boolean
language sql
immutable
as $fn$
  -- The pattern is parenthesised because `~` binds tighter than `||`: without
  -- them this reads as (lower(x) ~ 'first piece') || 'the rest', which is a
  -- boolean concatenated with text rather than a match against the whole thing.
  select coalesce(
    lower(coalesce(p_place, '')) ~ ('(chennai|madras|ennore|kattupalli|nhava|jnpt|sheva|mundra|'
                                 || 'cochin|kochi|tuticorin|thoothukudi|vizag|visakhapatnam|'
                                 || 'kolkata|calcutta|kandla|pipavav|krishnapatnam|hazira|'
                                 || 'mangalore|mumbai|bombay|india)'),
    false);
$fn$;

create or replace function public.guess_trade_direction(p_origin text, p_destination text)
returns text
language sql
immutable
as $fn$
  select case
           when public.is_indian_port(p_origin) then 'export'
           when public.is_indian_port(p_destination) then 'import'
           -- Neither end is India: the cargo never touches the country this
           -- desk sits in. Saying "import" here would be a straight guess, and
           -- a cross trade bills differently from both.
           else 'cross_trade'
         end;
$fn$;

alter table public.enquiries
  add column if not exists trade_direction text
    check (trade_direction in ('export','import','cross_trade'));

alter table public.shipments
  add column if not exists trade_direction text
    check (trade_direction in ('export','import','cross_trade'));

-- Snapshotted onto the invoice with everything else, so the charge list a
-- document was built from is the one that applied at the time.
alter table public.invoices
  add column if not exists trade_direction text
    check (trade_direction in ('export','import','cross_trade'));

update public.enquiries
   set trade_direction = public.guess_trade_direction(origin, destination)
 where trade_direction is null
   and (origin is not null or destination is not null);

update public.shipments
   set trade_direction = public.guess_trade_direction(origin, destination)
 where trade_direction is null
   and (origin is not null or destination is not null);

update public.invoices i
   set trade_direction = s.trade_direction
  from public.shipments s
 where s.id = i.shipment_id
   and i.trade_direction is null;

grant execute on function public.is_indian_port(text)            to authenticated;
grant execute on function public.guess_trade_direction(text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Carried onto new invoices.
--
-- Only the two lines marked below differ from 030; the rest is unchanged and
-- repeated because `create or replace function` replaces the whole body.
-- ---------------------------------------------------------------------------
create or replace function public.start_invoice(
  p_shipment_id text,
  p_kind        text default 'tax_invoice'
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ship public.shipments;
  v_cust public.customers;
  v_row  public.invoices;
  v_series text;
begin
  select * into v_ship from public.shipments where id = p_shipment_id;
  if not found then
    raise exception 'No shipment %', p_shipment_id;
  end if;

  select * into v_cust from public.customers where id = v_ship.customer_id;

  select * into v_row
    from public.invoices
   where shipment_id = p_shipment_id
     and kind = p_kind
     and status = 'draft'
   order by created_at desc
   limit 1;
  if found then
    return v_row;
  end if;

  v_series := case p_kind
                when 'proforma'    then 'PRO'
                when 'credit_note' then 'CRN'
                when 'debit_note'  then 'DBN'
                else 'INV'
              end;

  insert into public.invoices (
    kind, series, shipment_id, enquiry_ref, customer_id,
    bill_to_name, bill_to_address, bill_to_gstin,
    bill_to_state, bill_to_state_code, bill_to_country,
    attention,
    bl_number, bl_date, vessel_voyage, movement_type, volume_cbm, gross_weight_kg,
    place_of_supply, place_of_supply_code,
    tax_treatment,
    trade_direction,                                          -- new
    due_date,
    created_by
  ) values (
    p_kind, v_series, v_ship.id, v_ship.enquiry_ref, v_ship.customer_id,

    coalesce(nullif(v_cust.billing_name, ''), nullif(v_cust.company, ''), v_cust.name),
    coalesce(v_cust.billing_address, ''),
    v_cust.gstin,
    v_cust.billing_state,
    v_cust.billing_state_code,
    coalesce(v_cust.billing_country, 'India'),
    coalesce(v_cust.billing_attention, ''),

    v_ship.bl_number,
    v_ship.etd,
    nullif(trim(coalesce(v_ship.vessel, '') || ' / ' || coalesce(v_ship.voyage, '')), '/'),
    (select sa.mode || '/' || sa.mode
       from public.enquiries e
       join public.sailings sa on sa.id = e.sailing_id
      where e.ref = v_ship.enquiry_ref),
    v_ship.volume_cbm,
    v_ship.gross_weight_kg,

    v_cust.billing_state,
    v_cust.billing_state_code,

    public.suggest_tax_treatment(v_cust.billing_country, v_cust.billing_state_code),

    coalesce(v_ship.trade_direction,                          -- new
             public.guess_trade_direction(v_ship.origin, v_ship.destination)),

    case
      when v_cust.payment_terms_days is not null
        then current_date + v_cust.payment_terms_days
      else null
    end,

    auth.uid()
  )
  returning * into v_row;

  if v_ship.agreed_inr is not null and v_ship.agreed_inr > 0 then
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit, rate)
    values (v_row.id, 1, 'Freight and services as per accepted quotation', 1, 'Lumpsum',
            v_ship.agreed_inr);
    select * into v_row from public.invoices where id = v_row.id;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ship.enquiry_ref, 'invoice_started',
    format('%s draft started for %s', replace(p_kind, '_', ' '), v_ship.id),
    jsonb_build_object('invoice_id', v_row.id, 'shipment_id', v_ship.id),
    auth.uid()
  );

  return v_row;
end $fn$;

grant execute on function public.start_invoice(text, text) to authenticated;
