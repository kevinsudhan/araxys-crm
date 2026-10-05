import { supabase } from "../lib/supabase";
import { consolePnl, type ConsolePnl } from "../lib/consolePnl";
import { shareFigures, termsOf, withoutShares, type SettleKind, type SettlingDoc, type ShareFigures, type ShareTerms } from "../lib/profitShare";
import { issueInvoice } from "./billing";
import { updateConsole, type Console } from "./consoles";
import { loadConsolePnl, loadJobPnl } from "./jobPnl";
import { updatePartner, type Partner } from "./partners";

/**
 * The overseas agent's share of the profit, on a console or on a job on no
 * console (130). The rules are lib/profitShare.ts; the note is drafted by
 * raise_profit_share() and issued like any other.
 */

export type ShareSubject = { kind: "console"; console: Console } | { kind: "job"; shipmentId: string; ref: string | null; agentIds: string[] };

export interface ShareState {
  agents: Partner[];
  agent: Partner | null;
  terms: ShareTerms;
  /** The P&L without the notes that settle a share. */
  pnl: ConsolePnl;
  figures: ShareFigures;
  settling: SettlingDoc[];
  /** The agent's currency and rate of exchange, from their latest note here. */
  currencyHint: string;
  roeHint: number | null;
  /** House B/L numbers, by job. */
  hbl: Record<string, string | null>;
}

const day = (v: unknown) => String(v ?? "").slice(0, 10);

