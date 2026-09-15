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

/**
 * An enquiry, before anything is booked.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ENQUIRY CAN ISSUE A DOCUMENT AT ALL
 *
 * One of them: the quotation. It is the rate offered to the customer, and it is
 * produced before a booking exists by definition — a customer accepts a
 * quotation and that acceptance is what creates the booking.
 *
 * Everything after it needs particulars an enquiry does not have, so the rest
 * of the list sits there as drafts naming what they are waiting for. That is
 * useful rather than noise: it is the desk's checklist of what still has to be
 * agreed before this shipment can move.
 *
 * WHERE THE RATE COMES FROM
 *
 * The quote the desk has issued, passed in — not a partner's rate. Those are
 * buying prices and putting one on a customer's quotation would send the agent's
 * cost to the shipper. The two are deliberately not interchangeable and this
 * function takes only the selling figure.
 * ---------------------------------------------------------------------------
 */
export function documentDataFromEnquiry(
  e: {
    ref: string;
    origin: string | null;
    destination: string | null;
    cargo: string | null;
    cargo_type: string | null;
    incoterm: string | null;
    ready_date: string | null;
    piece_count: number | null;
    piece_length_cm: number | null;
    piece_width_cm: number | null;
    piece_height_cm: number | null;
    gross_weight_kg: number | null;
    volume_cbm: number | null;
    stackable: boolean | null;
    upright_only: boolean | null;
    consignee_name: string | null;
    consignee_country: string | null;
  },
  customer?: { name?: string | null; company?: string | null; phone?: string | null } | null,
  /** The rate this desk has quoted the customer, if one has been issued. */
  quotedInr?: number | null
): DocumentData {
  const un = <T,>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

  const l = un(e.piece_length_cm);
  const w = un(e.piece_width_cm);
  const h = un(e.piece_height_cm);

  return {
    // The enquiry ref already starts with ARX-, and the renderer prefixes its
    // own — leaving it in produces ARX-QUO-ARX-C0001-E02.
    reference: e.ref,
    documentNumber: e.ref.replace(/^ARX-/, ""),

    shipperName: un(customer?.company) || un(customer?.name),
    customerName: un(customer?.name),
    company: un(customer?.company),
    phone: un(customer?.phone),
    consigneeName: un(e.consignee_name),
    consigneeCountry: un(e.consignee_country) || un(e.destination),

    origin: un(e.origin),
    destination: un(e.destination),
    sailingDate: un(e.ready_date),

    cargoDescription: un(e.cargo),
    cargoType: un(e.cargo_type),
    pieceCount: un(e.piece_count),
    pieceDimensions: l && w && h ? `${l} x ${w} x ${h} cm` : undefined,
    grossWeightKg: un(e.gross_weight_kg),
    volumeCbm: un(e.volume_cbm),
    stackable: un(e.stackable),
    uprightOnly: un(e.upright_only),

    freightAmountInr: un(quotedInr),
    incoterm: un(e.incoterm),

    sourceNote: `From enquiry ${e.ref}.`,
    raw: {} as RequestDetails,
  };
}

/**
 * A real booking, from the shipments table.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE documentDataFromShipment
 *
 * That one maps the LEGACY mock shipment — the shape with blNumber, company and
 * callExtraction on it, which came from the demo data that has since been
 * deleted. Nothing produces that shape any more.
 *
 * This maps the row the database actually holds. The two are kept apart rather
 * than merged because their field names differ almost everywhere and a single
 * function taking a union would be a pile of `in` checks pretending to be one
 * mapping.
 *
 * WHAT HAPPENS WHEN A FIELD IS STILL EMPTY
 *
 * It comes through undefined and the readiness check reports that document as a
 * draft naming exactly what it needs. That is the correct answer rather than a
 * shortcoming: a bill of lading cannot be issued final off a booking that has
 * never been told who the consignee is, and filling the field with a blank
 * would produce a document that looks complete and is not.
 *
 * Until 028 that state was permanent — the shipments table had no consignee,
 * packing or invoice columns at all, so nine of the twelve documents could
 * never be issued however complete the booking was. The columns exist now; an
 * empty one means nobody has filled it in yet.
 * ---------------------------------------------------------------------------
 */
export function documentDataFromBooking(
  s: {
    id: string;
    enquiry_ref: string;
    origin: string | null;
    destination: string | null;
    cargo: string | null;
    piece_count: number | null;
    volume_cbm: number | null;
    gross_weight_kg: number | null;
    agreed_inr: number | null;
    sailing_date: string | null;
    carrier: string | null;
    booking_number: string | null;
    container_number: string | null;
    bl_number: string | null;
    vessel: string | null;
    etd: string | null;
    eta: string | null;
    container_type?: string | null;
    consignee_name?: string | null;
    consignee_address?: string | null;
    consignee_country?: string | null;
    shipper_name?: string | null;
    shipper_gstin_iec?: string | null;
    package_count?: number | null;
    package_type?: string | null;
    hs_code?: string | null;
    net_weight_kg?: number | null;
    invoice_value_inr?: number | null;
    incoterm?: string | null;
    payment_terms?: string | null;
    letter_of_credit?: boolean | null;
  },
  customer?: { name?: string | null; company?: string | null; phone?: string | null } | null
): DocumentData {
  const un = <T,>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

  return {
    // The B/L number once there is one, and the booking's own id until then —
    // a document has to be numbered even while it is a draft.
    reference: s.bl_number || s.id,
    documentNumber: s.bl_number || s.id,
    blNumber: un(s.bl_number),

    // The booking's own shipper wins over the customer record: they are usually
    // the same and occasionally not, and the booking is the later statement.
    shipperName: un(s.shipper_name) || un(customer?.company) || un(customer?.name),
    shipperGstinIec: un(s.shipper_gstin_iec),
    customerName: un(customer?.name),
    company: un(customer?.company),
    phone: un(customer?.phone),

    consigneeName: un(s.consignee_name),
    consigneeAddress: un(s.consignee_address),
    consigneeCountry: un(s.consignee_country) || un(s.destination),

    origin: un(s.origin),
    destination: un(s.destination),
    carrier: un(s.carrier),
    containerId: un(s.container_number),
    containerType: un(s.container_type),
    sailingDate: un(s.sailing_date) || un(s.etd),
    etaDate: un(s.eta),

    cargoDescription: un(s.cargo),
    hsCode: un(s.hs_code),
    pieceCount: un(s.piece_count),
    packageCount: un(s.package_count),
    packageType: un(s.package_type),
    netWeightKg: un(s.net_weight_kg),
    grossWeightKg: un(s.gross_weight_kg),
    volumeCbm: un(s.volume_cbm),

    invoiceValueInr: un(s.invoice_value_inr) ?? un(s.agreed_inr),
    freightAmountInr: un(s.agreed_inr),
    incoterm: un(s.incoterm),
    paymentTerms: un(s.payment_terms),
    letterOfCredit: un(s.letter_of_credit),

    sourceNote: `From booking ${s.id} against enquiry ${s.enquiry_ref}.`,
    raw: {} as RequestDetails,
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
    containerType: shipment.callExtraction?.containerTypeRequested,
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
    incoterm: dg?.incoterm,
    paymentTerms: dg?.paymentTerms,
    letterOfCredit: dg?.letterOfCredit,

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
