import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, FileSearch, Loader2, Mail, Send } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { COMPANY } from "../lib/company";
import {
  MASTER_STAGES,
  RELEASE_LABEL,
  RELEASE_REF_HINT,
  checkMasterDraft,
  defaultTerms,
  draftProblems,
  issuerOf,
  masterCorrections,
  siData,
  siHtml,
  siIssues,
  siSubject,
  stageIndex,
  termsFrom,
  type MasterRelease,
  type SiTerms,
} from "../lib/masterBill";
import { manifestTotals } from "../lib/consoleManifest";
import { masterSiFileName, masterSiPdfBytes, renderMasterSiPdf } from "../lib/documents/masterSiPdf";
import { manifestFileName, manifestPdfBytes } from "../lib/documents/manifestPdf";
import type { Console } from "../services/consoles";
import { manifestConsole } from "../services/consoleManifest";
import { approveDraft, draftOf, markIssued, markReleased, markSiSent, masterConsole, masterFor, readMasterDraft, saveBookingNo, saveSiTerms, type MasterInputs } from "../services/masterBill";
import ComposeMail from "./ComposeMail";
import Select from "./Select";

/**
 * The console's master B/L with the line (119): the instruction built from
 * the jobs and mailed with the house list, the line's draft read and checked,
 * then issued and released. Each step is recorded on the console; the rules
 * are lib/masterBill.ts. On a co-load (121) the same, with the co-loader in
 * the line's place and their B/L to us as the master.
 */
