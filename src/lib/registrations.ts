import { COMPANY } from "./company";

/**
 * The company's own registrations (132): what lets Aashish Logistics issue
 * house B/Ls, file as consol agent and hold cargo under bond, and when each
 * runs out.
 *
 * ---------------------------------------------------------------------------
 *   mto             its MTO registration with the DG Shipping; the house B/Ls
 *                   are issued under it once it is on file and in force
 *   consol_agent    its registration with Customs as consol agent
 *   customs_bond    the bond Customs holds for that
 *   bank_guarantee  the guarantee behind the bond
 *   ebl_platform    where its electronic B/Ls are issued and passed on
 *   other           anything else worth watching
 *
 * Each is in force, running out (inside WARN_DAYS), run out, or has no end
 * date on file. A run-out registration is how a console is held at the port,
 * so the console desk sees what is running out, not only the administrator.
 * ---------------------------------------------------------------------------
 */

export type RegKind = "mto" | "consol_agent" | "customs_bond" | "bank_guarantee" | "ebl_platform" | "other";

export interface Registration {
  id: string;
  kind: RegKind;
  title: string;
  number: string;
  authority: string;
  /** YYYY-MM-DD */
  issued_on: string | null;
  valid_until: string | null;
  amount_inr: number | null;
  notes: string;
  active: boolean;
  updated_at?: string;
}

export const KINDS: RegKind[] = ["mto", "consol_agent", "customs_bond", "bank_guarantee", "ebl_platform", "other"];

export const KIND_LABEL: Record<RegKind, string> = {
  mto: "MTO registration",
  consol_agent: "Consol agent registration",
  customs_bond: "Customs bond",
  bank_guarantee: "Bank guarantee",
  ebl_platform: "eBL platform",
  other: "Other",
};

export const KIND_HINT: Record<RegKind, string> = {
  mto: "Multimodal transport operator, with the DG Shipping. Our house B/Ls are issued under it.",
  consol_agent: "With Customs, to file the CSN and manifests as consol agent.",
  customs_bond: "The bond Customs holds for the consol agent registration.",
  bank_guarantee: "The guarantee behind the bond.",
  ebl_platform: "Where our electronic B/Ls are issued, passed on and surrendered. The number is our account there.",
  other: "Any other licence or registration with an end date worth watching.",
};

/** Who usually issues or holds it, as a placeholder. */
export const AUTHORITY_HINT: Record<RegKind, string> = {
  mto: "Directorate General of Shipping",
  consol_agent: "e.g. the Commissioner of Customs, Chennai",
  customs_bond: "e.g. Chennai Sea Customs",
  bank_guarantee: "The bank",
  ebl_platform: "The platform's operator",
  other: "",
};

/** Bonds and guarantees are amounts; the rest are not. */
export const HAS_AMOUNT: Record<RegKind, boolean> = { mto: false, consol_agent: false, customs_bond: true, bank_guarantee: true, ebl_platform: false, other: true };

/** Said as running out this many days before. */
export const WARN_DAYS = 60;

export type RegState = "in_force" | "running_out" | "run_out" | "no_end_date" | "retired";

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function regState(r: Pick<Registration, "valid_until" | "active">, today: string): { state: RegState; daysLeft: number | null } {
  if (!r.active) return { state: "retired", daysLeft: null };
  if (!r.valid_until) return { state: "no_end_date", daysLeft: null };
  const daysLeft = daysBetween(today, r.valid_until);
  return { state: daysLeft < 0 ? "run_out" : daysLeft <= WARN_DAYS ? "running_out" : "in_force", daysLeft };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayText = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function stateText(r: Pick<Registration, "valid_until" | "active">, today: string): string {
  const { state, daysLeft } = regState(r, today);
  if (state === "retired") return "Retired";
  if (state === "no_end_date") return "No end date on file";
  if (state === "run_out") return `Ran out on ${dayText(r.valid_until!)}`;
  if (daysLeft === 0) return "Runs out today";
  return `${state === "running_out" ? "Runs out" : "In force until"} ${dayText(r.valid_until!)}${state === "running_out" ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"})` : ""}`;
}

const nameOf = (r: Pick<Registration, "kind" | "title">) => r.title.trim() || KIND_LABEL[r.kind];

/** What needs doing, most urgent first: a registration run out or running out. */
export function regAlerts(regs: Registration[], today: string): Array<{ id: string; urgent: boolean; text: string }> {
  return regs
    .map((r) => ({ r, ...regState(r, today) }))
    .filter((x) => x.state === "run_out" || x.state === "running_out")
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .map(({ r, state }) => ({
      id: r.id,
      urgent: state === "run_out",
      text: `${nameOf(r)}${r.number ? ` ${r.number}` : ""}: ${stateText(r, today).replace(/^R/, "r")}`,
    }));
}

/**
 * Our own MTO registration for a house B/L: the one in force, as printed —
 * the registered name and its number — or why it cannot be used.
 */
export function ownMto(regs: Registration[], today: string): { name: string; registration: string; usable: boolean; problem: string | null; validUntil: string | null } | null {
  const r = regs.find((x) => x.kind === "mto" && x.active);
  if (!r) return null;
  const name = COMPANY.legalName.toUpperCase();
  const registration = r.number.trim().toUpperCase();
  const { state } = regState(r, today);
  const problem = !registration ? "no number on file" : state === "run_out" ? `ran out on ${dayText(r.valid_until!)}` : null;
  return { name, registration, usable: !problem, problem, validUntil: r.valid_until };
}

/** The platform our eBLs are issued on, when one is on file. */
export const eblPlatform = (regs: Registration[]) => {
  const r = regs.find((x) => x.kind === "ebl_platform" && x.active);
  return r ? nameOf(r) : null;
};

/** What a registration needs before it is saved, in words. */
export function regProblems(r: Pick<Registration, "kind" | "title" | "number" | "issued_on" | "valid_until" | "amount_inr">): string[] {
  const out: string[] = [];
  if (r.kind === "ebl_platform" ? !r.title.trim() : !r.number.trim()) out.push(r.kind === "ebl_platform" ? "the platform's name" : "its number");
  if (r.issued_on && r.valid_until && r.valid_until < r.issued_on) out.push("an end date after the date it was issued");
  if (r.amount_inr !== null && (Number.isNaN(r.amount_inr) || r.amount_inr < 0)) out.push("an amount of nothing or more");
  return out;
}
