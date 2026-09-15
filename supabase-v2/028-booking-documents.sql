-- ---------------------------------------------------------------------------
-- The details a document needs that a booking did not hold.
--
-- WHAT WAS WRONG
--
-- The document registry can issue twelve papers, and against a real booking
-- only three of them came out as finals. The other nine printed as drafts
-- naming what they lacked — consignee name, consignee address, number of
-- packages, HS code — and the reason was not that nobody had typed those in.
-- It was that there was nowhere to type them: the shipments table has a route,
-- a cargo line, a weight and a volume, and none of the particulars a bill of
-- lading is actually made of.
--
-- So the readiness check was right and permanently unsatisfiable. A desk could
-- have a complete booking in front of it and still not issue a final B/L.
--
-- WHY COLUMNS RATHER THAN ONE jsonb
--
-- The old mock kept these in a docGenDetails blob. Typed columns can be
-- queried, constrained and shown in a form; a blob can only be read whole by
-- code that already knows what is in it. These are stable fields on a shipping
-- document, not an open-ended bag.
--
-- ALL NULLABLE
--
-- A booking is entered before its consignee is confirmed, and the draft a
-- document prints while a field is missing is the thing the desk sends to chase
-- it. Requiring them would break the workflow the drafts exist to serve.
-- ---------------------------------------------------------------------------

alter table public.shipments
  -- Who it is going to. The single most-missed field: eight of the nine drafts
  -- were waiting on the consignee name alone.
  add column if not exists consignee_name    text,
  add column if not exists consignee_address text,
  add column if not exists consignee_country text,

  -- The shipper side, for the invoice and the export paperwork.
  add column if not exists shipper_name      text,
  add column if not exists shipper_gstin_iec text,

  -- Particulars as they appear on the B/L.
  -- 40GP, 40HC, 20GP. The table recorded the container's NUMBER but never what
  -- kind of box it was, which is the one thing a booking confirmation needs.
  add column if not exists container_type    text,

  add column if not exists package_count     int,
  add column if not exists package_type      text,
  add column if not exists hs_code           text,
  add column if not exists net_weight_kg     numeric,

  -- Commercial terms.
  add column if not exists invoice_value_inr numeric,
  add column if not exists incoterm          text,
  add column if not exists payment_terms     text,
  add column if not exists letter_of_credit  boolean;

-- Carried across from the enquiry where it already knows. The enquiry is where
-- the incoterm is agreed, so a booking that has one should not ask again.
update public.shipments s
   set incoterm = e.incoterm
  from public.enquiries e
 where e.ref = s.enquiry_ref
   and s.incoterm is null
   and e.incoterm is not null;

-- Same for the shipper: the customer on the enquiry is the shipper unless the
-- desk says otherwise.
update public.shipments s
   set shipper_name = coalesce(nullif(c.company, ''), c.name)
  from public.enquiries e
  join public.customers c on c.id = e.customer_id
 where e.ref = s.enquiry_ref
   and s.shipper_name is null;

-- Where the enquiry is already on a container, that container's type is the
-- booking's type. Read once here rather than joined at render time: the booking
-- is a statement of what was agreed, and a later change to the sailing is not a
-- silent change to a document already issued.
update public.shipments s
   set container_type = sa.container_code
  from public.enquiries e
  join public.sailings sa on sa.id = e.sailing_id
 where e.ref = s.enquiry_ref
   and s.container_type is null;

-- RLS is unchanged: these are columns on a table the desk already reads and
-- writes, so they inherit its existing policies and nothing is opened here.
