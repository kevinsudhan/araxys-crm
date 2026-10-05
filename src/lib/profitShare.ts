import type { ConsolePnl, HouseLine } from "./consolePnl";
import type { PnlDoc } from "./jobPnl";

/**
 * The overseas agent's share of the profit (130).
 *
 * ---------------------------------------------------------------------------
 * The agency agreement gives the agent a share of the profit on the cargo
 * they handle with us — 50/50 is the usual — and says whether a loss is
 * shared the same way. A console can be agreed differently, or not at all.
 *
 * THE PROFIT IT IS WORKED ON
 *
 * The console's P&L (lib/consolePnl.ts), or the job's for a job on no console:
 * issued invoices less credit notes, against every bill, before GST — less
 * nothing for the share itself. The notes that settle a share are marked
 * (ours on the invoice, theirs on the bill) and left out, so the share is
 * never worked on a profit that already has it taken off.
 *
 * WHO OWES WHOM, AND THE NOTE THAT SAYS SO
 *
 *   a profit:              we owe them their share → our credit note to them;
 *   a loss, shared:        they owe us their share → our debit note on them;
 *   a loss, not shared:    nothing.
 *
 * Or the agent works it out and sends their own note, recorded as a bill
 * and marked as their profit share. Every note either way, drafts included,
 * counts toward what is settled; what is left — a late bill moving the profit,
 * say — is raised as one more note for the difference, so nothing is ever
 * shared twice.
 * ---------------------------------------------------------------------------
 */

export interface ShareTerms {
  /** Per cent; null when no share applies. */
  pct: number | null;
  losses: boolean;
  /** The agreement on the agent, this console's own figure, or none at all. */
  source: "agreement" | "console" | null;
}

export function termsOf(agent: { profit_share_pct: number | null; profit_share_losses: boolean } | null, consolePct?: number | null): ShareTerms {
  const losses = agent?.profit_share_losses ?? true;
  if (consolePct !== null && consolePct !== undefined) return { pct: consolePct > 0 ? Number(consolePct) : null, losses, source: "console" };
  const pct = agent?.profit_share_pct;
  return pct !== null && pct !== undefined && pct > 0 ? { pct: Number(pct), losses, source: "agreement" } : { pct: null, losses, source: null };
}

export type SettleKind = "credit_note" | "debit_note" | "agent_debit_note" | "agent_credit_note";

/** A note that settles a share: ours on the agent (an invoice), or theirs on us (a bill). */
export interface SettlingDoc {
  id: string;
  ours: boolean;
  kind: SettleKind;
  number: string | null;
  status: string;
  /** YYYY-MM-DD */
  date: string;
  /** Rupees before GST, as a positive figure. */
  inr: number;
  currency: string;
  /** In its own currency. */
  amount: number;
}

/** Toward the agent: what we owe them (+) or they owe us (−). Our credit note to them and their debit note on us are both what we owe. */
export const towardAgent = (d: Pick<SettlingDoc, "kind" | "inr">) => (d.kind === "credit_note" || d.kind === "agent_debit_note" ? d.inr : -d.inr);

