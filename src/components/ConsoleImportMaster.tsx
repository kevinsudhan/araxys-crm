import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Download, FileSearch, Loader2, Mail, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { COMPANY } from "../lib/company";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { manifestTotals } from "../lib/consoleManifest";
import {
  cfsHtml,
  cfsIssues,
  cfsSubject,
  checkMasterCopy,
  clearedWith,
  copyIssues,
  importProgress,
  lineDoState,
  releaseInHand,
  stepsFor,
  type ImportStep,
} from "../lib/importMaster";
import { RELEASE_LABEL, type MasterRelease } from "../lib/masterBill";
import { cfsNominationFileName, cfsNominationPdfBytes, renderCfsNominationPdf } from "../lib/documents/cfsNominationPdf";
import type { Bill } from "../services/bills";
import type { Console } from "../services/consoles";
import {
  consoleBills,
  copyOf,
  importConsole,
  markCfsNominated,
  markDestuffed,
  markLineDo,
  markLinePaid,
  markReleaseInHand,
  readMasterCopy,
  saveCfs,
  saveLineDoValidity,
  setReleasedAs,
  undoStep,
} from "../services/importMaster";
import { masterFor, type MasterInputs } from "../services/masterBill";
import ComposeMail from "./ComposeMail";
import Select from "./Select";

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const when = (iso: string | null) => (iso ? formatDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "");
const ourName = COMPANY.legalName.toUpperCase();

/**
 * An import console's master B/L at this end (120): the copy read and
 * checked, the CFS nominated, the release in hand, the line paid, its DO
 * collected, the box destuffed. Each is a date on the console; the houses'
 * DOs wait for the last two. The rules are lib/importMaster.ts. On a co-load
 * (121) the co-loader stands where the line does, and the CFS is theirs.
 */
