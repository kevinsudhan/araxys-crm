import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Download, Loader2, Mail, Send } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { arrivalHtml, arrivalSubject } from "../lib/arrivalNotice";
import { COMPANY } from "../lib/company";
import { OUTTURN_LABEL, outturnHtml, outturnIssues, outturnState, outturnSubject, outturnSummary } from "../lib/outturn";
import { outturnFileName, outturnPdfBytes, renderOutturnReportPdf } from "../lib/documents/outturnReportPdf";
import { useTablesChanges } from "../lib/useTableChanges";
import type { Console } from "../services/consoles";
import {
  checkSending,
  destinationFor,
  markArrivalSent,
  markOutturnSent,
  outturnConsole,
  recordOutturn,
  saveArrivalAuto,
  sendWaitingNow,
  type DestinationData,
  type DestinationHouse,
} from "../services/destination";
import { listPeople, type Person } from "../services/enquiries";
import type { Condition } from "../services/warehouse";
import ComposeMail from "./ComposeMail";
import Select from "./Select";

const when = (iso: string) => formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * An import console at destination (126): every consignee's arrival notice —
 * from the desk's Outlook, or by the scheduler on its own before the ETA —
 * the outturn at destuffing and its report to the origin agent, and where
 * each house's release stands before its DO. The rules are
 * lib/arrivalNotice.ts, lib/outturn.ts and lib/receivedHbl.ts.
 */