export default function ConsoleMasterBill({ console: c, jobs, onChanged }: { console: Console; jobs: number; onChanged: () => void }) {
  const { session } = useAuth();
  const [inputs, setInputs] = useState<MasterInputs | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ kind: "si" | "corrections"; to: string; subject: string; body: string; attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInputs(await masterFor(c));
    } catch (e) {
      setError(failureText(e, "Could not gather the console's boxes and house bills.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or its jobs change
  }, [c.id, c.updated_at, jobs]);
  useEffect(() => {
    void load();
  }, [load]);

  const mc = masterConsole(c, inputs?.coloader?.name);
  const coload = Boolean(mc.coload);
  const who = coload ? "the co-loader" : "the line";
  const defaults = useMemo(() => defaultTerms(mc, inputs?.agent ?? null, COMPANY), [mc.pol, inputs?.agent]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = termsFrom(c.mbl_si as Partial<SiTerms> | null, defaults);
  const [terms, setTerms] = useState<SiTerms>(saved);
  const [dirty, setDirty] = useState(false);
  // The saved terms when nothing is being typed: another person's save, or the agent appointed.
  useEffect(() => {
    if (!dirty) setTerms(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(saved), dirty]);
  const edit = (patch: Partial<SiTerms>) => {
    setTerms((t) => ({ ...t, ...patch }));
    setDirty(true);
  };

  const [booking, setBooking] = useState(c.carrier_booking_no ?? "");
  useEffect(() => setBooking(c.carrier_booking_no ?? ""), [c.carrier_booking_no]);

  const totals = inputs ? manifestTotals(inputs.lines) : { bills: 0, packages: 0, grossKg: 0, cbm: 0, containers: [], collect: 0 };
  const si = siData({ ...mc, carrier_booking_no: booking }, terms, inputs?.boxes ?? [], { packages: totals.packages, grossKg: totals.grossKg, cbm: totals.cbm });
  const issues = inputs ? siIssues({ ...mc, carrier_booking_no: booking }, si, inputs.boxes, inputs.houseBillNos) : [];
  const stage = c.mbl_stage ?? "none";
  const at = stageIndex(stage);
  const draft = draftOf(c);
  const rows = draft ? checkMasterDraft(si, draft) : [];
  const problems = draftProblems(rows);

  const [issue, setIssue] = useState<{ mbl: string; date: string; release: MasterRelease; originals: number }>({
    mbl: c.mbl_number ?? "",
    date: c.mbl_date ?? "",
    release: c.mbl_release ?? "original",
    originals: c.mbl_originals ?? 3,
  });
  const [releaseRef, setReleaseRef] = useState(c.mbl_release_ref ?? "");
  // What another person recorded, when the console is read again.
  useEffect(() => {
    setIssue({ mbl: c.mbl_number ?? "", date: c.mbl_date ?? "", release: c.mbl_release ?? "original", originals: c.mbl_originals ?? 3 });
    setReleaseRef(c.mbl_release_ref ?? "");
  }, [c.mbl_number, c.mbl_date, c.mbl_release, c.mbl_originals, c.mbl_release_ref]);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  async function persist() {
    if (dirty) await saveSiTerms(c, terms);
    if (booking.trim() !== (c.carrier_booking_no ?? "")) await saveBookingNo(c, booking);
    setDirty(false);
  }

  function openSiMail() {
    if (!inputs) return;
    const mcNow = { ...mc, carrier_booking_no: booking };
    const files = [
      { name: masterSiFileName(mcNow), contentType: "application/pdf", bytes: masterSiPdfBytes(mcNow, si, terms) },
      { name: manifestFileName(manifestConsole(c), "pdf"), contentType: "application/pdf", bytes: manifestPdfBytes(manifestConsole(c), inputs.lines, inputs.provisional) },
    ];
    setCompose({ kind: "si", to: inputs.carrierEmail, subject: siSubject(mcNow), body: siHtml(mcNow, si, terms, ["the house list"]), attachments: files });
  }

  const field = "h-8 w-full text-[12.5px]";
  const party = (label: string, nameKey: "shipper_name" | "consignee_name" | "notify_name", addrKey: "shipper_address" | "consignee_address" | "notify_address") => (
    <div className="min-w-0">
      <span className="mb-0.5 block text-[11px] text-text-secondary">{label}</span>
      <input value={terms[nameKey]} onChange={(e) => edit({ [nameKey]: e.target.value })} aria-label={`${label} name`} className={field} />
      <textarea
        value={terms[addrKey]}
        onChange={(e) => edit({ [addrKey]: e.target.value })}
        aria-label={`${label} address`}
        rows={2}
        placeholder="Address"
        className="mt-1 w-full text-[12px]"
      />
    </div>
  );

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{coload ? `B/L from ${issuerOf(mc)}` : "Master B/L with the line"}</h3>

      {/* ---- where it is ---- */}
      <ol className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Master B/L stages">
        {MASTER_STAGES.slice(1).map((s) => {
          const done = stageIndex(s.key) <= at;
          return (
            <li key={s.key} className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium ${done ? "bg-brand text-white" : "bg-surface-2 text-text-muted"}`}>
              {done && <Check size={11} />}
              {s.label}
            </li>
          );
        })}
      </ol>

      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}

      {/* ---- the instruction ---- */}
      <div className="rounded-lg border border-border p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">{coload ? "Co-loader's booking no" : "Line's booking no"}</span>
            <input value={booking} onChange={(e) => setBooking(e.target.value)} onBlur={() => booking.trim() !== (c.carrier_booking_no ?? "") && void act("booking", () => saveBookingNo(c, booking))} className={`${field} font-mono`} />
          </label>
          <div>
            <span className="mb-0.5 block text-[11px] text-text-secondary">Freight</span>
            <Select
              label="Freight"
              className="w-full"
              value={terms.freight_terms}
              options={[
                { value: "prepaid", label: "Prepaid" },
                { value: "collect", label: "Collect" },
              ]}
              onChange={(v) => edit({ freight_terms: v === "collect" ? "collect" : "prepaid" })}
            />
          </div>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Payable at</span>
            <input value={terms.freight_payable_at} onChange={(e) => edit({ freight_payable_at: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Marks and numbers</span>
            <input value={terms.marks_numbers} onChange={(e) => edit({ marks_numbers: e.target.value })} className={field} />
          </label>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {party("Shipper", "shipper_name", "shipper_address")}
          {party("Consignee", "consignee_name", "consignee_address")}
          {party("Notify party", "notify_name", "notify_address")}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Description of goods</span>
            <input value={terms.description} onChange={(e) => edit({ description: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Remarks for {who}</span>
            <input value={terms.remarks} onChange={(e) => edit({ remarks: e.target.value })} placeholder="e.g. Show the HS codes; clean on board" className={field} />
          </label>
        </div>

        {/* ---- the boxes, from the jobs; on a co-load the box is theirs ---- */}
        {coload ? (
          <p className="mt-3 text-[12px] text-text-secondary">
            {totals.bills} house bill{totals.bills === 1 ? "" : "s"} go to {issuerOf(mc)} as one consignment: {totals.packages.toLocaleString("en-IN")} packages ·{" "}
            {totals.grossKg.toLocaleString("en-IN")} kg · {totals.cbm.toLocaleString("en-IN")} CBM. The box is theirs; LCL/LCL.
          </p>
        ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                <th className="py-1.5 pr-2 font-medium">Container</th>
                <th className="py-1.5 pr-2 font-medium">Size / type</th>
                <th className="py-1.5 pr-2 font-medium">Seal</th>
                <th className="py-1.5 pr-2 text-right font-medium">Packages</th>
                <th className="py-1.5 pr-2 text-right font-medium">Gross kg</th>
                <th className="py-1.5 pr-2 text-right font-medium">CBM</th>
                <th className="py-1.5 text-right font-medium">Houses</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(inputs?.boxes ?? []).map((b) => (
                <tr key={b.container_no}>
                  <td className="py-1.5 pr-2 font-mono">{b.container_no}</td>
                  <td className="py-1.5 pr-2">{b.size_type || "—"}</td>
                  <td className={`py-1.5 pr-2 font-mono ${b.seal_no ? "" : "text-text-warning"}`}>{b.seal_no || "no seal"}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{b.packages || "—"}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{b.gross_kg ? b.gross_kg.toLocaleString("en-IN") : "—"}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{b.cbm || "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{b.houses}</td>
                </tr>
              ))}
              {inputs && !inputs.boxes.length && (
                <tr>
                  <td colSpan={7} className="py-2.5 text-[12px] text-text-muted">
                    No container numbers yet: enter each job's box and seal on its Containers tab, and they add up here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-text-muted">
            From the jobs' container lines. {totals.bills} house bill{totals.bills === 1 ? "" : "s"} go with it as the attached list.
          </p>
        </div>
        )}

        {issues.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
            {issues.map((x) => (
              <li key={x} className="flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {x}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {dirty && (
            <button type="button" onClick={() => void act("save", persist)} disabled={busy !== null} className="h-8 rounded-lg border border-border bg-surface-1 px-3 text-[12px] font-medium text-text-primary hover:bg-surface-2">
              Save the instruction
            </button>
          )}
          <button
            type="button"
            onClick={() => renderMasterSiPdf({ ...mc, carrier_booking_no: booking }, si, terms).save(masterSiFileName({ ...mc, carrier_booking_no: booking }))}
            disabled={!inputs}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
          >
            <Download size={13} /> Download the SI
          </button>
          <button
            type="button"
            onClick={() => void act("mail", async () => {
              await persist();
              openSiMail();
            })}
            disabled={!inputs || busy !== null}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy === "mail" ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Email the SI to {who}
          </button>
          {c.si_sent_at && (
            <span className="text-[11.5px] text-text-muted">
              Sent {formatDate(c.si_sent_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
              {c.si_sent_to ? ` to ${c.si_sent_to}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* ---- the line's draft ---- */}
      <div className="mt-3 rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-medium text-text-primary">{coload ? "The co-loader's draft" : "The line's draft"}</p>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void act("read", () => readMasterDraft(c, f));
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
            >
              {busy === "read" ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
              {draft ? "Read a corrected draft" : "Read the draft (PDF or picture)"}
            </button>
          </div>
        </div>

        {!draft ? (
          <p className="mt-1.5 text-[12px] text-text-muted">When {who} sends the draft, read it here: it is checked against the instruction, {coload ? "line by line" : "box by box"}.</p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                    <th className="py-1.5 pr-2 font-medium">On the bill</th>
                    <th className="py-1.5 pr-2 font-medium">{coload ? "Their draft" : "The line's draft"}</th>
                    <th className="py-1.5 pr-2 font-medium">Our instruction</th>
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
                          <span className="text-text-danger">Missing</span>
                        ) : (
                          <span className="text-text-warning">Not ours</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {problems.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setCompose({
                      kind: "corrections",
                      to: inputs?.carrierEmail ?? "",
                      subject: `${siSubject({ ...mc, carrier_booking_no: booking })} — DRAFT MBL CORRECTIONS`,
                      body: `<p>Dear ${(coload ? mc.coloader : c.carrier) || "Sir / Madam"} team,</p><pre style="font-family:inherit;white-space:pre-wrap">${masterCorrections(rows, c.mbl_number)
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")}</pre><p>Kindly send the corrected draft.</p>`,
                      attachments: [],
                    })
                  }
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark"
                >
                  <Send size={13} /> Mail the {problems.length} correction{problems.length === 1 ? "" : "s"} to {who}
                </button>
              )}
              {at < stageIndex("draft_approved") && (
                <button
                  type="button"
                  onClick={() => {
                    if (problems.length && !window.confirm(`The draft still differs in ${problems.length} place${problems.length === 1 ? "" : "s"}. Approve it anyway?`)) return;
                    void act("approve", () => approveDraft(c));
                  }}
                  disabled={busy !== null}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium ${problems.length ? "border border-border text-text-secondary hover:text-text-primary" : "bg-brand text-white hover:bg-brand-dark"}`}
                >
                  <Check size={13} /> {problems.length ? "Approve anyway" : "Approve the draft"}
                </button>
              )}
              {c.mbl_draft_approved_at && (
                <span className="text-[11.5px] text-text-success">
                  Approved {formatDate(c.mbl_draft_approved_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* ---- issued, then released ---- */}
      <div className="mt-3 rounded-lg border border-border p-3">
        <p className="text-[12.5px] font-medium text-text-primary">Issued and released</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">{coload ? "Their B/L no" : "Master B/L no"}</span>
            <input value={issue.mbl} onChange={(e) => setIssue({ ...issue, mbl: e.target.value })} className={`${field} font-mono`} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Date</span>
            <input type="date" value={issue.date} onChange={(e) => setIssue({ ...issue, date: e.target.value })} className={field} />
          </label>
          <div>
            <span className="mb-0.5 block text-[11px] text-text-secondary">Released as</span>
            <Select
              label="Released as"
              className="w-full"
              value={issue.release}
              options={(Object.keys(RELEASE_LABEL) as MasterRelease[]).map((k) => ({ value: k, label: RELEASE_LABEL[k] }))}
              onChange={(v) => setIssue({ ...issue, release: v as MasterRelease })}
            />
          </div>
          {issue.release === "original" && (
            <div>
              <span className="mb-0.5 block text-[11px] text-text-secondary">Originals</span>
              <Select
                label="Originals"
                className="w-full"
                value={String(issue.originals)}
                options={["1", "2", "3"].map((x) => ({ value: x, label: `${x} of ${x}` }))}
                onChange={(v) => setIssue({ ...issue, originals: Number(v) })}
              />
            </div>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void act("issued", () => markIssued(c, { mblNumber: issue.mbl, mblDate: issue.date || null, release: issue.release, originals: issue.originals }))}
            disabled={busy !== null || !issue.mbl.trim()}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60"
          >
            <Check size={13} /> {at >= stageIndex("issued") ? "Update" : "Record as issued"}
          </button>
          {at >= stageIndex("issued") && <span className="text-[11.5px] text-text-muted">Issued: {RELEASE_LABEL[c.mbl_release ?? "original"]}</span>}
        </div>

        {at >= stageIndex("issued") && (
          <div className="mt-3 border-t border-border pt-3">
            <label className="block max-w-xl">
              <span className="mb-0.5 block text-[11px] text-text-secondary">{RELEASE_REF_HINT[c.mbl_release ?? "original"]}</span>
              <input value={releaseRef} onChange={(e) => setReleaseRef(e.target.value)} disabled={c.mbl_release === "seaway"} className={field} />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void act("released", () => markReleased(c, releaseRef))}
                disabled={busy !== null || (c.mbl_release !== "seaway" && !releaseRef.trim())}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                <Send size={13} /> {at >= stageIndex("released") ? "Update the release" : "Released to the agent"}
              </button>
              {c.mbl_released_at && (
                <span className="text-[11.5px] text-text-success">
                  Released {formatDate(c.mbl_released_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                  {c.mbl_release_ref ? ` · ${c.mbl_release_ref}` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {compose && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={{ to: compose.to, subject: compose.subject, body: compose.body }}
          attachments={compose.attachments}
          onClose={() => setCompose(null)}
          onSent={({ to }) => {
            const kind = compose.kind;
            setCompose(null);
            if (kind === "si") void act("sent", () => markSiSent(c, to.join(", ")));
          }}
        />
      )}
    </section>
  );
}