export default function ConsoleImportMaster({ console: c, jobs, onChanged }: { console: Console; jobs: number; onChanged: () => void }) {
  const { session } = useAuth();
  const [inputs, setInputs] = useState<MasterInputs | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string; attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, b] = await Promise.all([masterFor(c), consoleBills(c).catch(() => [] as Bill[])]);
      setInputs(m);
      setBills(b);
    } catch (e) {
      setError(failureText(e, "Could not gather the console's boxes and house bills.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or its jobs change
  }, [c.id, c.updated_at, jobs]);
  useEffect(() => {
    void load();
  }, [load]);

  const ic = importConsole(c);
  const progress = importProgress(ic);
  const coload = Boolean(ic.coload);
  const who = clearedWith(ic);
  const Who = coload ? "Co-loader" : "Line";
  const copy = copyOf(c);
  const boxes = inputs?.boxes ?? [];
  const totals = inputs ? manifestTotals(inputs.lines) : { packages: 0, grossKg: 0, cbm: 0 };
  const rows = copy ? checkMasterCopy(ic, copy, boxes, { packages: totals.packages, grossKg: totals.grossKg, cbm: totals.cbm }, ourName) : [];
  const issues = copy ? copyIssues(ic, copy, inputs?.houseBillNos ?? [], ourName) : [];
  const differ = rows.filter((r) => r.state === "differs" || r.state === "missing_on_bill").length;
  const doState = lineDoState(ic, todayIst());

  // What is being typed, reset when the console is read again.
  const [cfs, setCfs] = useState(ic.cfs_name);
  const [ref, setRef] = useState(ic.release_in_hand_ref);
  const [invoice, setInvoice] = useState(ic.line_invoice_no);
  const [charges, setCharges] = useState(ic.line_charges_inr === null ? "" : String(ic.line_charges_inr));
  const [doNo, setDoNo] = useState(ic.line_do_no);
  const [validTill, setValidTill] = useState(ic.line_do_valid_till ?? "");
  const [destuffed, setDestuffed] = useState(ic.destuffed_on ?? todayIst());
  useEffect(() => {
    setCfs(ic.cfs_name);
    setRef(ic.release_in_hand_ref);
    setInvoice(ic.line_invoice_no);
    setCharges(ic.line_charges_inr === null ? "" : String(ic.line_charges_inr));
    setDoNo(ic.line_do_no);
    setValidTill(ic.line_do_valid_till ?? "");
    setDestuffed(ic.destuffed_on ?? todayIst());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.updated_at]);

  async function act(key: string, fn: () => Promise<unknown>, said?: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (said) setNote(said);
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const amount = () => {
    const x = parseFloat(charges.replace(/[,₹\s]/g, ""));
    return Number.isFinite(x) && x >= 0 ? x : null;
  };

  function openCfsMail() {
    const file = { name: cfsNominationFileName(ic), contentType: "application/pdf", bytes: cfsNominationPdfBytes(ic, boxes, cfs, ourName) };
    setCompose({ to: inputs?.carrierEmail ?? "", subject: cfsSubject(ic), body: cfsHtml(ic, boxes, cfs, ourName, true), attachments: [file] });
  }

  const field = "h-8 w-full text-[12.5px]";
  const button = "flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60";
  const primary = "flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60";

  /** One step: done or not, when, undo; what it needs underneath. */
  const step = (key: ImportStep, title: string, body: ReactNode, undo = true) => {
    const p = progress[key];
    return (
      <li className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={`grid size-5 shrink-0 place-items-center rounded-full ${p.done ? "bg-bg-success text-text-success" : "bg-surface-2 text-text-muted"}`}>
            {p.done ? <Check size={12} /> : <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <span className={`text-[12.5px] font-medium ${p.done ? "text-text-primary" : "text-text-secondary"}`}>{title}</span>
          {p.on && <span className="text-[11.5px] text-text-muted">{when(p.on)}</span>}
          {p.done && p.on && undo && (
            <button type="button" disabled={busy !== null} onClick={() => void act(`undo:${key}`, () => undoStep(c, key), "Taken back.")} className="text-text-muted hover:text-text-danger disabled:opacity-40" aria-label={`Take back: ${title}`}>
              <X size={12} />
            </button>
          )}
        </div>
        <div className="mt-2 pl-7">{body}</div>
      </li>
    );
  };

  const warn = (list: string[]) =>
    list.length > 0 && (
      <ul className="mt-2 space-y-1 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
        {list.map((x) => (
          <li key={x} className="flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {x}
          </li>
        ))}
      </ul>
    );

  const release = c.mbl_release ?? null;

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{coload ? "The co-loader's B/L at this end" : "Master B/L at this end"}</h3>

      <ol className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Master B/L at this end">
        {stepsFor(ic).map((s) => (
          <li key={s.key} className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium ${progress[s.key].done ? "bg-brand text-white" : "bg-surface-2 text-text-muted"}`}>
            {progress[s.key].done && <Check size={11} />}
            {s.label}
          </li>
        ))}
      </ol>

      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}
      {note && <p className="mb-2 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">{note}</p>}

      <ol className="space-y-2">
        {/* ---- 1 the copy ---- */}
        {step(
          "copy",
          coload ? "The co-loader's B/L copy, from the origin agent" : "Master B/L copy from the origin agent",
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f)
                  void act("read", async () => {
                    const filled = await readMasterCopy(c, f);
                    setNote(filled.length ? `Read. Filled on the console: ${filled.join(", ")}.` : "Read and checked below.");
                  });
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className={button}>
              {busy === "read" ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
              {copy ? "Read a newer copy" : "Read the copy (PDF or picture)"}
            </button>
            {!copy && <p className="mt-1.5 text-[12px] text-text-muted">It is checked against the console and its houses, and fills what the console leaves blank.</p>}
            {copy && (
              <>
                {warn(issues)}
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                        <th className="py-1.5 pr-2 font-medium">On the bill</th>
                        <th className="py-1.5 pr-2 font-medium">The copy</th>
                        <th className="py-1.5 pr-2 font-medium">Ours</th>
                        <th className="py-1.5 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rows.map((r) => (
                        <tr key={r.key}>
                          <td className="py-1.5 pr-2 text-text-secondary">{r.label}</td>
                          <td className="py-1.5 pr-2">{r.theirs || <span className="text-text-muted">—</span>}</td>
                          <td className="py-1.5 pr-2">{r.ours || <span className="text-text-muted">—</span>}</td>
                          <td className="py-1.5 text-right text-[11px] font-medium">
                            {r.state === "same" ? (
                              <span className="text-text-success">Agrees</span>
                            ) : r.state === "differs" ? (
                              <span className="text-text-danger">Differs</span>
                            ) : r.state === "missing_on_bill" ? (
                              <span className="text-text-danger">Not on the copy</span>
                            ) : (
                              <span className="text-text-warning">Not on our side</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[11px] text-text-muted">
                  {differ ? `${differ} to take up with the origin agent.` : "Agrees with the console and its houses."} Ours: the console, the jobs' boxes, the {inputs?.lines.length ?? 0} house bill
                  {inputs?.lines.length === 1 ? "" : "s"}.
                </p>
              </>
            )}
          </>,
          false
        )}

        {/* ---- 2 the CFS: ours to nominate, or on a co-load theirs to note ---- */}
        {coload ? step(
          "cfs",
          ic.cfs_nominated_at ? `Their CFS: ${ic.cfs_name || "—"}` : "Note the co-loader's CFS",
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[14rem] flex-1">
              <span className="mb-0.5 block text-[11px] text-text-secondary">CFS</span>
              <input value={cfs} onChange={(e) => setCfs(e.target.value)} onBlur={() => cfs.trim() !== ic.cfs_name && void act("cfs", () => saveCfs(c, cfs))} placeholder="Where they destuff the box" className={field} />
            </label>
            {!ic.cfs_nominated_at && (
              <button type="button" onClick={() => void act("cfsdone", () => markCfsNominated(c, cfs, ""))} disabled={!cfs.trim() || busy !== null} className={primary}>
                <Check size={13} /> Noted
              </button>
            )}
          </div>
        ) : step(
          "cfs",
          ic.cfs_nominated_at ? `CFS nominated: ${ic.cfs_name || "—"}` : "Nominate the CFS to the line",
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[14rem] flex-1">
                <span className="mb-0.5 block text-[11px] text-text-secondary">CFS</span>
                <input value={cfs} onChange={(e) => setCfs(e.target.value)} onBlur={() => cfs.trim() !== ic.cfs_name && void act("cfs", () => saveCfs(c, cfs))} placeholder="Where the box is destuffed" className={field} />
              </label>
              <button type="button" onClick={() => renderCfsNominationPdf(ic, boxes, cfs, ourName).save(cfsNominationFileName(ic))} disabled={!inputs || !cfs.trim()} className={button}>
                <Download size={13} /> Letter
              </button>
              <button type="button" onClick={openCfsMail} disabled={!inputs || !cfs.trim() || busy !== null} className={primary}>
                <Mail size={13} /> Email the line
              </button>
              {!ic.cfs_nominated_at && (
                <button type="button" onClick={() => void act("cfsdone", () => markCfsNominated(c, cfs, ""))} disabled={!cfs.trim() || busy !== null} className={button}>
                  Nominated another way
                </button>
              )}
            </div>
            {!ic.cfs_nominated_at && inputs && warn(cfsIssues(ic, cfs, boxes))}
            {ic.cfs_nominated_to && <p className="mt-1.5 text-[11.5px] text-text-muted">Sent to {ic.cfs_nominated_to}</p>}
          </>
        )}

        {/* ---- 3 the release ---- */}
        {step(
          "release",
          release ? releaseInHand(ic, release).label : "Release in hand",
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <span className="mb-0.5 block text-[11px] text-text-secondary">Released as</span>
              <Select
                label="Released as"
                className="w-full"
                value={release ?? ""}
                options={[{ value: "", label: "Not said yet" }, ...(Object.keys(RELEASE_LABEL) as MasterRelease[]).map((k) => ({ value: k, label: RELEASE_LABEL[k] }))]}
                onChange={(v) => v && void act("releaseas", () => setReleasedAs(c, v as MasterRelease))}
              />
            </div>
            {release && release !== "seaway" && (
              <>
                <label className="block min-w-[14rem] flex-1">
                  <span className="mb-0.5 block text-[11px] text-text-secondary">{releaseInHand(ic, release).ref}</span>
                  <input value={ref} onChange={(e) => setRef(e.target.value)} className={`${field} font-mono`} />
                </label>
                {!ic.release_in_hand_at && (
                  <button type="button" onClick={() => void act("inhand", () => markReleaseInHand(c, ref))} disabled={busy !== null || !ref.trim()} className={primary}>
                    <Check size={13} /> In hand today
                  </button>
                )}
              </>
            )}
            {release === "original" && c.mbl_originals ? <span className="pb-1.5 text-[11.5px] text-text-muted">{c.mbl_originals} of {c.mbl_originals} issued; one is surrendered to the line</span> : null}
          </div>
        )}

        {/* ---- 4 the line's charges ---- */}
        {step(
          "paid",
          `${Who}'s charges paid`,
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block w-44">
                <span className="mb-0.5 block text-[11px] text-text-secondary">{Who}'s invoice no</span>
                <input value={invoice} onChange={(e) => setInvoice(e.target.value)} className={`${field} font-mono`} />
              </label>
              <label className="block w-36">
                <span className="mb-0.5 block text-[11px] text-text-secondary">Amount ₹</span>
                <input value={charges} onChange={(e) => setCharges(e.target.value)} inputMode="decimal" className={`${field} text-right tabular-nums`} />
              </label>
              {!ic.line_paid_at && (
                <button type="button" onClick={() => void act("paid", () => markLinePaid(c, invoice, amount()))} disabled={busy !== null} className={primary}>
                  <Check size={13} /> Paid today
                </button>
              )}
            </div>
            {bills.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[12px] text-text-secondary">
                {bills.map((b) => (
                  <li key={b.id}>
                    In Accounts: <span className="font-mono">{b.bill_no}</span> · {b.partner_label ?? ""} · ₹{Number(b.total_inr).toLocaleString("en-IN")} · {b.status.replace("_", " ")}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ---- 5 the line's DO ---- */}
        {step(
          "do",
          `${Who}'s delivery order collected`,
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block w-44">
                <span className="mb-0.5 block text-[11px] text-text-secondary">DO no</span>
                <input value={doNo} onChange={(e) => setDoNo(e.target.value)} className={`${field} font-mono`} />
              </label>
              <label className="block w-40">
                <span className="mb-0.5 block text-[11px] text-text-secondary">Valid till</span>
                <input
                  type="date"
                  value={validTill}
                  onChange={(e) => setValidTill(e.target.value)}
                  onBlur={() => ic.line_do_at && validTill !== (ic.line_do_valid_till ?? "") && void act("validity", () => saveLineDoValidity(c, validTill || null))}
                  className={field}
                />
              </label>
              {!ic.line_do_at && (
                <button type="button" onClick={() => void act("do", () => markLineDo(c, doNo, validTill || null))} disabled={busy !== null || !doNo.trim()} className={primary}>
                  <Check size={13} /> Collected today
                </button>
              )}
            </div>
            {doState.state === "expired" && warn([`The DO from ${who} lapsed ${-(doState.days ?? 0)} day${doState.days === -1 ? "" : "s"} ago and the box is not destuffed: have it revalidated`])}
            {doState.state === "last_day" && warn([`The DO from ${who} is good for today only and the box is not destuffed`])}
          </>
        )}

        {/* ---- 6 destuffed ---- */}
        {step(
          "destuffed",
          "Box destuffed at the CFS",
          <div className="flex flex-wrap items-end gap-2">
            <label className="block w-40">
              <span className="mb-0.5 block text-[11px] text-text-secondary">On</span>
              <input type="date" value={destuffed} max={todayIst()} onChange={(e) => setDestuffed(e.target.value)} className={field} />
            </label>
            {!ic.destuffed_on && (
              <button type="button" onClick={() => void act("destuffed", () => markDestuffed(c, destuffed), "Recorded. The houses' DOs can be issued from their jobs.")} disabled={busy !== null || !destuffed} className={primary}>
                <Check size={13} /> Record
              </button>
            )}
            <span className="pb-1.5 text-[11.5px] text-text-muted">Each house's DO waits for this and the DO from {who}.</span>
          </div>
        )}
      </ol>

      {compose && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={{ to: compose.to, subject: compose.subject, body: compose.body }}
          attachments={compose.attachments}
          onClose={() => setCompose(null)}
          onSent={({ to }) => {
            setCompose(null);
            void act("nominated", () => markCfsNominated(c, cfs, to.join(", ")), "CFS nomination sent.");
          }}
        />
      )}
    </section>
  );
}
