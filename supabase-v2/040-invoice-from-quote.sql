-- ---------------------------------------------------------------------------
-- An invoice starts from what was actually quoted.
--
-- WHAT THIS FINISHES
--
-- 030 seeded a new invoice with one line — "Freight and services as per
-- accepted quotation" — carrying the whole agreed figure. That was the honest
-- thing to do at the time, because a quote WAS one figure and inventing a
-- breakdown from it would have been this system making up numbers nobody
-- agreed to.
--
-- 039 gave quotations charge lines. So the breakdown now exists, it is the one
-- the customer accepted, and there is no longer any reason to retype it at
-- billing or to collapse it back into a single line.
--
-- The fallback stays. A quote agreed before 039, or one somebody chose not to
-- break down, still has no lines — and for those the single line remains the
-- only truthful thing to write.
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
  v_ship   public.shipments;
  v_cust   public.customers;
  v_row    public.invoices;
  v_series text;
  v_quote  public.quotes;
  v_copied int := 0;
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
    tax_treatment, trade_direction, due_date, created_by
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
    coalesce(v_ship.trade_direction,
             public.guess_trade_direction(v_ship.origin, v_ship.destination)),
    case
      when v_cust.payment_terms_days is not null
        then current_date + v_cust.payment_terms_days
      else null
    end,
    auth.uid()
  )
  returning * into v_row;

  -- ------------------------------------------------------------------------
  -- The charges, from the quotation the customer accepted.
  -- ------------------------------------------------------------------------
  select * into v_quote
    from public.quotes
   where enquiry_ref = v_ship.enquiry_ref and status = 'accepted'
   order by version desc
   limit 1;

  if found then
    v_copied := public.copy_quote_lines_to_invoice(v_row.id, v_quote.id);
  end if;

  -- Nothing to copy: either the quote predates charge lines or nobody broke it
  -- down. One line carrying the agreed figure, saying where it came from.
  if v_copied = 0 and v_ship.agreed_inr is not null and v_ship.agreed_inr > 0 then
    insert into public.invoice_lines (invoice_id, position, description, quantity, unit, rate)
    values (v_row.id, 1, 'Freight and services as per accepted quotation', 1, 'Lumpsum',
            v_ship.agreed_inr);
  end if;

  select * into v_row from public.invoices where id = v_row.id;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_ship.enquiry_ref, 'invoice_started',
    format('%s draft started for %s%s', replace(p_kind, '_', ' '), v_ship.id,
           case when v_copied > 0
                then format(' from %s quoted charge%s', v_copied,
                            case when v_copied = 1 then '' else 's' end)
                else '' end),
    jsonb_build_object('invoice_id', v_row.id, 'shipment_id', v_ship.id,
                       'from_quote_lines', v_copied),
    auth.uid()
  );

  return v_row;
end $fn$;

grant execute on function public.start_invoice(text, text) to authenticated;
