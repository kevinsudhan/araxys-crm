/**
 * The parties a bill of lading names, and the rules about how they are written.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS IN lib/ AND NOT IN A SERVICE
 *
 * Every function here is pure — it maps between a flat party and the prefixed
 * columns on `shipments`, and it knows the two constants a party box is subject
 * to. Nothing touches the network, so a test can load it.
 * ---------------------------------------------------------------------------
 */

export type PartyRole = "shipper" | "consignee" | "notify";

export const ROLE_LABEL: Record<PartyRole, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify: "Notify party",
};

export const ROLE_HINT: Record<PartyRole, string> = {
  shipper: "Who is sending it. On an export this is usually the customer.",
  consignee: "Who receives it. Where the B/L is to a bank's order, name the bank here and the real importer as the notify party.",
  notify: "Who to tell when it arrives. On an order B/L this is the only place the actual importer is named.",
};

export interface Party {
  name: string;
  address: string;
  city: string;
  state: string;
  state_code: string;
  country: string;
  country_code: string;
  pincode: string;
  gstin: string;
  pan: string;
  iec: string;
  /** Consignee only — Direct Port Delivery clearance. */
  dpd_code?: string;
}

export const EMPTY_PARTY: Party = {
  name: "",
  address: "",
  city: "",
  state: "",
  state_code: "",
  country: "",
  country_code: "",
  pincode: "",
  gstin: "",
  pan: "",
  iec: "",
};

const FIELDS = [
  "name",
  "address",
  "city",
  "state",
  "state_code",
  "country",
  "country_code",
  "pincode",
  "gstin",
  "pan",
  "iec",
] as const;

/**
 * Pull one party out of a shipment row.
 *
 * The columns are prefixed by role — `shipper_city`, `consignee_city` — so a
 * party is a projection rather than a join. `shipper_address` did not exist
 * before 033, so anything missing reads as an empty string rather than
 * undefined: the form binds to strings and a null in an input is a React
 * warning and an uncontrolled field.
 */
export function readParty(row: Record<string, unknown>, role: PartyRole): Party {
  const out = { ...EMPTY_PARTY } as Party;
  for (const f of FIELDS) {
    out[f] = (row[`${role}_${f}`] as string | null) ?? "";
  }
  if (role === "consignee") out.dpd_code = (row.consignee_dpd_code as string | null) ?? "";
  return out;
}

/** Turn an edit to one field into the column patch that writes it. */
export function partyPatch(
  role: PartyRole,
  field: keyof Party,
  value: string
): Record<string, string | null> {
  return { [`${role}_${field}`]: value === "" ? null : value };
}

/**
 * A GSTIN carries its own state code in the first two characters and its own
 * PAN in characters 3 to 12.
 *
 * Reading them out rather than asking for them again is the difference between
 * a form that knows what it was given and one that lets a party be in Tamil
 * Nadu, state code 33, in a city called New York — which is what the screen
 * this replaces actually shows, because nothing there relates the fields to
 * each other.
 */
export function fromGstin(gstin: string): { state_code: string; pan: string } | null {
  const g = gstin.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(g)) return null;
  return { state_code: g.slice(0, 2), pan: g.slice(2, 12) };
}

/**
 * Countries this desk ships to, with their ISO 3166-1 alpha-2 code.
 *
 * A list rather than a text box because "INDIA", "India" and "Bharat" are three
 * different countries to anything that has to group by one, and because the
 * code is a fact about the country rather than a second thing to type.
 */
export const COUNTRIES: { name: string; code: string }[] = [
  { name: "India", code: "IN" },
  { name: "Sri Lanka", code: "LK" },
  { name: "United Arab Emirates", code: "AE" },
  { name: "Saudi Arabia", code: "SA" },
  { name: "Singapore", code: "SG" },
  { name: "Malaysia", code: "MY" },
  { name: "Bangladesh", code: "BD" },
  { name: "China", code: "CN" },
  { name: "Hong Kong", code: "HK" },
  { name: "Indonesia", code: "ID" },
  { name: "Thailand", code: "TH" },
  { name: "Vietnam", code: "VN" },
  { name: "Japan", code: "JP" },
  { name: "South Korea", code: "KR" },
  { name: "Oman", code: "OM" },
  { name: "Qatar", code: "QA" },
  { name: "Kuwait", code: "KW" },
  { name: "Bahrain", code: "BH" },
  { name: "Kenya", code: "KE" },
  { name: "Tanzania", code: "TZ" },
  { name: "South Africa", code: "ZA" },
  { name: "Egypt", code: "EG" },
  { name: "Turkey", code: "TR" },
  { name: "United Kingdom", code: "GB" },
  { name: "Germany", code: "DE" },
  { name: "Netherlands", code: "NL" },
  { name: "Belgium", code: "BE" },
  { name: "France", code: "FR" },
  { name: "Italy", code: "IT" },
  { name: "Spain", code: "ES" },
  { name: "United States", code: "US" },
  { name: "Canada", code: "CA" },
  { name: "Brazil", code: "BR" },
  { name: "Australia", code: "AU" },
  { name: "New Zealand", code: "NZ" },
];

export const countryCodeFor = (name: string) =>
  COUNTRIES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())?.code ?? "";

/**
 * How wide a party box is on a bill of lading.
 *
 * Carrier EDI and most B/L stationery take 35 characters to a line. Going over
 * does not fail anywhere in this system — it fails later, at the carrier, where
 * the line is truncated and the desk finds out from the draft B/L.
 *
 * So the count is shown, the way the reference system shows it, but with the
 * limit attached: a bare "51" next to a box tells you nothing unless you
 * already know what number is too big.
 */
export const BL_LINE_LIMIT = 35;

/** Which lines of an address run over, for marking them. */
export function overlongLines(text: string, limit = BL_LINE_LIMIT): number[] {
  return text
    .split("\n")
    .map((line, i) => (line.length > limit ? i + 1 : 0))
    .filter((n) => n > 0);
}
