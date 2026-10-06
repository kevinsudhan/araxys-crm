/**
 * Debit and credit: what each shipment and each party is worth both ways (7 Oct).
 *
 * ---------------------------------------------------------------------------
 * THE TWO SIDES, IN THE DESK'S WORDS
 *
 *   Debit   what we billed others — they owe us. Our tax invoices and debit
 *           notes, to a customer or an overseas agent, less our credit notes.
 *   Credit  what others billed us — we owe them. Carrier and vendor invoices
 *           and an agent's debit notes, less an agent's credit notes.
 *
 * The same rules as the final bill (job_final_bill, 042) so the two pages never
 * disagree: only issued invoices count (a draft has billed nobody yet, and a
 * proforma is a request, not a bill); every bill not cancelled counts, a draft
 * one too — the cost is known before the vendor's invoice arrives.
 *
 * Amounts are rupees with GST, as the party's ledger holds them. What has been
 * received or paid against each document (confirmed payments, TDS as settled)
 * is carried beside it, in the document's own share: half of a dollar bill paid
 * is half its rupees paid.
 *
 * A document on a console and on no one job (a master bill's freight) stays
 * on the console: splitting a carrier's invoice across jobs is the P&L's
 * estimate (lib/jobPnl), not a ledger fact.
 *
 * Pure: services/debitCredit.ts reads the records.
 * ---------------------------------------------------------------------------
 */

export type Side = "debit" | "credit";

export interface DcDoc {
  id: string;
  side: Side;
  kind: string;
  number: string | null;
  /** YYYY-MM-DD, India's day. */
  date: string;
  status: string;
  shipmentId: string | null;
  consoleId: string | null;
  /** "c:<customer>", "p:<partner>", or "n:<name>" when the document names neither. */
  partyKey: string;
  partyName: string;
  /** "Customer", "Overseas agent", "Carrier / line"… */
  partyType: string;
  /** Rupees with GST; a credit note is negative on its side. */
  amount: number;
  /** Rupees received (debit) or paid (credit) against it. */
  settled: number;
}

export interface DcJob {
  id: string;
  ref: string | null;
  customer: string;
  route: string;
  mode: string | null;
  consoleId: string | null;
  consoleNo: string | null;
}

export const DOC_LABEL: Record<string, string> = {
  tax_invoice: "Invoice",
  debit_note: "Debit note",
  credit_note: "Credit note",
  carrier_invoice: "Carrier invoice",
  vendor_invoice: "Vendor invoice",
  agent_debit_note: "Agent debit note",
  agent_credit_note: "Agent credit note",
};

export interface Totals {
  debit: number;
  credit: number;
  /** Debit less credit: what the work brings in, before anything is settled. */
  difference: number;
  received: number;
  paid: number;
  /** Still to come in, and still to go out. Never below nothing. */
  toCollect: number;
  toPay: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function totals(docs: DcDoc[]): Totals {
  let debit = 0,
    credit = 0,
    received = 0,
    paid = 0;
  for (const d of docs) {
    if (d.side === "debit") {
      debit += d.amount;
      received += d.settled;
    } else {
      credit += d.amount;
      paid += d.settled;
    }
  }
  return {
    debit: round(debit),
    credit: round(credit),
    difference: round(debit - credit),
    received: round(received),
    paid: round(paid),
    toCollect: round(Math.max(0, debit - received)),
    toPay: round(Math.max(0, credit - paid)),
  };
}

/**
 * Where a party stands once everything is settled both ways: what they still
 * owe us less what we still owe them. Positive, they owe us; negative, we owe
 * them.
 */
export const standing = (t: Totals) => round(t.toCollect - t.toPay);

export interface Group extends Totals {
  key: string;
  label: string;
  sub: string;
  docs: DcDoc[];
  /** A job's parties, or a party's jobs. */
  count: number;
}

const byTotal = (a: Group, b: Group) => b.debit + b.credit - (a.debit + a.credit) || a.label.localeCompare(b.label);

/**
 * Per shipment, biggest first. A console's own documents (on no one job) are a
 * row of their own, keyed `console:<id>`.
 */
export function byJob(jobs: DcJob[], docs: DcDoc[], consoleNo: (id: string) => string | null = () => null): Group[] {
  const jobOf = new Map(jobs.map((j) => [j.id, j]));
  const by = new Map<string, DcDoc[]>();
  for (const d of docs) {
    const key = d.shipmentId ?? (d.consoleId ? `console:${d.consoleId}` : "none");
    by.set(key, [...(by.get(key) ?? []), d]);
  }
  return [...by]
    .map(([key, list]): Group => {
      const job = jobOf.get(key);
      const consoleId = key.startsWith("console:") ? key.slice(8) : null;
      return {
        key,
        label: job ? (job.ref ?? "Shipment") : consoleId ? `Console ${consoleNo(consoleId) ?? ""}`.trim() : "Not on a shipment",
        sub: job ? [job.customer, job.route].filter(Boolean).join(" · ") : consoleId ? "The console's own documents, on no one job" : "",
        docs: list,
        count: new Set(list.map((d) => d.partyKey)).size,
        ...totals(list),
      };
    })
    .sort(byTotal);
}

/** Per party, biggest first, with how many shipments (and consoles) they are on. */
export function byParty(docs: DcDoc[]): Group[] {
  const by = new Map<string, DcDoc[]>();
  for (const d of docs) by.set(d.partyKey, [...(by.get(d.partyKey) ?? []), d]);
  return [...by]
    .map(([key, list]): Group => {
      const jobs = new Set(list.map((d) => d.shipmentId ?? (d.consoleId ? `console:${d.consoleId}` : "none")));
      return {
        key,
        label: list[0].partyName,
        sub: list[0].partyType,
        docs: list,
        count: jobs.size,
        ...totals(list),
      };
    })
    .sort(byTotal);
}

/** Months from `from` to `to` (YYYY-MM-DD, either open), each with its debit and credit; empty months included. */
export function byMonth(docs: DcDoc[], from: string | null, to: string | null): Array<{ month: string; debit: number; credit: number }> {
  if (!docs.length && (!from || !to)) return [];
  const months = docs.map((d) => d.date.slice(0, 7)).sort();
  const first = (from ?? months[0]).slice(0, 7);
  const last = (to ?? months[months.length - 1]).slice(0, 7);
  const out: Array<{ month: string; debit: number; credit: number }> = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  // Bounded: a period is at most a few years of months.
  for (let i = 0; i < 240 && (y < ly || (y === ly && m <= lm)); i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const these = docs.filter((d) => d.date.startsWith(key));
    const t = totals(these);
    out.push({ month: key, debit: t.debit, credit: t.credit });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export type PeriodKey = "month" | "3m" | "fy" | "all";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  month: "This month",
  "3m": "Last 3 months",
  fy: "This financial year",
  all: "All time",
};

/** The period as days (YYYY-MM-DD), India's financial year running April to March. */
export function periodDays(p: PeriodKey, today: string): { from: string | null; to: string | null } {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (p) {
    case "month":
      return { from: `${y}-${pad(m)}-01`, to: today };
    case "3m": {
      const back = new Date(Date.UTC(y, m - 1 - 2, 1));
      return { from: `${back.getUTCFullYear()}-${pad(back.getUTCMonth() + 1)}-01`, to: today };
    }
    case "fy":
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today };
    case "all":
      return { from: null, to: null };
  }
}

export const within = (d: DcDoc, r: { from: string | null; to: string | null }) => (!r.from || d.date >= r.from) && (!r.to || d.date <= r.to);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 26" for a month key. */
export const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
