export interface ContainerSpec {
  code: string; // "20GP" | "40GP" | "40HC" | "20RF" | "40RF" | "LCL"
  name: string;
  internalDimsM: { length: number; width: number; height: number } | null;
  capacityCbm: number | null; // null for LCL — shared space, priced per unit
  maxPayloadKg: number | null;
  tareWeightKg: number | null;
  tempRangeC?: { min: number; max: number };
  useCase: string;
}

export interface Surcharge {
  label: string;
  amountInr: number;
  basis: "flat" | "pct_of_base";
}

export interface FreightRate {
  id: string;
  origin: string;
  destination: string;
  containerCode: string; // matches ContainerSpec.code
  baseRateInr: number; // per CBM if LCL, flat per container otherwise
  unit: "per_cbm" | "per_container";
  minChargeCbm?: number; // LCL minimum billable volume
  transitDays: number;
  surcharges: Surcharge[];
  negotiationFloorPct: number; // max discount off base+surcharges, e.g. -12
  negotiationCeilingPct: number; // max markup allowed before escalation, e.g. 0
  validUntil: string;
}

export interface RequiredDocument {
  name: string;
  mandatory: boolean;
  notes?: string;
}

export interface CargoType {
  code: string;
  name: string;
  description: string;
  requiredDocuments: RequiredDocument[];
  packagingRequirements?: string;
  specialHandling?: string;
  exampleCommodities: string[];
}

export interface DestinationRegulation {
  country: string;
  port: string;
  freeDays: number;
  detentionRateInrPerDay: number;
  demurrageRateInrPerDay: number;
  certificateRequirements: string[];
  customsNotes: string[];
  restrictedGoodsNotes?: string;
}

/**
 * A bookable sailing. Space is tracked in real dimensions (floor length consumed and
 * payload used against a specific container's internal envelope), not as a CBM number,
 * because CBM alone cannot answer "will my 2.6m-tall crate fit".
 */
export interface SailingSlot {
  id: string;
  route: string; // e.g. "Chennai -> Jebel Ali, Dubai"
  carrier: string;
  sailingDate: string; // ISO date, when the vessel departs
  cutoffDate: string; // last date to confirm booking for this sailing
  /** Which container spec this slot's space lives in — matches ContainerSpec.code. */
  containerCode: string;
  /** LCL = shared groupage container; FCL = the whole box goes to one customer. */
  mode: "LCL" | "FCL";
  /** Metres of container floor already consumed by existing bookings. */
  usedLengthM: number;
  /** Kilograms of payload already consumed by existing bookings. */
  usedWeightKg: number;
  status: "open" | "closing_soon" | "full";
}

export type KbCategory =
  | "container_specs"
  | "pricing"
  | "documents_by_cargo"
  | "destination_regulations"
  | "space_availability";

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: KbCategory;
  lastUpdated: string;
  summary: string;
}