export default function ConsoleDestination({ console: c, jobs, onChanged }: { console: Console; jobs: number; onChanged: () => void }) {
  const { session } = useAuth();
  const [data, setData] = useState<DestinationData | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ kind: "arrival" | "outturn"; house?: DestinationHouse; to: string; subject: string; body: string; attachments?: Array<{ name: string; contentType: string; bytes: Uint8Array }> } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await destinationFor(c));
    } catch (e) {
      setError(failureText(e, "Could not gather the houses.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or its jobs change
  }, [c.id, c.updated_at, jobs]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void listPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);
  useTablesChanges(
    [
      ["warehouse_receipts", null],
      ["received_house_bills", null],
      ["arrival_notice_sends", null],
      ["shipments", null],
    ],
    () => void load()
  );

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const said = await fn();
      if (said) setNote(said);
      await load();
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const houses = data?.houses ?? [];
  const told = houses.filter((h) => h.arrivalSentAt).length;
  const waiting = houses.filter((h) => !h.arrivalSentAt && h.email).length;
  const lastRefusal = data?.sends.find((s) => s.status === "failed");
  const containers = [...new Set(houses.flatMap((h) => h.arrival.containers))];
  const oc = outturnConsole(c, containers);
  const outturns = houses.map((h) => h.outturn);
  const os = outturnSummary(outturns);
  const oIssues = outturnIssues(oc, outturns);
  const card = "rounded-lg border border-border p-3";

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">At destination</h3>
      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}
      {note && <p className="mb-2 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">{note}</p>}

      {!data ? (
        !error && (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Gathering the houses…
          </p>
        )
      ) : !houses.length ? (
        <p className="text-[12px] text-text-muted">No jobs on the console yet.</p>
      ) : (
        <div className="space-y-3">
          {/* ---- arrival notices ---- */}
          <div className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-[12.5px] font-medium text-text-primary">
                Arrival notices <span className="font-normal text-text-secondary">· {told} of {houses.length} consignees told</span>
              </p>
              <button
                type="button"
                onClick={() =>
                  void act("now", async () => {
                    const r = await sendWaitingNow(c);
                    if (!r.ok && r.error) throw new Error(r.error);
                    const failed = (r.outcomes ?? []).filter((o) => o.status === "failed");
                    if (r.stopped && !r.sent) throw new Error(r.stopped);
                    return `${r.sent ?? 0} sent by the CRM${failed.length ? `; ${failed.length} refused: ${failed[0].error}` : ""}${r.stopped ? `. ${r.stopped}` : ""}`;
                  })
                }
                disabled={busy !== null || !waiting}
                title={!waiting ? "Every consignee with an address has been told" : undefined}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
              >
                {busy === "now" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send the {waiting} waiting now
              </button>
            </div>

            <AutoSettings c={c} people={people} busy={busy} onSave={(v) => void act("auto", async () => {
              await saveArrivalAuto(c, v);
              return v.auto ? `The CRM will send each waiting notice ${v.days} day${v.days === 1 ? "" : "s"} before the ETA, from ${v.from}.` : "Automatic notices off for this console.";
            })} onCheck={() => void act("check", async () => {
              const r = await checkSending();
              if (!r.ok) throw new Error(r.error ?? "Microsoft does not let the CRM app send yet.");
              return "Microsoft lets the CRM app send: automatic notices will go.";
            })} />
            {lastRefusal && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> The last automatic send was refused {when(lastRefusal.created_at)}: {lastRefusal.error}
              </p>
            )}

            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                    <th className="py-1.5 pr-2 font-medium">Job</th>
                    <th className="py-1.5 pr-2 font-medium">Consignee</th>
                    <th className="py-1.5 pr-2 font-medium">House B/L</th>
                    <th className="py-1.5 font-medium">Notice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {houses.map((h) => (
                    <tr key={h.shipmentId} className="align-top">
                      <td className="py-1.5 pr-2">
                        <Link to={`/shipments/${h.shipmentId}/bill`} className="font-mono text-text-accent hover:underline">
                          {h.ref}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-2">
                        {h.arrival.consignee || "—"}
                        <span className="block text-[11px] text-text-muted">{h.email || "no email on the job or customer"}</span>
                      </td>
                      <td className="py-1.5 pr-2 font-mono">{h.arrival.hblNo || "—"}</td>
                      <td className="py-1.5">
                        {h.arrivalSentAt ? (
                          <span className="flex items-center gap-1 text-[11.5px] text-text-success">
                            <Check size={12} /> {when(h.arrivalSentAt)} {h.arrivalVia === "auto" ? "by the CRM" : "by the desk"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setCompose({ kind: "arrival", house: h, to: h.email, subject: arrivalSubject(h.arrival), body: arrivalHtml(h.arrival, COMPANY, session?.name) })}
                            disabled={busy !== null}
                            className="flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
                          >
                            <Mail size={12} /> Email
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- the outturn ---- */}
          <div className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-[12.5px] font-medium text-text-primary">
                Outturn{" "}
                <span className={`font-normal ${os.clean ? "text-text-success" : os.exceptions ? "text-text-warning" : "text-text-secondary"}`}>
                  · {os.clean ? "clean" : os.exceptions ? `${os.exceptions} exception${os.exceptions === 1 ? "" : "s"}` : `${os.tallied} of ${houses.length} tallied`}
                </span>
              </p>
              <button type="button" onClick={() => renderOutturnReportPdf(oc, outturns).save(outturnFileName(oc))} className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary">
                <Download size={13} /> PDF
              </button>
              <button
                type="button"
                onClick={() =>
                  setCompose({
                    kind: "outturn",
                    to: data.agent?.email ?? "",
                    subject: outturnSubject(oc, outturns),
                    body: outturnHtml(oc, outturns, data.agent?.name ?? "", true),
                    attachments: [{ name: outturnFileName(oc), contentType: "application/pdf", bytes: outturnPdfBytes(oc, outturns) }],
                  })
                }
                disabled={busy !== null}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                <Mail size={13} /> Email the origin agent
              </button>
            </div>
            {c.outturn_sent_at && (
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-text-success">
                <Check size={12} /> Sent {when(c.outturn_sent_at)}
                {c.outturn_sent_to ? ` to ${c.outturn_sent_to}` : ""}
              </p>
            )}
            {oIssues.length > 0 && <p className="mt-1 text-[11.5px] text-text-warning">{oIssues.join(" · ")}</p>}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[42rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                    <th className="py-1.5 pr-2 font-medium">House B/L</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Manifested</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Landed</th>
                    <th className="py-1.5 font-medium">Outturn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {houses.map((h) => (
                    <OutturnRow key={h.shipmentId} h={h} c={c} busy={busy} onRecord={(v) => void act(`out:${h.shipmentId}`, async () => {
                      await recordOutturn(h, v);
                      return `${h.ref}: ${v.pieces} landed, ${v.condition}.`;
                    })} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- the release, house by house ---- */}
          <div className={card}>
            <p className="text-[12.5px] font-medium text-text-primary">
              Release and DO{" "}
              <span className="font-normal text-text-secondary">
                · {houses.filter((h) => h.doIssuedOn).length} DO issued, {houses.filter((h) => !h.doIssuedOn && h.release?.ready).length} ready
              </span>
            </p>
            <ul className="mt-2 divide-y divide-border">
              {houses.map((h) => (
                <li key={h.shipmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[12px]">
                  <Link to={`/shipments/${h.shipmentId}/bill`} className="w-28 shrink-0 font-mono text-text-accent hover:underline">
                    {h.ref}
                  </Link>
                  {!h.release ? (
                    <span className="text-text-muted">Their B/L is not saved on the job yet</span>
                  ) : (
                    <>
                      <span className="flex flex-1 flex-wrap gap-1">
                        {h.release.items.map((i) => (
                          <span key={i.key} title={i.label} className={`rounded-full px-2 py-0.5 text-[10.5px] ${i.done ? "bg-bg-success text-text-success" : "bg-surface-2 text-text-muted"}`}>
                            {i.done ? "✓ " : ""}
                            {SHORT[i.key] ?? i.label}
                          </span>
                        ))}
                      </span>
                      <span className={`text-[11.5px] font-medium ${h.doIssuedOn ? "text-text-success" : h.release.ready ? "text-text-primary" : "text-text-muted"}`}>
                        {h.doIssuedOn ? `DO issued ${formatDate(h.doIssuedOn, { day: "numeric", month: "short" })}` : h.release.ready ? "Ready for the DO" : `${h.release.items.filter((i) => !i.done).length} to do`}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-text-muted">Each DO is issued on its job's Bill tab once every step is done.</p>
          </div>
        </div>
      )}

      {compose && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={{ to: compose.to, subject: compose.subject, body: compose.body }}
          attachments={compose.attachments}
          onClose={() => setCompose(null)}
          onSent={({ to }) => {
            const done = compose;
            setCompose(null);
            void act("sent", async () => {
              if (done.kind === "arrival" && done.house) await markArrivalSent(done.house, to.join(", "));
              else await markOutturnSent(c, to.join(", "));
              return done.kind === "arrival" ? "Arrival notice sent." : "Outturn report sent.";
            });
          }}
        />
      )}
    </section>
  );
}

/** The release checklist's steps, short enough for a chip. */
const SHORT: Record<string, string> = {
  final: "Final B/L",
  originals_surrendered_on: "Original surrendered",
  telex_received_on: "Telex release",
  console_do: "Line's DO",
  console_destuffed: "Destuffed",
  charges_cleared_on: "Charges paid",
};

function AutoSettings({ c, people, busy, onSave, onCheck }: { c: Console; people: Person[]; busy: string | null; onSave: (v: { auto: boolean; from: string; days: number }) => void; onCheck: () => void }) {
  const [from, setFrom] = useState(c.arrival_from ?? "");
  const [days, setDays] = useState(c.arrival_days ?? 2);
  useEffect(() => {
    setFrom(c.arrival_from ?? "");
    setDays(c.arrival_days ?? 2);
  }, [c.arrival_from, c.arrival_days]);
  const auto = Boolean(c.arrival_auto);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 px-3 py-2">
      <label className="flex items-center gap-2 pb-1.5 text-[12px] text-text-primary">
        <input
          type="checkbox"
          checked={auto}
          disabled={busy !== null || (!auto && !from)}
          onChange={(e) => onSave({ auto: e.target.checked, from, days })}
        />
        Send automatically
      </label>
      <div className="w-60">
        <span className="mb-0.5 block text-[11px] text-text-secondary">From the mailbox</span>
        <Select
          label="From the mailbox"
          className="w-full"
          value={from}
          options={[{ value: "", label: "Choose a mailbox" }, ...people.filter((p) => p.email).map((p) => ({ value: p.email, label: p.email, hint: p.full_name }))]}
          onChange={(v) => {
            setFrom(v);
            if (auto && v) onSave({ auto, from: v, days });
          }}
        />
      </div>
      <div className="w-36">
        <span className="mb-0.5 block text-[11px] text-text-secondary">Days before the ETA</span>
        <Select
          label="Days before the ETA"
          className="w-full"
          value={String(days)}
          options={[0, 1, 2, 3, 4, 5, 7].map((n) => ({ value: String(n), label: n === 0 ? "On the ETA" : `${n} day${n === 1 ? "" : "s"}` }))}
          onChange={(v) => {
            setDays(Number(v));
            if (auto) onSave({ auto, from, days: Number(v) });
          }}
        />
      </div>
      <button type="button" onClick={onCheck} disabled={busy !== null} className="h-8 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-60">
        {busy === "check" ? <Loader2 size={13} className="animate-spin" /> : "Can the CRM send?"}
      </button>
      <p className="w-full text-[11px] text-text-muted">
        {auto
          ? `On: every half hour the CRM sends each waiting notice from ${c.arrival_from}, once the ETA${c.eta ? ` (${formatDate(c.eta, { day: "numeric", month: "short" })})` : ""} is within ${c.arrival_days} day${c.arrival_days === 1 ? "" : "s"}.`
          : "Off: send each notice with Email below, or switch this on for the CRM to send them before the ETA."}
      </p>
    </div>
  );
}

function OutturnRow({ h, c, busy, onRecord }: { h: DestinationHouse; c: Console; busy: string | null; onRecord: (v: { pieces: number; condition: Condition; remarks: string; cfs: string; on: string | null }) => void }) {
  const o = h.outturn;
  const st = outturnState(o);
  const [pieces, setPieces] = useState(o.manifestedPkgs === null ? "" : String(o.manifestedPkgs));
  const [condition, setCondition] = useState<Condition>("good");
  const [remarks, setRemarks] = useState("");
  return (
    <tr className="align-top">
      <td className="py-1.5 pr-2">
        <span className="font-mono">{o.hblNo || o.ref}</span>
        <span className="block text-[11px] text-text-secondary">{o.consignee}</span>
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{o.manifestedPkgs === null ? "—" : `${o.manifestedPkgs} ${o.packageType}`.trim()}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{o.landedPkgs === null ? "—" : o.landedPkgs}</td>
      <td className="py-1.5">
        {st === "not_tallied" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={pieces} onChange={(e) => setPieces(e.target.value)} inputMode="numeric" aria-label="Packages landed" className="h-7 w-16 text-right text-[12px]" />
            <select value={condition} onChange={(e) => setCondition(e.target.value as Condition)} aria-label="Condition" className="h-7 text-[12px]">
              {(["good", "damaged", "short", "wet"] as Condition[]).map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks" className="h-7 w-36 text-[12px]" />
            <button
              type="button"
              onClick={() => {
                const n = Number(pieces);
                if (!Number.isFinite(n) || n < 0 || pieces.trim() === "") return;
                onRecord({ pieces: n, condition, remarks, cfs: c.cfs_name ?? "", on: c.destuffed_on ?? todayIst() });
              }}
              disabled={busy !== null || pieces.trim() === ""}
              className="h-7 rounded-lg border border-border px-2.5 text-[11.5px] text-text-primary hover:border-border-strong disabled:opacity-60"
            >
              Record
            </button>
          </div>
        ) : (
          <span className={`text-[11.5px] font-medium ${st === "clean" ? "text-text-success" : "text-text-warning"}`}>
            {OUTTURN_LABEL[st]}
            {o.conditions.filter((x) => x !== "good").length > 0 && ` (${o.conditions.filter((x) => x !== "good").join(", ")})`}
            {o.remarks && <span className="block font-normal text-text-secondary">{o.remarks}</span>}
          </span>
        )}
      </td>
    </tr>
  );
}
