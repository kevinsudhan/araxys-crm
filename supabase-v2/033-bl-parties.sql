-- ---------------------------------------------------------------------------
-- The parties as a bill of lading names them.
--
-- WHAT 028 STARTED AND THIS FINISHES
--
-- 028 added `consignee_name`, `consignee_address`, `consignee_country`,
-- `shipper_name` and `shipper_gstin_iec`, which was enough to stop nine of the
-- twelve documents printing as drafts. It is not enough to print a B/L party
-- box: that needs the city, the state and its code, the country and its code,
-- the postcode, and — for an Indian party — the GSTIN, PAN and IEC as separate
-- fields rather than one combined one.
--
-- There is also a third party. When a B/L is consigned to the order of a bank,
-- the actual importer is named separately, and nothing here could hold them.
--
-- WHY COLUMNS RATHER THAN A `shipment_parties` TABLE
--
-- A table was the first instinct, and it is wrong here for one specific reason.
-- The document pipeline reads `shipments.consignee_name` in nine specs, and
-- `BookingDocumentDetails.tsx` WRITES those five columns directly. A table
-- would therefore need the columns kept in sync from it — and that mirror would
-- have two writers, the trigger and the existing form, racing to overwrite each
-- other.
--
-- `shipments.container_number` is mirrored from `shipment_containers` in 032,
-- and that is safe precisely because nothing else writes it. The same trick
-- here would not be safe, so it is not used here.
--
-- These are single-valued attributes of one booking. Columns are what they are.
-- ---------------------------------------------------------------------------

alter table public.shipments
  -- ------------------------------------------------------------- shipper
  -- `shipper_name` and `shipper_gstin_iec` already exist. The combined field
  -- stays, because the shipping-instructions and commercial-invoice specs print
  -- it as one line; the separate ones below are what a party box needs.
  add column if not exists shipper_address      text,
  add column if not exists shipper_city         text,
  add column if not exists shipper_state        text,
  add column if not exists shipper_state_code   text,
  add column if not exists shipper_country      text,
  add column if not exists shipper_country_code text,
  add column if not exists shipper_pincode      text,
  add column if not exists shipper_gstin        text,
  add column if not exists shipper_pan          text,
  add column if not exists shipper_iec          text,

  -- ----------------------------------------------------------- consignee
  -- `consignee_name`, `consignee_address` and `consignee_country` exist.
  add column if not exists consignee_city         text,
  add column if not exists consignee_state        text,
  add column if not exists consignee_state_code   text,
  add column if not exists consignee_country_code text,
  add column if not exists consignee_pincode      text,
  add column if not exists consignee_gstin        text,
  add column if not exists consignee_pan          text,
  add column if not exists consignee_iec          text,
  -- Direct Port Delivery, for consignees cleared to take a box straight off the
  -- terminal rather than through a CFS.
  add column if not exists consignee_dpd_code     text,

  -- -------------------------------------------------------------- notify
  -- Called "Importer's reference" on some forms. It is the party to tell when
  -- the cargo arrives, and on an order B/L it is the only place the real
  -- importer is named at all.
  add column if not exists notify_name         text,
  add column if not exists notify_address      text,
  add column if not exists notify_city         text,
  add column if not exists notify_state        text,
  add column if not exists notify_state_code   text,
  add column if not exists notify_country      text,
  add column if not exists notify_country_code text,
  add column if not exists notify_pincode      text,
  add column if not exists notify_gstin        text,
  add column if not exists notify_pan          text,
  add column if not exists notify_iec          text,

  -- ------------------------------------------------------- which B/L this is
  -- On a co-load the cargo travels under somebody else's bill. `house` is our
  -- own HBL; `forwarder` means the other forwarder issued it and their number
  -- is the one the consignee will quote.
  add column if not exists bl_type          text
    check (bl_type in ('house','forwarder')),
  add column if not exists forwarders_bl_no text;

-- Default to our own bill, which is what an un-co-loaded shipment is.
update public.shipments set bl_type = 'house' where bl_type is null;


-- ---------------------------------------------------------------------------
-- Carrying across what the customer record already knows
--
-- On an export the customer is the shipper unless the desk says otherwise —
-- 028 already filled `shipper_name` on that basis. Now that the customer record
-- has billing details (030), the rest of the shipper box can come from the same
-- place rather than being typed a second time.
--
-- Only where the shipment's own field is still empty. A booking where somebody
-- has already corrected the shipper is not overwritten by the master.
-- ---------------------------------------------------------------------------
update public.shipments s
   set shipper_address    = coalesce(s.shipper_address, c.billing_address),
       shipper_city       = coalesce(s.shipper_city, c.billing_city),
       shipper_state      = coalesce(s.shipper_state, c.billing_state),
       shipper_state_code = coalesce(s.shipper_state_code, c.billing_state_code),
       shipper_country    = coalesce(s.shipper_country, c.billing_country),
       shipper_pincode    = coalesce(s.shipper_pincode, c.billing_pincode),
       shipper_gstin      = coalesce(s.shipper_gstin, c.gstin),
       shipper_pan        = coalesce(s.shipper_pan, c.pan),
       shipper_iec        = coalesce(s.shipper_iec, c.iec)
  from public.customers c
 where c.id = s.customer_id;

-- The state code is the first two characters of a GSTIN by construction, so
-- anywhere a GSTIN is recorded the state does not need asking for separately.
update public.shipments
   set shipper_state_code = substring(shipper_gstin from 1 for 2)
 where shipper_gstin is not null and length(shipper_gstin) = 15
   and shipper_state_code is null;

update public.shipments
   set consignee_state_code = substring(consignee_gstin from 1 for 2)
 where consignee_gstin is not null and length(consignee_gstin) = 15
   and consignee_state_code is null;

-- RLS is unchanged: these are columns on a table the desk already reads and
-- writes, so they inherit its policies and nothing is opened here.