export async function loadShare(subject: ShareSubject, agentId?: string | null): Promise<ShareState> {
  const c = subject.kind === "console" ? subject.console : null;
  const ids = subject.kind === "console" ? (subject.console.agent_id ? [subject.console.agent_id] : []) : subject.agentIds;
  const [data, partners] = await Promise.all([
    subject.kind === "console" ? loadConsolePnl(subject.console.id) : loadJobPnl(subject.shipmentId),
    ids.length ? supabase.from("partners").select("*").in("id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  if (partners.error) throw new Error(partners.error.message);
  const agents = ids.map((id) => ((partners.data ?? []) as Partner[]).find((p) => p.id === id)).filter((p): p is Partner => Boolean(p));
  const agent = agents.find((p) => p.id === agentId) ?? agents[0] ?? null;

  const pnl = consolePnl(data.jobs, withoutShares(data.docs), { capacityCbm: null, coload: c?.space_from === "coloader" });
  const terms = termsOf(agent, c ? (c.profit_share_pct ?? null) : null);

  let settling: SettlingDoc[] = [];
  let currencyHint = "USD";
  let roeHint: number | null = null;
  if (agent) {
    let qOurs = supabase
      .from("invoices")
      .select("id, number, kind, status, invoice_date, currency, exchange_rate, taxable_value, created_at, lines:invoice_lines(quantity, rate)")
      .eq("partner_id", agent.id)
      .not("profit_share_pct", "is", null)
      .neq("status", "cancelled");
    let qTheirs = supabase
      .from("bills")
      .select("id, bill_no, kind, status, bill_date, currency, exchange_rate, taxable_value")
      .eq("partner_id", agent.id)
      .eq("profit_share", true)
      .neq("status", "cancelled");
    if (subject.kind === "console") {
      qOurs = qOurs.eq("console_id", subject.console.id);
      qTheirs = qTheirs.eq("console_id", subject.console.id);
    } else {
      qOurs = qOurs.eq("shipment_id", subject.shipmentId);
      qTheirs = qTheirs.eq("shipment_id", subject.shipmentId);
    }
    const [ours, theirs, rates] = await Promise.all([
      qOurs,
      qTheirs,
      // The agent's latest rate of exchange anywhere, for the note's figure.
      supabase.from("bills").select("currency, exchange_rate, bill_date").eq("partner_id", agent.id).neq("currency", "INR").order("bill_date", { ascending: false }).limit(1),
    ]);
    if (ours.error) throw new Error(ours.error.message);
    if (theirs.error) throw new Error(theirs.error.message);
    type Inv = { id: string; number: string | null; kind: string; status: string; invoice_date: string; currency: string; exchange_rate: number; taxable_value: number; created_at: string; lines?: Array<{ quantity: number; rate: number }> };
    type Bil = { id: string; bill_no: string; kind: string; status: string; bill_date: string; currency: string; exchange_rate: number; taxable_value: number };
    const mine = ((ours.data ?? []) as Inv[]).map(
      (i): SettlingDoc => ({
        id: i.id,
        ours: true,
        kind: i.kind as SettleKind,
        number: i.number,
        status: i.status,
        date: day(i.invoice_date || i.created_at),
        inr: Number(i.taxable_value) || 0,
        currency: i.currency,
        amount: (i.lines ?? []).reduce((n, l) => n + Number(l.quantity) * Number(l.rate), 0),
      })
    );
    const yours = ((theirs.data ?? []) as Bil[]).map(
      (b): SettlingDoc => ({
        id: b.id,
        ours: false,
        kind: b.kind as SettleKind,
        number: b.bill_no,
        status: b.status,
        date: day(b.bill_date),
        inr: (Number(b.taxable_value) || 0) * (Number(b.exchange_rate) || 1),
        currency: b.currency,
        amount: Number(b.taxable_value) || 0,
      })
    );
    settling = [...mine, ...yours].sort((a, b) => a.date.localeCompare(b.date));
    const lastNote = [...mine].reverse().find((d) => d.currency !== "INR");
    const lastRate = ((rates.data ?? []) as Array<{ currency: string; exchange_rate: number }>)[0];
    if (lastNote) {
      currencyHint = lastNote.currency;
      roeHint = lastNote.amount > 0 ? Math.round((lastNote.inr / lastNote.amount) * 10000) / 10000 : null;
    } else if (lastRate) {
      currencyHint = lastRate.currency;
      roeHint = Number(lastRate.exchange_rate) || null;
    }
  }

  const jobIds = data.jobs.map((j) => j.id);
  const { data: bl } = jobIds.length ? await supabase.from("shipments").select("id, bl_number").in("id", jobIds) : { data: [] };
  const hbl = Object.fromEntries(((bl ?? []) as Array<{ id: string; bl_number: string | null }>).map((r) => [r.id, r.bl_number]));

  return { agents, agent, terms, pnl, figures: shareFigures(pnl, terms, settling), settling, currencyHint, roeHint, hbl };
}

/** Draft our note for what is left to settle. */
export async function raiseShare(
  subject: ShareSubject,
  agent: Partner,
  f: ShareFigures,
  note: { currency: string; roe: number | null; amount: number; description: string }
): Promise<{ id: string }> {
  if (!f.next || f.pct === null) throw new Error("Nothing is left to settle.");
  const { data, error } = await supabase.rpc("raise_profit_share", {
    p_partner: agent.id,
    p_console: subject.kind === "console" ? subject.console.id : null,
    p_shipment: subject.kind === "job" ? subject.shipmentId : null,
    p_kind: f.next,
    p_currency: note.currency,
    p_roe: note.roe,
    p_amount: note.amount,
    p_pct: f.pct,
    p_base_inr: f.baseInr,
    p_description: note.description,
  });
  if (error) throw new Error(error.message);
  return data as { id: string };
}

export const issueShareNote = (id: string) => issueInvoice(id);

/** The agreement, on the agent's record. */
export const saveAgreement = (agent: Partner, pct: number | null, losses: boolean) =>
  updatePartner(agent.id, { profit_share_pct: pct, profit_share_losses: losses });

/** This console agreed differently: a figure, 0 for none, or null to follow the agreement. */
export const saveConsoleShare = (c: Console, pct: number | null) => updateConsole(c.id, { profit_share_pct: pct });
