import type {
  ContainerSpec,
  FreightRate,
  CargoType,
  DestinationRegulation,
  KnowledgeDoc,
  SailingSlot,
} from "../types/knowledgeBase";

export const containerSpecs: ContainerSpec[] = [
  {
    code: "20GP",
    name: "20ft standard (dry van)",
    internalDimsM: { length: 5.9, width: 2.35, height: 2.39 },
    capacityCbm: 33.2,
    maxPayloadKg: 28180,
    tareWeightKg: 2300,
    useCase: "General dry cargo, dense/heavy loads (machinery, tiles, spices in bags)",
  },
  {
    code: "40GP",
    name: "40ft standard (dry van)",
    internalDimsM: { length: 12.03, width: 2.35, height: 2.39 },
    capacityCbm: 67.6,
    maxPayloadKg: 26700,
    tareWeightKg: 3750,
    useCase: "General dry cargo, high volume / low density (garments, cartons)",
  },
  {
    code: "40HC",
    name: "40ft high cube",
    internalDimsM: { length: 12.03, width: 2.35, height: 2.69 },
    capacityCbm: 76.3,
    maxPayloadKg: 28600,
    tareWeightKg: 3900,
    useCase: "Bulky light cargo needing extra height (furniture, textiles)",
  },
  {
    code: "20RF",
    name: "20ft reefer",
    internalDimsM: { length: 5.44, width: 2.29, height: 2.27 },
    capacityCbm: 28.3,
    maxPayloadKg: 27400,
    tareWeightKg: 3080,
    tempRangeC: { min: -25, max: 25 },
    useCase: "Temperature-controlled cargo — marine/seafood, dairy, pharma",
  },
  {
    code: "40RF",
    name: "40ft high cube reefer",
    internalDimsM: { length: 11.56, width: 2.29, height: 2.5 },
    capacityCbm: 59.3,
    maxPayloadKg: 29000,
    tareWeightKg: 4800,
    tempRangeC: { min: -25, max: 25 },
    useCase: "Temperature-controlled cargo, larger volume",
  },
  {
    code: "LCL",
    name: "LCL (shared container / groupage)",
    internalDimsM: null,
    capacityCbm: null,
    maxPayloadKg: null,
    tareWeightKg: null,
    useCase: "Below-container-load cargo, priced per CBM or revenue ton, consolidated with other shippers",
  },
];

export const freightRates: FreightRate[] = [
  // Chennai -> Jebel Ali, Dubai
  { id: "fr-1", origin: "Chennai", destination: "Jebel Ali, Dubai", containerCode: "LCL", baseRateInr: 1550, unit: "per_cbm", minChargeCbm: 5, transitDays: 6, negotiationFloorPct: -10, negotiationCeilingPct: 5,
    surcharges: [
      { label: "THC origin", amountInr: 3200, basis: "flat" },
      { label: "THC destination", amountInr: 4500, basis: "flat" },
      { label: "BAF (bunker adjustment)", amountInr: 8, basis: "pct_of_base" },
      { label: "Documentation fee", amountInr: 1200, basis: "flat" },
    ],
    validUntil: "2026-09-30" },
  { id: "fr-2", origin: "Chennai", destination: "Jebel Ali, Dubai", containerCode: "20GP", baseRateInr: 42000, unit: "per_container", transitDays: 6, negotiationFloorPct: -12, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 3200, basis: "flat" }, { label: "THC destination", amountInr: 4500, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },
  { id: "fr-3", origin: "Chennai", destination: "Jebel Ali, Dubai", containerCode: "40GP", baseRateInr: 68000, unit: "per_container", transitDays: 6, negotiationFloorPct: -12, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 3200, basis: "flat" }, { label: "THC destination", amountInr: 4500, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },

  // Tuticorin -> Colombo
  { id: "fr-4", origin: "Tuticorin", destination: "Colombo", containerCode: "LCL", baseRateInr: 780, unit: "per_cbm", minChargeCbm: 3, transitDays: 2, negotiationFloorPct: -8, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 2600, basis: "flat" }, { label: "THC destination", amountInr: 2800, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },
  { id: "fr-5", origin: "Tuticorin", destination: "Colombo", containerCode: "20GP", baseRateInr: 21000, unit: "per_container", transitDays: 2, negotiationFloorPct: -10, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 2600, basis: "flat" }, { label: "THC destination", amountInr: 2800, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },

  // Chennai -> Singapore
  { id: "fr-6", origin: "Chennai", destination: "Singapore", containerCode: "LCL", baseRateInr: 1050, unit: "per_cbm", minChargeCbm: 4, transitDays: 4, negotiationFloorPct: -10, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 3200, basis: "flat" }, { label: "THC destination", amountInr: 3600, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },
  { id: "fr-7", origin: "Chennai", destination: "Singapore", containerCode: "20GP", baseRateInr: 29000, unit: "per_container", transitDays: 4, negotiationFloorPct: -12, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 3200, basis: "flat" }, { label: "THC destination", amountInr: 3600, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },

  // Tuticorin -> Jeddah
  { id: "fr-8", origin: "Tuticorin", destination: "Jeddah", containerCode: "LCL", baseRateInr: 1850, unit: "per_cbm", minChargeCbm: 6, transitDays: 12, negotiationFloorPct: -8, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 2600, basis: "flat" }, { label: "THC destination", amountInr: 5200, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },
  { id: "fr-9", origin: "Tuticorin", destination: "Jeddah", containerCode: "40GP", baseRateInr: 92000, unit: "per_container", transitDays: 12, negotiationFloorPct: -10, negotiationCeilingPct: 5,
    surcharges: [{ label: "THC origin", amountInr: 2600, basis: "flat" }, { label: "THC destination", amountInr: 5200, basis: "flat" }, { label: "Documentation fee", amountInr: 1200, basis: "flat" }],
    validUntil: "2026-09-30" },
];

