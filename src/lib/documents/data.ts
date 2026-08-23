import type { Shipment } from "../../types";
import type { RealRecord } from "../../services/backend";
import { fieldDef, type RequestDetails } from "../../data/requestFields";
import type { DataKey, DocumentData } from "./types";

/**
 * Builds the one shape every document draws from.
 *
 * NO FALLBACKS ON A FIELD ANY DOCUMENT REQUIRES. A booking-stage value must never stand
 * in for a documentation one, however interchangeable they look — substituting the
 * trading name for the shipper's legal name, or the piece count for the package count,
 * produces a document that prints a value for a field it also lists as outstanding, and
 * a reader cannot tell which half to believe. Booking values fill only the fields no
 * document requires.
 */

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Human labels for the outstanding list. Catalogue fields keep the catalogue's wording. */
const LOCAL_LABELS: Partial<Record<DataKey, string>> = {
  blNumber: "Bill of lading number",
  customerName: "Contact name",
  company: "Company",
  phone: "Phone",
  carrier: "Carrier",
  containerId: "Container number",
  etaDate: "ETA date",
  pieceDimensions: "Piece dimensions",
  freightAmountInr: "Agreed freight rate",
  cargoType: "Cargo type",
  containerType: "Container type",
  sailingDate: "Sailing date",
  origin: "Origin",
  destination: "Destination",
  cargoDescription: "Cargo description",
  pieceCount: "Number of pieces",
  volumeCbm: "Volume",
  stackable: "Stackable",
  uprightOnly: "Must stay upright",
  targetPriceInr: "Target price",
};

/**
 * The catalogue owns the wording wherever a document field maps to a collected one, so
 * the label on an invoice matches the label on the CRM grid the desk is reading from.
 */
const CATALOGUE_KEY: Partial<Record<DataKey, string>> = {
  shipperName: "shipper_legal_name",
  shipperGstinIec: "shipper_gstin_iec",
  consigneeName: "consignee_name",
  consigneeAddress: "consignee_address",
  consigneeCountry: "consignee_country",
  hsCode: "hs_code",
  invoiceValueInr: "invoice_value_inr",
  packageCount: "package_count",
  packageType: "package_type",
  netWeightKg: "net_weight_kg",
  grossWeightKg: "gross_weight_kg",
  incoterm: "incoterm",
  paymentTerms: "payment_terms",
  letterOfCredit: "letter_of_credit",
  temperatureSetpointC: "temperature_setpoint_c",
  preCoolingRequired: "pre_cooling_required",
  woodPackagingUsed: "wood_packaging_used",
  msdsProvided: "msds_provided",
  unPackagingSpec: "un_packaging_spec",
  carrierDgApproval: "carrier_dg_approval",
};

export function labelFor(key: DataKey): string {
  const catKey = CATALOGUE_KEY[key];
  if (catKey) {
    const def = fieldDef(catKey);
    if (def) return def.label;
  }
  return LOCAL_LABELS[key] ?? key;
}

/** Dimensions read as a single line on a document, not three rows. */
function dimensions(d: RequestDetails): string | undefined {
  const l = num(d.piece_length_cm);
  const w = num(d.piece_width_cm);
  const h = num(d.piece_height_cm);
  return l && w && h ? `${l} x ${w} x ${h} cm` : undefined;
}

export function documentDataFromRecord(record: RealRecord): DocumentData {
  const d: RequestDetails = record.requestDetails ?? {};

  return {
    reference: record.blNumber ?? record.ref,
    // The stem only. The renderer builds ARX-<prefix>-<stem>, and the enquiry ref already
    // starts with ARX- — leaving it in produces ARX-VGM-ARX-ENQ-0003.
    documentNumber: record.ref.replace(/^ARX-/, ""),
    blNumber: record.blNumber,

    shipperName: str(d.shipper_legal_name),
    shipperGstinIec: str(d.shipper_gstin_iec),
    consigneeName: str(d.consignee_name),
    consigneeAddress: str(d.consignee_address),
    consigneeCountry: str(d.consignee_country),

    customerName: str(d.customer_name) ?? record.customerName,
    company: str(d.company) ?? record.company,
    phone: record.phone,

    origin: str(d.origin) ?? record.origin,
    destination: str(d.destination) ?? record.destination,
    containerType: str(d.container_type) ?? record.containerType,
    sailingDate: str(d.preferred_sailing_date) ?? record.sailingDate,

    cargoDescription: str(d.cargo_description) ?? record.cargoDescription,
    cargoType: str(d.cargo_type),
    hsCode: str(d.hs_code),
    pieceCount: num(d.piece_count),
    pieceDimensions: dimensions(d),
    packageCount: num(d.package_count),
    packageType: str(d.package_type),
    netWeightKg: num(d.net_weight_kg),
    grossWeightKg: num(d.gross_weight_kg),
    volumeCbm: num(d.volume_cbm) ?? record.volumeCbm,
    stackable: bool(d.stackable),
    uprightOnly: bool(d.upright_only),

    invoiceValueInr: num(d.invoice_value_inr),
    freightAmountInr: record.agreedAmountInr ?? record.quotedAmountInr,
    targetPriceInr: num(d.target_price_inr),
    incoterm: str(d.incoterm),
    paymentTerms: str(d.payment_terms),
    letterOfCredit: bool(d.letter_of_credit),

    temperatureSetpointC: num(d.temperature_setpoint_c),
    preCoolingRequired: bool(d.pre_cooling_required),
    woodPackagingUsed: bool(d.wood_packaging_used),
    msdsProvided: bool(d.msds_provided),
    unPackagingSpec: str(d.un_packaging_spec),
    carrierDgApproval: str(d.carrier_dg_approval),

    sourceNote: "Fields extracted from this customer's call transcripts.",
    raw: d,
  };
}

/** The seeded-shipment path, so the existing shipment pages keep working unchanged. */
export function documentDataFromShipment(shipment: Shipment): DocumentData {
  const dg = shipment.docGenDetails;

  return {
    reference: shipment.blNumber,
    documentNumber: shipment.blNumber,
    blNumber: shipment.blNumber,

    shipperName: dg?.shipperName ?? shipment.company,
    shipperGstinIec: dg?.shipperGstinIec,
    consigneeName: dg?.consigneeName,
    consigneeAddress: dg?.consigneeAddress,
    consigneeCountry: dg?.consigneeCountry ?? shipment.destination,

    company: shipment.company,

    origin: shipment.origin,
    destination: shipment.destination,
    carrier: shipment.carrier,
    containerId: shipment.containerId,
    etaDate: shipment.etaDate,
    sailingDate: shipment.etaDate,

    cargoDescription: shipment.callExtraction?.cargoDescription,
    hsCode: dg?.hsCode,
    packageCount: dg?.packageCount,
    packageType: dg?.packageType,
    netWeightKg: dg?.netWeightKg,
    grossWeightKg: dg?.grossWeightKg,
    volumeCbm: shipment.callExtraction?.volumeCbm,

    invoiceValueInr: dg?.invoiceValueInr ?? (shipment.quoteAmount || undefined),
    freightAmountInr: shipment.quoteAmount || undefined,

    sourceNote: "Generated from confirmed call and shipment data.",
    raw: {},
  };
}

/** Which of a document's required fields are still outstanding. */
export function readiness(data: DocumentData, requires: DataKey[]) {
  const missing = requires.filter((k) => {
    const v = data[k];
    return v === undefined || v === null || v === "";
  });
  return {
    ready: missing.length === 0,
    missing,
    missingLabels: missing.map(labelFor),
    have: requires.length - missing.length,
    need: requires.length,
  };
}