export interface ShareFigures {
  /** The profit the share is worked on: before the share. */
  baseInr: number;
  pct: number | null;
  /** The agent's share, toward the agent: + we owe them, − they owe us. */
  dueInr: number;
  /** A loss the agreement does not share. */
  lossKept: boolean;
  /** Settled by notes either way, drafts included, toward the agent. */
  settledInr: number;
  /** Of it, our notes not yet issued. */
  draftInr: number;
  /** Still to settle, toward the agent. */
  toSettleInr: number;
  /** The note that settles it: a credit note when we owe them, a debit note when they owe us; null when under a rupee is left or no share applies. */
  next: "credit_note" | "debit_note" | null;
  /** Why the profit is not final yet. */
  notFinal: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The documents of the P&L, without the notes that settle a share. */
export const withoutShares = (docs: PnlDoc[]) => docs.filter((d) => !d.profitShare);

export function shareFigures(pnl: Pick<ConsolePnl, "gp" | "onQuote" | "provisional">, terms: ShareTerms, settling: SettlingDoc[]): ShareFigures {
  const baseInr = round2(pnl.gp);
  const pct = terms.pct;
  const lossKept = pct !== null && baseInr < 0 && !terms.losses;
  const dueInr = pct === null || lossKept ? 0 : round2((baseInr * pct) / 100);
  const live = settling.filter((d) => d.status !== "cancelled");
  const settledInr = round2(live.reduce((n, d) => n + towardAgent(d), 0));
  const draftInr = round2(live.filter((d) => d.ours && d.status === "draft").reduce((n, d) => n + towardAgent(d), 0));
  const toSettleInr = pct === null ? 0 : round2(dueInr - settledInr);
  const next = pct === null || Math.abs(toSettleInr) < 1 ? null : toSettleInr > 0 ? "credit_note" : "debit_note";
  const notFinal: string[] = [];
  if (pnl.onQuote) notFinal.push(`${pnl.onQuote} house${pnl.onQuote === 1 ? " is" : "s are"} counted at the quotation: not invoiced yet`);
  if (pnl.provisional) notFinal.push("a cost is a draft bill: the vendor's invoice is not in yet");
  return { baseInr, pct, dueInr, lossKept, settledInr, draftInr, toSettleInr, next, notFinal };
}

/** The rupees in the agent's currency, at the rate of exchange (INR per one unit). */
export function inCurrency(inr: number, currency: string, roe: number | null): number | null {
  if (currency.toUpperCase() === "INR") return round2(inr);
  return roe && roe > 0 ? round2(inr / roe) : null;
}

const fmtInr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** What the note says it is for. */
export function noteDescription(f: Pick<ShareFigures, "pct" | "baseInr" | "settledInr">, on: { console_no?: string | null; mbl?: string | null; job?: string | null }): string {
  const what = on.console_no ? `console ${on.console_no}${on.mbl ? `, MBL ${on.mbl}` : ""}` : `job ${on.job ?? ""}`.trim();
  const profit = f.baseInr < 0 ? `loss ${fmtInr(-f.baseInr)}` : `profit ${fmtInr(f.baseInr)}`;
  return `Profit share ${f.pct}% on ${what} (${profit})${Math.abs(f.settledInr) >= 1 ? ": the balance after the notes already raised" : ""}`;
}

// ---------------------------------------------------------------------------
// The statement to the agent
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `${n < -0.005 ? "-" : ""}${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface StatementOn {
  console_no?: string | null;
  mbl?: string | null;
  vessel?: string | null;
  pol?: string | null;
  pod?: string | null;
  job?: string | null;
  agentName: string;
  /** The house B/L numbers, by job. */
  hbl?: Record<string, string | null>;
}

export function statementSubject(on: StatementOn): string {
  const what = on.console_no ? [on.console_no, on.mbl ? `MBL ${on.mbl}` : null].filter(Boolean).join(" / ") : on.job ?? "";
  return `PROFIT SHARE STATEMENT — ${what}`.toUpperCase();
}

/** The notes as the agent reads them. */
const TO_AGENT: Record<SettleKind, string> = {
  credit_note: "Our credit note to you",
  debit_note: "Our debit note on you",
  agent_debit_note: "Your debit note on us",
  agent_credit_note: "Your credit note to us",
};

/**
 * The statement: each house's revenue, cost and profit, the total, the share,
 * every note that settles it either way, and what is left. In rupees, as the
 * books keep them, each note in its own currency too.
 */
export function statementHtml(on: StatementOn, houses: HouseLine[], f: ShareFigures, settling: SettlingDoc[]): string {
  const th = "padding:4px 8px;border-bottom:1px solid #d1d5db;text-align:left;font-weight:600;color:#374151";
  const td = "padding:4px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top";
  const num = `${td};text-align:right;white-space:nowrap`;
  const facts: Array<[string, string]> = [
    ["Console", on.console_no ?? ""],
    ["Master B/L", on.mbl ?? ""],
    ["Vessel / voyage", on.vessel ?? ""],
    ["Route", [on.pol, on.pod].filter(Boolean).join(" – ")],
    ["Job", on.console_no ? "" : on.job ?? ""],
  ].filter(([, v]) => v) as Array<[string, string]>;
  const rows = houses
    .map(
      (h) =>
        `<tr><td style="${td}">${esc(on.hbl?.[h.jobId] || h.ref || h.jobId)}</td><td style="${td}">${esc(h.customer)}${h.onQuote ? " <em>(as quoted)</em>" : ""}</td>` +
        `<td style="${num}">${h.wm ? h.wm.toLocaleString("en-IN") : "—"}</td><td style="${num}">${money(h.revenue)}</td><td style="${num}">${money(h.ownCost + h.sharedCost)}</td><td style="${num}">${money(h.gp)}</td></tr>`
    )
    .join("");
  const revenue = houses.reduce((n, h) => n + h.revenue, 0);
  const cost = houses.reduce((n, h) => n + h.ownCost + h.sharedCost, 0);
  const notes = settling.filter((d) => d.status !== "cancelled");
  const lines: Array<[string, string]> = [
    [`Profit on the ${on.console_no ? "console" : "job"}`, `INR ${money(f.baseInr)}`],
    [`Your share, ${f.pct}%${f.lossKept ? " (a loss is not shared)" : ""}`, `INR ${money(Math.abs(f.dueInr))}${f.dueInr < 0 ? " due from you" : ""}`],
  ];
  for (const d of notes) {
    const roe = d.amount > 0 ? Math.round((d.inr / d.amount) * 100) / 100 : null;
    lines.push([
      `${TO_AGENT[d.kind]} ${d.number ?? "(draft)"}`,
      d.currency !== "INR" ? `${d.currency} ${money(d.amount)} (INR ${money(d.inr)}${roe ? ` at ${roe}` : ""})` : `INR ${money(d.inr)}`,
    ]);
  }
  if (Math.abs(f.toSettleInr) >= 1) lines.push(["Still to settle", `INR ${money(Math.abs(f.toSettleInr))} ${f.toSettleInr > 0 ? "due to you" : "due from you"}`]);
  return (
    `<p>Dear ${esc(on.agentName || "Sir / Madam")} team,</p>` +
    `<p>Please find below the profit share statement for ${on.console_no ? `our console <strong>${esc(on.console_no)}</strong>` : `job <strong>${esc(on.job ?? "")}</strong>`}.</p>` +
    (facts.length
      ? `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px">${facts.map(([k, v]) => `<tr><td style="${td};color:#555;width:150px">${k}</td><td style="${td}">${esc(v)}</td></tr>`).join("")}</table>`
      : "") +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px">` +
    `<tr><th style="${th}">House B/L</th><th style="${th}">Customer</th><th style="${th};text-align:right">W/M</th><th style="${th};text-align:right">Revenue (INR)</th><th style="${th};text-align:right">Cost (INR)</th><th style="${th};text-align:right">Profit (INR)</th></tr>` +
    rows +
    `<tr><td style="${td};font-weight:600" colspan="3">Total</td><td style="${num};font-weight:600">${money(revenue)}</td><td style="${num};font-weight:600">${money(cost)}</td><td style="${num};font-weight:600">${money(f.baseInr)}</td></tr>` +
    `</table>` +
    `<table style="border-collapse:collapse;font-size:13px;margin:8px 0 12px">${lines.map(([k, v]) => `<tr><td style="${td};color:#555;width:260px">${esc(k)}</td><td style="${num}">${esc(v)}</td></tr>`).join("")}</table>` +
    `<p style="font-size:12px;color:#555">Revenue and cost before GST. The console's own charges are shared across its houses by volume.</p>` +
    `<p>${notes.some((d) => d.ours) ? "Our note above nets on our next statement of account with you. " : ""}Please let us know if anything needs a second look.</p>`
  );
}