export const cargoTypes: CargoType[] = [
  {
    code: "general_dry",
    name: "General dry cargo",
    description: "Non-perishable, non-hazardous goods — the default cargo profile.",
    exampleCommodities: ["Machinery parts", "Granite tiles", "Furniture", "Packaged consumer goods"],
    requiredDocuments: [
      { name: "Commercial invoice", mandatory: true },
      { name: "Packing list", mandatory: true },
      { name: "Bill of lading", mandatory: true },
      { name: "Shipping bill (export declaration, via ICEGATE)", mandatory: true },
      { name: "Certificate of origin", mandatory: false, notes: "Only if claiming preferential tariff under an FTA" },
    ],
  },
  {
    code: "textiles_garments",
    name: "Textiles & garments",
    description: "Apparel, fabric rolls, and made-up textile goods.",
    exampleCommodities: ["Ready-made garments", "Fabric rolls", "Home textiles"],
    requiredDocuments: [
      { name: "Commercial invoice", mandatory: true },
      { name: "Packing list", mandatory: true },
      { name: "Bill of lading", mandatory: true },
      { name: "Certificate of origin", mandatory: true, notes: "Required for GSP/FTA duty benefit at most destinations" },
      { name: "Textile testing certificate", mandatory: false, notes: "Some destinations require azo-dye / flammability testing" },
    ],
  },
  {
    code: "perishable_food",
    name: "Perishable & food cargo",
    description: "Marine products, dairy, spices, and other food items requiring temperature or hygiene controls.",
    exampleCommodities: ["Frozen seafood", "Dairy", "Spices", "Processed foods"],
    packagingRequirements: "ISPM-15 compliant wood packaging (fumigated/heat-treated) or non-wood pallets.",
    specialHandling: "Reefer container with continuous temperature logging; pre-cooling before loading.",
    requiredDocuments: [
      { name: "Commercial invoice", mandatory: true },
      { name: "Packing list", mandatory: true },
      { name: "Bill of lading", mandatory: true },
      { name: "Phytosanitary certificate", mandatory: true, notes: "Issued by Plant Quarantine (for plant-origin goods)" },
      { name: "Health certificate", mandatory: true, notes: "For animal-origin / marine products" },
      { name: "Fumigation certificate", mandatory: true, notes: "Required if wood packaging is used" },
      { name: "FSSAI export clearance", mandatory: true },
    ],
  },
  {
    code: "hazardous_dg",
    name: "Hazardous / dangerous goods",
    description: "Chemicals, batteries, and other IMDG-classified cargo.",
    exampleCommodities: ["Industrial chemicals", "Lithium batteries", "Paints and solvents"],
    packagingRequirements: "UN-certified packaging matching the IMDG class and packing group.",
    specialHandling: "Requires carrier DG approval before booking; cannot be consolidated with incompatible DG classes.",
    requiredDocuments: [
      { name: "Commercial invoice", mandatory: true },
      { name: "Packing list", mandatory: true },
      { name: "Bill of lading", mandatory: true },
      { name: "IMO Dangerous Goods Declaration", mandatory: true },
      { name: "Material Safety Data Sheet (MSDS)", mandatory: true },
      { name: "UN packaging certification", mandatory: true },
      { name: "Carrier DG acceptance approval", mandatory: true, notes: "Must be obtained before space is booked" },
    ],
  },
  {
    code: "electronics",
    name: "Electronics & appliances",
    description: "Consumer and industrial electronics, including battery-powered devices.",
    exampleCommodities: ["Consumer electronics", "Industrial equipment", "Battery-powered devices"],
    requiredDocuments: [
      { name: "Commercial invoice", mandatory: true },
      { name: "Packing list", mandatory: true },
      { name: "Bill of lading", mandatory: true },
      { name: "BIS / compliance certificate", mandatory: false, notes: "Depends on destination product-safety regime" },
      { name: "Lithium battery DG documentation", mandatory: false, notes: "Required only if the shipment contains lithium batteries" },
    ],
  },
  {
    code: "agri_grain",
    name: "Agricultural bulk & grain",
    description: "Rice, grains, and other bulk agricultural exports.",
    exampleCommodities: ["Rice", "Wheat", "Pulses", "Oilseeds"],
    packagingRequirements: "Food-grade bags; non-wood pallets or ISPM-15 treated wood.",
    requiredDocuments: [
      { name: "Commercial invoice", mandatory: true },
      { name: "Packing list", mandatory: true },
      { name: "Bill of lading", mandatory: true },
      { name: "Phytosanitary certificate", mandatory: true },
      { name: "Fumigation certificate", mandatory: true },
      { name: "FSSAI export clearance", mandatory: true },
    ],
  },
];

