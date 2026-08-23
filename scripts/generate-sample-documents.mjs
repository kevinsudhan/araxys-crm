/**
 * Generates every document in the registry for one fully-populated shipment.
 *
 *   node scripts/generate-sample-documents.mjs [outDir]
 *
 * Exists because "all twelve documents work" is a claim, and a folder of twelve PDFs a
 * human can open is evidence. Every field this shipment needs is filled in, so each
 * document renders in its ISSUED form rather than as a draft — which is the half that a
 * real record cannot show yet, since no customer has got far enough to supply a GSTIN.
 *
 * The data is deliberately fictional but internally consistent: the weights agree with
 * the piece count, the volume agrees with the carton dimensions, the HS code matches the
 * cargo, and the Incoterm matches who is paying freight. A sample with numbers that
 * contradict each other teaches the reader nothing about whether the documents are right.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DOCUMENTS } from "../src/lib/documents/index.ts";
import { documentDataFromRecord } from "../src/lib/documents/data.ts";
import { readiness } from "../src/lib/documents/data.ts";
import { renderDocument } from "../src/lib/documents/render.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] ? join(root, process.argv[2]) : join(root, "sample-documents");
mkdirSync(outDir, { recursive: true });

/**
 * 480 cartons of cotton bed linen, Chennai to Jebel Ali.
 *
 * 480 x 18 kg = 8,640 kg gross, and 480 x (60 x 40 x 35 cm) = 40.32 CBM, which is a
 * credible load for a 40HC. Net is 8,200 kg — the 440 kg difference is the cartons and
 * pallets themselves, which is why ISPM-15 applies.
 */
const SHIPMENT = {
  ref: "ARX-ENQ-9001",
  phone: "+919840112233",
  blNumber: "MSCU7845120",
  stage: "processing",
  status: "booked",
  customerName: "Meera Raghavan",
  company: "Kavitha Textiles",
  origin: "Chennai",
  destination: "Jebel Ali",
  containerType: "40HC",
  volumeCbm: 40.32,
  quotedAmountInr: 195000,
  agreedAmountInr: 185000,
  sailingDate: "2026-09-05",
  sourceLanguage: "ta",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",

  requestDetails: {
    // booking
    customer_name: "Meera Raghavan",
    company: "Kavitha Textiles",
    origin: "Chennai",
    destination: "Jebel Ali",
    cargo_description: "Cotton bed linen sets",
    cargo_type: "textiles_garments",
    piece_length_cm: 60,
    piece_width_cm: 40,
    piece_height_cm: 35,
    piece_count: 480,
    weight_per_piece_kg: 18,
    total_gross_weight_kg: 8640,
    volume_cbm: 40.32,
    stackable: true,
    upright_only: false,
    preferred_sailing_date: "2026-09-05",
    container_type: "40HC",
    target_price_inr: 180000,

    // documentation
    shipper_legal_name: "Kavitha Textiles Private Limited",
    shipper_gstin_iec: "33AAGCK4521M1Z8",
    consignee_name: "Al Noor Trading LLC",
    consignee_address: "Warehouse 12, Jebel Ali Free Zone, Dubai",
    consignee_country: "United Arab Emirates",
    hs_code: "6302.31",
    invoice_value_inr: 4250000,
    package_count: 480,
    package_type: "cartons",
    net_weight_kg: 8200,
    gross_weight_kg: 8640,
    incoterm: "FOB",
    payment_terms: "30 days from bill of lading date",
    letter_of_credit: false,

    // handling — wooden pallets are what pull ISPM-15 into scope
    wood_packaging_used: true,
  },
};

const data = documentDataFromRecord(SHIPMENT);
// Carrier-side facts arrive from the booking, not from a phone call, so they are set here
// rather than invented by the extractor.
data.carrier = "MSC";
data.containerId = "MSCU7845120";
data.etaDate = "2026-09-18";

console.log(`sample shipment ${SHIPMENT.ref} — ${SHIPMENT.company}, ${data.origin} to ${data.destination}\n`);

let ready = 0;
for (const spec of DOCUMENTS) {
  const r = readiness(data, spec.requires);
  const pdf = renderDocument(spec, data);
  const file = join(outDir, `${String(DOCUMENTS.indexOf(spec) + 1).padStart(2, "0")}-${spec.id}.pdf`);
  writeFileSync(file, Buffer.from(pdf.output("arraybuffer")));
  if (r.ready) ready++;
  console.log(
    `  ${r.ready ? "ISSUED" : "DRAFT "}  ${spec.shortName.padEnd(34)} ${String(r.have)}/${r.need}` +
      (r.ready ? "" : `  missing: ${r.missingLabels.join(", ")}`)
  );
}

console.log(`\n${ready}/${DOCUMENTS.length} issued -> ${outDir}`);
