-- 114: The customer's quotation page answers back (1 Oct).
--
-- The page a customer opens from the quotation mail could only accept. Now:
--
--   * "Revise this quote" with what they want changed — also on a quotation
--     that has expired ("please re-quote"). Kept on the link (the latest
--     request), and on the enquiry's timeline each time.
--   * After accepting, the page says "Booking confirmed" and asks for the
--     shipper: name, address, contact, email. Kept on the link; written onto
--     the enquiry's new shipper fields, and the shipment's, where they are
--     blank — never over what the desk has typed. A shipment made later takes
--     them from the enquiry (shipment_from_enquiry).
--
-- Both are anonymous calls, like reading and accepting: security definer,
-- the token is the only key, fixed shapes back, lengths bounded.

alter table public.quote_links
  add column if not exists revision_requested_at timestamptz,
  add column if not exists revision_note text,
  add column if not exists revision_name text,
  add column if not exists shipper jsonb,
  add column if not exists shipper_at timestamptz;

alter table public.enquiries
  add column if not exists shipper_name    text,
  add column if not exists shipper_address text,
  add column if not exists shipper_contact text,
  add column if not exists shipper_email   text;

create or replace function public.request_revision_by_token(p_token text, p_note text, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link  public.quote_links;
  v_quote public.quotes;
  v_note  text := btrim(coalesce(p_note, ''));
  v_name  text := nullif(left(btrim(coalesce(p_name, '')), 120), '');
begin
  if length(v_note) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  if length(v_note) > 2000 then
    v_note := left(v_note, 2000);
  end if;

  select * into v_link from public.quote_links where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if v_link.revoked then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_link.accepted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'accepted');
  end if;
  select * into v_quote from public.quotes where id = v_link.quote_id;
  if v_quote.status = 'declined' then
    return jsonb_build_object('ok', false, 'reason', 'declined');
  end if;
  -- Asked the same thing again (a double press): nothing new to record.
  if v_link.revision_note = v_note and v_link.revision_requested_at > now() - interval '10 minutes' then
    return jsonb_build_object('ok', true, 'reason', 'already');
  end if;

  update public.quote_links
     set revision_requested_at = now(),
         revision_note = v_note,
         revision_name = v_name
   where id = v_link.id;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_quote.enquiry_ref,
    'revision_requested',
    'Customer asked for a revision of quotation v' || v_quote.version
      || case when v_name is not null then ' (' || v_name || ')' else '' end
      || ': ' || left(v_note, 300),
    jsonb_build_object('quote_id', v_quote.id, 'note', v_note, 'name', v_name, 'expired', v_link.expires_at <= now()),
    null
  );

  return jsonb_build_object('ok', true, 'reason', 'requested');
end $$;