export const destinationRegulations: DestinationRegulation[] = [
  {
    country: "United Arab Emirates",
    port: "Jebel Ali",
    freeDays: 5,
    detentionRateInrPerDay: 3400,
    demurrageRateInrPerDay: 3800,
    certificateRequirements: ["Certificate of origin (attested by chamber of commerce for high-value goods)", "Halal certification for food products"],
    customsNotes: ["Detailed invoice with correct HS codes is mandatory", "Import declaration filed by consignee's UAE customs broker"],
  },
  {
    country: "Sri Lanka",
    port: "Colombo",
    freeDays: 7,
    detentionRateInrPerDay: 2970,
    demurrageRateInrPerDay: 3100,
    certificateRequirements: ["Import license for restricted-goods categories", "Certificate of origin for SAFTA preferential duty"],
    customsNotes: ["Exchange control declaration required for payments over threshold"],
  },
  {
    country: "Singapore",
    port: "Singapore",
    freeDays: 4,
    detentionRateInrPerDay: 3600,
    demurrageRateInrPerDay: 4000,
    certificateRequirements: ["Certificate of origin only if claiming FTA preference"],
    customsNotes: ["Correct HS classification is strictly enforced", "Free trade zone transshipment generally simplifies clearance"],
    restrictedGoodsNotes: "Chewing gum, e-cigarettes, and certain telecom equipment are restricted or banned.",
  },
  {
    country: "Saudi Arabia",
    port: "Jeddah",
    freeDays: 3,
    detentionRateInrPerDay: 3900,
    demurrageRateInrPerDay: 4000,
    certificateRequirements: [
      "SASO conformity certificate for most regulated products",
      "Halal certification for food products",
      "Certificate of origin, legalized/attested via chamber of commerce and Saudi embassy",
    ],
    customsNotes: ["Saber platform registration required before shipment for many product categories"],
  },
];

/**
 * DUMMY DATA — placeholder sailing schedule, not a live feed.
 * Real version (per brief §10 Track C) queries actual carrier/space-management
 * software through an agent tool (HTTP webhook) invoked mid-call, not static text.
 */
