import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, FileText, Loader2, Mail } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { inCurrency, noteDescription, statementHtml, statementSubject, type SettlingDoc } from "../lib/profitShare";
import { useTablesChanges } from "../lib/useTableChanges";
import { issueShareNote, loadShare, raiseShare, saveAgreement, saveConsoleShare, type ShareState, type ShareSubject } from "../services/profitShare";
import ComposeMail from "./ComposeMail";

const inr = (n: number) => `${n < -0.5 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const fig = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DOC_LABEL: Record<SettlingDoc["kind"], string> = {
  credit_note: "Our credit note to them",
  debit_note: "Our debit note on them",
  agent_debit_note: "Their debit note on us",
  agent_credit_note: "Their credit note to us",
};

/**
 * The overseas agent's share of the profit (130), on a console or on a job on
 * no console: the profit before the share, their share by the agreement,
 * what the notes either way have settled, and the note for what is left —
 * drafted in their currency, issued here or in Accounts, and netted on their
 * statement of account. The rules are lib/profitShare.ts.
 */
export default function ProfitSharePanel({ subject, onChanged }: { subject: ShareSubject; onChanged?: () => void }) {
  const { session } = useAuth();
  const [st, setSt] = useState<ShareState | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [currency, setCurrency] = useState("");
  const [roe, setRoe] = useState("");
  const [pct, setPct] = useState("50");
  const [losses, setLosses] = useState(true);
  const [editing, setEditing] = useState(false);
  const [mail, setMail] = useState<{ to: string; subject: string; body: string } | null>(null);
  const seeded = useRef<string | null>(null);

  const c = subject.kind === "console" ? subject.console : null;
  const key = subject.kind === "console" ? `${subject.console.id}:${subject.console.updated_at}:${subject.console.agent_id}` : `${subject.shipmentId}:${subject.agentIds.join(",")}`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await loadShare(subject, agentId);
      setSt(s);
      setCurrency((v) => v || s.currencyHint);
      setRoe((v) => v || (s.roeHint ? String(s.roeHint) : ""));
      // The agreement form starts from the agent's record, once per agent and per change to it.
      const seed = s.agent ? `${s.agent.id}:${s.agent.profit_share_pct}:${s.agent.profit_share_losses}` : null;
      if (s.agent && seeded.current !== seed) {
        seeded.current = seed;
        setPct(s.agent.profit_share_pct != null ? String(s.agent.profit_share_pct) : "50");
        setLosses(s.agent.profit_share_losses);
      }
    } catch (e) {
      setError(failureText(e, "Could not work out the agent's profit share.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or job, its agent or the chosen agent change
  }, [key, agentId]);
  useEffect(() => {
    void load();
  }, [load]);
  useTablesChanges(
    [
      ["invoices", null],
      ["bills", null],
      ["quotes", null],
    ],
    () => void load()
  );

  async function act(k: string, fn: () => Promise<unknown>) {
    setBusy(k);
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const header = <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Agent's profit share</h3>;

  if (!st) {
    return (
      <section>
        {header}
        {error ? (
          <p className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>
        ) : (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Working out the share…
          </p>
        )}
      </section>
    );
  }

  const { agent, terms, figures: f, settling, pnl } = st;
  const agentName = agent ? agent.organisation || agent.name : "";

  if (!agent) {
    return (
      <section>
        {header}
        <p className="text-[12px] text-text-muted">
          {c
            ? "No overseas agent on this console. Appoint one in the console's details to share the profit with them."
            : "No overseas agent on this job: name the routing agent on its Overview, or assign one on the enquiry's Partners, to share the profit with them."}
        </p>
      </section>
    );
  }

  const cur = (currency || "USD").toUpperCase();
  const roeN = Number(roe);
  const amount = inCurrency(Math.abs(f.toSettleInr), cur, roeN > 0 ? roeN : null);
  const draft = settling.find((d) => d.ours && d.status === "draft");
  const owesUs = f.dueInr < 0;
  const tile = (label: string, value: string, note: string, tone = "text-text-primary") => (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`text-[16px] font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11px] text-text-muted">{note}</p>
    </div>
  );

  const agreementForm = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="mb-0.5 block text-[11px] text-text-secondary">Their share of the profit</span>
        <span className="flex items-center gap-1">
          <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" aria-label="Their share, per cent" className="h-8 w-20 text-right text-[12.5px] tabular-nums" />
          <span className="text-[12.5px] text-text-secondary">%</span>
        </span>
      </label>
      <label className="flex h-8 items-center gap-1.5 text-[12.5px] text-text-secondary">
        <input type="checkbox" checked={losses} onChange={(e) => setLosses(e.target.checked)} className="size-3.5 accent-[var(--brand)]" />A loss is shared too
      </label>
      <button
        type="button"
        onClick={() => {
          const n = Number(pct);
          if (!(n > 0 && n <= 100)) return setError("The share is a per cent: more than 0, at most 100.");
          void act("agree", async () => {
            await saveAgreement(agent, n, losses);
            setEditing(false);
          });
        }}
        disabled={busy !== null}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {busy === "agree" && <Loader2 size={13} className="animate-spin" />} Save on {agentName}'s record
      </button>
      {terms.source === "agreement" && agent.profit_share_pct != null && (
        <button
          type="button"
          onClick={() => window.confirm(`No profit share with ${agentName} any more?`) && void act("agree", () => saveAgreement(agent, null, losses))}
          disabled={busy !== null}
          className="h-8 px-2 text-[12px] text-text-muted hover:text-text-danger"
        >
          No profit share
        </button>
      )}
      {editing && (
        <button type="button" onClick={() => setEditing(false)} className="h-8 px-2 text-[12px] text-text-muted hover:text-text-primary">
          Cancel
        </button>
      )}
      <p className="w-full text-[11px] text-text-muted">The agreement with {agentName}: it applies to every console and job with them, unless one is agreed differently.</p>
    </div>
  );

  return (
    <section>
      {header}
      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}
      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          {st.agents.length > 1 ? (
            <select value={agent.id} onChange={(e) => setAgentId(e.target.value)} aria-label="Which agent" className="h-8 text-[12.5px]">
              {st.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.organisation || a.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[12.5px] font-medium text-text-primary">{agentName}</span>
          )}
          <span className="mr-auto text-[12px] text-text-secondary">
            {terms.pct !== null
              ? `${terms.pct}% of the profit${terms.losses ? ", a loss shared too" : ", a loss not shared"} — ${terms.source === "console" ? "agreed for this console" : "the agreement with them"}`
              : terms.source === "console"
                ? "No share on this console"
                : "No profit share agreed"}
          </span>
          {terms.pct !== null && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-text-accent hover:underline">
              Change
            </button>
          )}
        </div>

        {(editing || (terms.pct === null && terms.source !== "console")) && <div className="mt-3">{agreementForm}</div>}

        {c && (editing || terms.source === "console") && (
          <ConsoleOverride
            value={c.profit_share_pct ?? null}
            busy={busy !== null}
            onSave={(v) => void act("override", () => saveConsoleShare(c, v))}
          />
        )}

        {terms.pct !== null && (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {tile(`Profit on the ${c ? "console" : "job"}`, inr(f.baseInr), "Before GST, before the share", f.baseInr < 0 ? "text-text-danger" : "text-text-primary")}
              {tile(
                `Their share, ${terms.pct}%`,
                inr(Math.abs(f.dueInr)),
                f.lossKept ? "A loss: not shared by the agreement" : f.dueInr === 0 ? "Nothing to share" : owesUs ? "They owe us: a share of the loss" : "We owe them"
              )}
              {tile(
                "Still to settle",
                inr(Math.abs(f.toSettleInr)),
                Math.abs(f.toSettleInr) < 1 ? (settling.length ? "Settled" : "Nothing to settle") : f.toSettleInr > 0 ? "We owe them" : "They owe us",
                Math.abs(f.toSettleInr) < 1 ? "text-text-success" : "text-text-primary"
              )}
            </div>

            {f.notFinal.length > 0 && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Not final: {f.notFinal.join("; ")}. A note raised now can be topped up or taken back by
                another one later.
              </p>
            )}

            {settling.length > 0 && (
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border text-[12.5px]">
                {settling.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="text-text-primary">
                      {DOC_LABEL[d.kind]} {d.number ? <span className="font-mono">{d.number}</span> : <span className="text-text-warning">draft</span>}
                    </span>
                    <span className="text-[11.5px] text-text-muted">{formatDate(d.date, { day: "numeric", month: "short" })}</span>
                    <span className="ml-auto tabular-nums text-text-secondary">
                      {d.currency !== "INR" ? `${d.currency} ${fig(d.amount)} · ` : ""}
                      {inr(d.inr)}
                    </span>
                    {d.ours && d.status === "draft" && (
                      <button
                        type="button"
                        onClick={() => void act(`issue:${d.id}`, () => issueShareNote(d.id))}
                        disabled={busy !== null}
                        className="flex h-7 items-center gap-1 rounded-lg bg-brand px-2.5 text-[11.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
                      >
                        {busy === `issue:${d.id}` && <Loader2 size={12} className="animate-spin" />} Issue it
                      </button>
                    )}
                    {d.ours && (
                      <Link
                        to={d.kind === "credit_note" ? "/accounts/overseas-credit-notes" : "/accounts/overseas-debit-notes"}
                        className="flex items-center gap-1 text-[11.5px] text-text-accent hover:underline"
                      >
                        <FileText size={12} /> Open
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* ---- the note for what is left ---- */}
            {f.next && !draft && (
              <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5">
                <p className="text-[12.5px] text-text-primary">
                  {f.next === "credit_note" ? `We owe ${agentName} ${inr(f.toSettleInr)}: a credit note to them` : `${agentName} owes us ${inr(-f.toSettleInr)}: a debit note on them`}
                  {Math.abs(f.settledInr) >= 1 && <span className="text-text-secondary"> — the balance after the notes above</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">Their currency</span>
                    <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} aria-label="Currency" className="h-8 w-20 font-mono text-[12.5px] uppercase" />
                  </label>
                  {cur !== "INR" && (
                    <label className="block">
                      <span className="mb-0.5 block text-[11px] text-text-secondary">INR per 1 {cur}</span>
                      <input value={roe} onChange={(e) => setRoe(e.target.value)} inputMode="decimal" aria-label="Rate of exchange" className="h-8 w-24 text-right text-[12.5px] tabular-nums" />
                    </label>
                  )}
                  <p className="h-8 py-1.5 text-[12.5px] tabular-nums text-text-primary">= {amount === null ? "—" : `${cur} ${fig(amount)}`}</p>
                  <button
                    type="button"
                    onClick={() =>
                      amount !== null &&
                      void act("raise", () =>
                        raiseShare(subject, agent, f, {
                          currency: cur,
                          roe: cur === "INR" ? 1 : roeN,
                          amount,
                          description: noteDescription(f, { console_no: c?.console_no, mbl: c?.mbl_number, job: subject.kind === "job" ? (subject.ref ?? subject.shipmentId) : null }),
                        })
                      )
                    }
                    disabled={amount === null || amount <= 0 || busy !== null}
                    className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                  >
                    {busy === "raise" && <Loader2 size={13} className="animate-spin" />} Draft the {f.next === "credit_note" ? "credit" : "debit"} note
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-text-muted">
                  Drafted for you to look over and issue; it nets on {agentName}'s next statement of account. If {agentName} sends their own note instead, record it under
                  Costs and tick "Their profit share".
                </p>
              </div>
            )}
            {!f.next && settling.length > 0 && !draft && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-success">
                <Check size={12} /> Settled: the notes match their share.
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setMail({
                    to: agent.emails[0] ?? "",
                    subject: statementSubject({ console_no: c?.console_no, mbl: c?.mbl_number, job: subject.kind === "job" ? subject.ref : null, agentName }),
                    body: statementHtml(
                      {
                        console_no: c?.console_no,
                        mbl: c?.mbl_number,
                        vessel: c ? [c.vessel, c.voyage].filter(Boolean).join(" / ") : null,
                        pol: c?.pol,
                        pod: c?.pod,
                        job: subject.kind === "job" ? subject.ref : null,
                        agentName,
                        hbl: st.hbl,
                      },
                      pnl.houses,
                      f,
                      settling
                    ),
                  })
                }
                disabled={busy !== null}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
              >
                <Mail size={13} /> Email the statement to {agentName}
              </button>
              <span className="text-[11px] text-text-muted">Each house's revenue, cost and profit, the share, and the note.</span>
            </div>
          </>
        )}
      </div>

      {mail && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={mail}
          onClose={() => setMail(null)}
          onSent={() => setMail(null)}
        />
      )}
    </section>
  );
}

/** This console agreed differently: a per cent, 0 for none, or back to the agreement. */
function ConsoleOverride({ value, busy, onSave }: { value: number | null; busy: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => setV(value === null ? "" : String(value)), [value]);
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <label className="block">
        <span className="mb-0.5 block text-[11px] text-text-secondary">This console only</span>
        <span className="flex items-center gap-1">
          <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder="—" aria-label="This console's share, per cent" className="h-8 w-20 text-right text-[12.5px] tabular-nums" />
          <span className="text-[12.5px] text-text-secondary">%</span>
        </span>
      </label>
      <button
        type="button"
        onClick={() => {
          const n = Number(v);
          if (v.trim() !== "" && n >= 0 && n <= 100) onSave(n);
        }}
        disabled={busy || v.trim() === ""}
        className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
      >
        Agree it for this console
      </button>
      {value !== null && (
        <button type="button" onClick={() => onSave(null)} disabled={busy} className="h-8 px-2 text-[12px] text-text-muted hover:text-text-primary">
          Back to the agreement
        </button>
      )}
      <p className="w-full text-[11px] text-text-muted">0 for no share on this console.</p>
    </div>
  );
}