create or replace function public.shipper_by_token(
  p_token text,
  p_name text,
  p_address text,
  p_contact text default null,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.quote_links;
  v_quote   public.quotes;
  v_name    text := left(btrim(coalesce(p_name, '')), 200);
  v_address text := left(btrim(coalesce(p_address, '')), 1000);
  v_contact text := nullif(left(btrim(coalesce(p_contact, '')), 200), '');
  v_email   text := nullif(lower(left(btrim(coalesce(p_email, '')), 200)), '');
  v_ship    public.shipments;
begin
  if length(v_name) < 2 or length(v_address) < 5 then
    return jsonb_build_object('ok', false, 'reason', 'incomplete');
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;

  select * into v_link from public.quote_links where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  if v_link.revoked then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  -- Only once the booking is confirmed: before that there is nothing to ship.
  if v_link.accepted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_accepted');
  end if;
  select * into v_quote from public.quotes where id = v_link.quote_id;

  update public.quote_links
     set shipper = jsonb_build_object('name', v_name, 'address', v_address, 'contact', v_contact, 'email', v_email),
         shipper_at = now()
   where id = v_link.id;

  -- Blanks only: what the desk has typed is theirs.
  update public.enquiries
     set shipper_name    = coalesce(nullif(btrim(shipper_name), ''), v_name),
         shipper_address = coalesce(nullif(btrim(shipper_address), ''), v_address),
         shipper_contact = coalesce(nullif(btrim(shipper_contact), ''), v_contact),
         shipper_email   = coalesce(nullif(btrim(shipper_email), ''), v_email),
         updated_at      = now()
   where ref = v_quote.enquiry_ref;

  select * into v_ship from public.shipments where enquiry_ref = v_quote.enquiry_ref;
  if found and v_ship.signed_off_at is null then
    update public.shipments
       set shipper_name    = coalesce(nullif(btrim(shipper_name), ''), v_name),
           shipper_address = coalesce(nullif(btrim(shipper_address), ''), v_address),
           shipper_email   = coalesce(nullif(btrim(shipper_email), ''), v_email),
           updated_at      = now()
     where id = v_ship.id;
  end if;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (
    v_quote.enquiry_ref,
    'shipper_given',
    'Customer gave the shipper on the quotation page: ' || v_name,
    jsonb_build_object('quote_id', v_quote.id, 'name', v_name, 'address', v_address, 'contact', v_contact, 'email', v_email),
    null
  );

  return jsonb_build_object('ok', true, 'reason', 'saved');
end $$;

CREATE OR REPLACE FUNCTION public.shipment_from_enquiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e public.enquiries;
begin
  select * into e from public.enquiries where ref = new.enquiry_ref;
  if not found then
    return new;
  end if;

  -- Job facts.
  new.origin          := coalesce(new.origin, e.origin);
  new.destination     := coalesce(new.destination, e.destination);
  new.cargo           := coalesce(new.cargo, e.cargo);
  new.piece_count     := coalesce(new.piece_count, e.piece_count);
  new.volume_cbm      := coalesce(new.volume_cbm, e.volume_cbm);
  new.gross_weight_kg := coalesce(new.gross_weight_kg, e.gross_weight_kg);
  new.transport_mode  := coalesce(new.transport_mode, e.transport_mode);
  new.trade_direction := coalesce(new.trade_direction, e.trade_direction);
  new.incoterm        := coalesce(new.incoterm, e.incoterm);
  new.un_number       := coalesce(new.un_number, e.un_number);
  new.imo_class       := coalesce(new.imo_class, e.imo_class);
  new.packing_group   := coalesce(new.packing_group, e.packing_group);
  new.flash_point_c   := coalesce(new.flash_point_c, e.flash_point_c);
  new.msds_provided   := coalesce(new.msds_provided, e.msds_provided);

  -- Booking particulars, as a starting point.
  -- The shipper, as the customer gave it on the quotation page (114).
  new.shipper_name      := coalesce(new.shipper_name, e.shipper_name);
  new.shipper_address   := coalesce(new.shipper_address, e.shipper_address);
  new.shipper_email     := coalesce(new.shipper_email, e.shipper_email);
  new.consignee_name    := coalesce(new.consignee_name, e.consignee_name);
  new.consignee_address := coalesce(new.consignee_address, e.consignee_address);
  new.consignee_country := coalesce(new.consignee_country, e.consignee_country);
  new.notify_name       := coalesce(new.notify_name, e.notify_name);
  new.notify_address    := coalesce(new.notify_address, e.notify_address);
  new.marks_and_numbers := coalesce(new.marks_and_numbers, e.marks_and_numbers);
  new.hs_code           := coalesce(new.hs_code, e.hs_code);
  new.package_count     := coalesce(new.package_count, e.package_count);
  new.package_type      := coalesce(new.package_type, e.package_type);
  new.net_weight_kg     := coalesce(new.net_weight_kg, e.net_weight_kg);
  new.cfs_location      := coalesce(new.cfs_location, e.cfs_location);
  new.cargo_cutoff      := coalesce(new.cargo_cutoff, e.cargo_cutoff);
  new.si_cutoff         := coalesce(new.si_cutoff, e.si_cutoff);
  new.freight_terms     := coalesce(new.freight_terms, e.freight_terms);

  -- Shipment-only, with the defaults the enquiry implies.
  new.shipment_date     := coalesce(new.shipment_date, e.ready_date, current_date);
  new.port_of_loading   := coalesce(new.port_of_loading, e.origin);
  new.port_of_discharge := coalesce(new.port_of_discharge, e.destination);
  new.etd               := coalesce(new.etd, new.sailing_date);

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.quote_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link  public.quote_links;
  v_quote public.quotes;
  v_enq   public.enquiries;
  v_cust  public.customers;
  v_lines jsonb;
begin
  select * into v_link from public.quote_links where token = p_token;
  if not found then
    return jsonb_build_object('state', 'unknown');
  end if;

  select * into v_quote from public.quotes    where id  = v_link.quote_id;
  select * into v_enq   from public.enquiries where ref = v_quote.enquiry_ref;
  select * into v_cust  from public.customers where id  = v_enq.customer_id;

  -- The charge lines as the document prints them. `cost_inr` is deliberately
  -- not selected: it is what a partner charges us, and a customer seeing it is
  -- the one mistake on this path that cannot be undone.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'description', l.description,
             'unit',        l.unit,
             'quantity',    l.quantity,
             'rate',        l.rate,
             'currency',    l.currency,
             'amount_inr',  l.amount_inr
           ) order by l.position
         ), '[]'::jsonb)
    into v_lines
    from public.quote_lines l
   where l.quote_id = v_quote.id;

  return jsonb_build_object(
    'state', case
               when v_link.revoked                then 'revoked'
               when v_link.accepted_at is not null then 'accepted'
               when v_link.expires_at <= now()    then 'expired'
               when v_quote.status = 'declined'   then 'declined'
               else 'open'
             end,
    'accepted_at',   v_link.accepted_at,
    'accepted_name', v_link.accepted_name,
    -- 114: what the customer has already told us through this page.
    'revision_requested_at', v_link.revision_requested_at,
    'revision_note', v_link.revision_note,
    'shipper', v_link.shipper,
    'reference',     v_enq.ref,
    'version',       v_quote.version,
    'issued_on',     v_quote.created_at,
    'valid_until',   v_quote.valid_until,
    'amount_inr',    v_quote.amount_inr,
    'terms',         v_quote.terms,
    'customer',      coalesce(nullif(v_cust.company, ''), v_cust.name),
    'origin',        v_enq.origin,
    'destination',   v_enq.destination,
    'cargo',         v_enq.cargo,
    'ready_date',    v_enq.ready_date,
    'lines',         v_lines
  );
end $function$;

revoke execute on function public.request_revision_by_token(text, text, text) from public;
revoke execute on function public.shipper_by_token(text, text, text, text, text) from public;
grant execute on function public.request_revision_by_token(text, text, text) to anon, authenticated;
grant execute on function public.shipper_by_token(text, text, text, text, text) to anon, authenticated;
revoke execute on function public.shipment_from_enquiry() from public, anon, authenticated;