export const sailingSlots: SailingSlot[] = [
  // Chennai -> Jebel Ali (MSC). 40GP internal length 12.03m, 20GP 5.9m.
  { id: "sl-1", route: "Chennai -> Jebel Ali, Dubai", carrier: "MSC", sailingDate: "2026-08-20", cutoffDate: "2026-08-18", containerCode: "40GP", mode: "LCL", usedLengthM: 7.6, usedWeightKg: 9400, status: "open" },
  { id: "sl-2", route: "Chennai -> Jebel Ali, Dubai", carrier: "MSC", sailingDate: "2026-08-24", cutoffDate: "2026-08-22", containerCode: "20GP", mode: "LCL", usedLengthM: 5.2, usedWeightKg: 14800, status: "closing_soon" },
  { id: "sl-3", route: "Chennai -> Jebel Ali, Dubai", carrier: "MSC", sailingDate: "2026-08-28", cutoffDate: "2026-08-26", containerCode: "40HC", mode: "LCL", usedLengthM: 4.1, usedWeightKg: 5200, status: "open" },

  // Tuticorin -> Colombo (CMA CGM)
  { id: "sl-4", route: "Tuticorin -> Colombo", carrier: "CMA CGM", sailingDate: "2026-08-20", cutoffDate: "2026-08-19", containerCode: "20GP", mode: "LCL", usedLengthM: 5.9, usedWeightKg: 21000, status: "full" },
  { id: "sl-5", route: "Tuticorin -> Colombo", carrier: "CMA CGM", sailingDate: "2026-08-21", cutoffDate: "2026-08-20", containerCode: "40GP", mode: "LCL", usedLengthM: 3.4, usedWeightKg: 4100, status: "open" },
  { id: "sl-6", route: "Tuticorin -> Colombo", carrier: "CMA CGM", sailingDate: "2026-08-23", cutoffDate: "2026-08-22", containerCode: "20GP", mode: "LCL", usedLengthM: 1.2, usedWeightKg: 2600, status: "open" },

  // Chennai -> Singapore (MSC)
  { id: "sl-7", route: "Chennai -> Singapore", carrier: "MSC", sailingDate: "2026-08-20", cutoffDate: "2026-08-19", containerCode: "40HC", mode: "LCL", usedLengthM: 2.8, usedWeightKg: 3300, status: "open" },
  { id: "sl-8", route: "Chennai -> Singapore", carrier: "MSC", sailingDate: "2026-08-20", cutoffDate: "2026-08-19", containerCode: "20GP", mode: "FCL", usedLengthM: 5.9, usedWeightKg: 18000, status: "full" },
  { id: "sl-9", route: "Chennai -> Singapore", carrier: "MSC", sailingDate: "2026-08-23", cutoffDate: "2026-08-21", containerCode: "40GP", mode: "LCL", usedLengthM: 1.9, usedWeightKg: 2400, status: "open" },
  { id: "sl-10", route: "Chennai -> Singapore", carrier: "MSC", sailingDate: "2026-08-27", cutoffDate: "2026-08-25", containerCode: "40GP", mode: "FCL", usedLengthM: 0, usedWeightKg: 0, status: "open" },

  // Tuticorin -> Jeddah (OOCL)
  { id: "sl-11", route: "Tuticorin -> Jeddah", carrier: "OOCL", sailingDate: "2026-08-22", cutoffDate: "2026-08-19", containerCode: "40GP", mode: "FCL", usedLengthM: 12.03, usedWeightKg: 24000, status: "full" },
  { id: "sl-12", route: "Tuticorin -> Jeddah", carrier: "OOCL", sailingDate: "2026-08-29", cutoffDate: "2026-08-26", containerCode: "40HC", mode: "LCL", usedLengthM: 0.9, usedWeightKg: 1100, status: "open" },
];

export const knowledgeDocs: KnowledgeDoc[] = [
  { id: "kb-1", title: "Container specifications", category: "container_specs", lastUpdated: "2026-08-18", summary: "Dimensions, capacity, and payload limits for every container type Araxys books." },
  { id: "kb-2", title: "Route pricing & negotiation bands", category: "pricing", lastUpdated: "2026-08-18", summary: "Base freight, surcharges, and floor/ceiling negotiation bands by route and container type." },
  { id: "kb-3", title: "Documents required by cargo type", category: "documents_by_cargo", lastUpdated: "2026-08-18", summary: "Mandatory and conditional documents for general, textile, perishable, hazardous, electronics, and agri cargo." },
  { id: "kb-5", title: "Sailing schedule & space availability (dummy)", category: "space_availability", lastUpdated: "2026-08-19", summary: "Placeholder sailing dates and remaining container/LCL space per route — static for now, to be replaced by a live tool call." },
  { id: "kb-4", title: "Destination customs & regulations", category: "destination_regulations", lastUpdated: "2026-08-18", summary: "Free time, detention/demurrage rates, and certificate requirements per destination port." },
];
