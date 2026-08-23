-- Araxys — structured request details
--
-- Every field the desk needs off a call, stored per customer as one JSON object keyed by
-- the field catalogue in supabase/functions/_shared/requestFields.ts.
--
-- Why jsonb and not 38 columns: the catalogue is the source of truth for the extractor,
-- the schema Claude is constrained to, and the CRM grid. Mirroring it as columns would
-- mean a migration every time a field is added, and three places that can disagree about
-- what a field is called. The keys are stable and flat, so they stay queryable —
--
--   select ref, request_details->>'incoterm' from real_records
--     where request_details->>'cargo_type' = 'hazardous_dg';
--
-- and the GIN index below makes containment lookups over them cheap.

alter table public.real_records
  add column if not exists request_details jsonb not null default '{}'::jsonb;

-- Which language the customer actually spoke, from the extractor. Worth keeping on the
-- record rather than only in the call log: it tells the desk which language to call back
-- in, and it is the honest label on values that were translated rather than transcribed.
alter table public.real_records
  add column if not exists source_language text
    check (source_language in ('en','ta','mixed','unknown'));

create index if not exists real_records_details_idx
  on public.real_records using gin (request_details);

-- Frequently filtered on their own, so they get expression indexes rather than relying on
-- the GIN index for every lookup.
create index if not exists real_records_cargo_type_idx
  on public.real_records ((request_details->>'cargo_type'));

create index if not exists real_records_incoterm_idx
  on public.real_records ((request_details->>'incoterm'));

-- ---------------------------------------------------------------- reading it flat
--
-- The columns some consumers want without learning the JSON operators. A view, not a
-- table: there is exactly one copy of the data and it cannot drift.

create or replace view public.request_fields as
select
  ref,
  phone,
  customer_name,
  company,
  stage,
  status,
  source_language,
  request_details->>'origin'                              as origin,
  request_details->>'destination'                         as destination,
  request_details->>'cargo_description'                   as cargo_description,
  request_details->>'cargo_type'                          as cargo_type,
  (request_details->>'piece_length_cm')::numeric          as piece_length_cm,
  (request_details->>'piece_width_cm')::numeric           as piece_width_cm,
  (request_details->>'piece_height_cm')::numeric          as piece_height_cm,
  (request_details->>'piece_count')::numeric              as piece_count,
  (request_details->>'weight_per_piece_kg')::numeric      as weight_per_piece_kg,
  (request_details->>'total_gross_weight_kg')::numeric    as total_gross_weight_kg,
  (request_details->>'volume_cbm')::numeric               as volume_cbm,
  (request_details->>'stackable')::boolean                as stackable,
  (request_details->>'upright_only')::boolean             as upright_only,
  request_details->>'preferred_sailing_date'              as preferred_sailing_date,
  request_details->>'container_type'                      as container_type,
  (request_details->>'target_price_inr')::numeric         as target_price_inr,
  request_details->>'shipper_legal_name'                  as shipper_legal_name,
  request_details->>'shipper_gstin_iec'                   as shipper_gstin_iec,
  request_details->>'consignee_name'                      as consignee_name,
  request_details->>'consignee_address'                   as consignee_address,
  request_details->>'consignee_country'                   as consignee_country,
  request_details->>'hs_code'                             as hs_code,
  (request_details->>'invoice_value_inr')::numeric        as invoice_value_inr,
  (request_details->>'package_count')::numeric            as package_count,
  request_details->>'package_type'                        as package_type,
  (request_details->>'net_weight_kg')::numeric            as net_weight_kg,
  (request_details->>'gross_weight_kg')::numeric          as gross_weight_kg,
  request_details->>'incoterm'                            as incoterm,
  request_details->>'payment_terms'                       as payment_terms,
  (request_details->>'letter_of_credit')::boolean         as letter_of_credit,
  (request_details->>'msds_provided')::boolean            as msds_provided,
  request_details->>'un_packaging_spec'                   as un_packaging_spec,
  request_details->>'carrier_dg_approval'                 as carrier_dg_approval,
  (request_details->>'temperature_setpoint_c')::numeric   as temperature_setpoint_c,
  (request_details->>'pre_cooling_required')::boolean     as pre_cooling_required,
  (request_details->>'wood_packaging_used')::boolean      as wood_packaging_used,
  updated_at
from public.real_records;

-- The view inherits real_records' RLS, which has no public policies — reachable only
-- through the backend's service_role key, same as the table it reads.
alter view public.request_fields set (security_invoker = on);
