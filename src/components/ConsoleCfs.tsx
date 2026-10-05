import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Download, Loader2, Mail } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { measureSummary, type HouseMeasure } from "../lib/cfsMeasure";
import { BOX, BOX_TYPES, loadPlan, smallestBox, type BoxType, type LoadPlan } from "../lib/loadPlan";
import { stuffedBoxes, stuffingHtml, stuffingIssues, stuffingSubject } from "../lib/stuffingReport";
import { renderStuffingReportPdf, stuffingReportFileName, stuffingReportPdfBytes } from "../lib/documents/stuffingReportPdf";
import { useTablesChanges } from "../lib/useTableChanges";
import type { Console } from "../services/consoles";
import { applyMeasured, cfsFor, markStuffingReportSent, saveBoxType, saveStuffedOn, stuffingConsole, type CfsData } from "../services/consoleCfs";
import ComposeMail from "./ComposeMail";
import Select from "./Select";

const fig = (n: number | null | undefined, dp = 2) => (n === null || n === undefined ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: dp }));
const signed = (n: number, dp = 3) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: dp })}`;
const inr = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

/** Colours for the houses on the floor plan: distinct, and readable in either theme. */
const HUES = [210, 28, 145, 330, 265, 48, 185, 0];

/**
 * The console at the CFS (125): each house declared against what the CFS
 * received and measured, the load plan of the box from the pieces' sizes, and
 * the stuffing report with the tally. The rules are lib/cfsMeasure.ts,
 * lib/loadPlan.ts and lib/stuffingReport.ts.
 */
export default function ConsoleCfs({ console: c, jobs, sailingBox, onChanged }: { console: Console; jobs: number; sailingBox: BoxType | null; onChanged: () => void }) {
  const { session } = useAuth();
  const [data, setData] = useState<CfsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string; attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> } | null>(null);
  const [stuffedOn, setStuffedOn] = useState(c.stuffed_on ?? "");
  useEffect(() => setStuffedOn(c.stuffed_on ?? ""), [c.stuffed_on]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await cfsFor(c));
    } catch (e) {
      setError(failureText(e, "Could not gather the console's cargo.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or its jobs change
  }, [c.id, c.updated_at, jobs]);
  useEffect(() => {
    void load();
  }, [load]);
  // A receipt, a box line or a piece size changed by anybody (084).
  useTablesChanges(
    [
      ["warehouse_receipts", null],
      ["shipment_containers", null],
      ["enquiry_dimensions", null],
    ],
    () => void load()
  );

  async function act(key: string, fn: () => Promise<unknown>, said?: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (said) setNote(said);
      await load();
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  // The box: the sailing's, the one chosen here, or the smallest the cargo fits.
  const suggested = useMemo(() => (data ? smallestBox(data.cargo) : null), [data]);
  const box: BoxType = sailingBox ?? c.box_type ?? suggested ?? "40HC";
  const plan = useMemo(() => (data ? loadPlan(data.cargo, box) : null), [data, box]);
  const sc = { ...stuffingConsole(c) };
  const boxes = useMemo(() => (data ? stuffedBoxes(data.lines, data.houses) : []), [data]);
  const issues = stuffingIssues(boxes, c.stuffed_on ?? null);
  const summary = data ? measureSummary(data.measures) : null;

  function openReport() {
    const file = { name: stuffingReportFileName(sc), contentType: "application/pdf", bytes: stuffingReportPdfBytes(sc, boxes, c.stuffed_on ?? null) };
    setCompose({ to: data?.agent?.email ?? "", subject: stuffingSubject(sc, c.stuffed_on ?? null), body: stuffingHtml(sc, boxes, c.stuffed_on ?? null, data?.agent?.name ?? "", true), attachments: [file] });
  }

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">At the CFS</h3>
      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}
      {note && <p className="mb-2 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">{note}</p>}

      {!data ? (
        !error && (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Gathering the cargo…
          </p>
        )
      ) : !data.measures.length ? (
        <p className="text-[12px] text-text-muted">No jobs on the console yet.</p>
      ) : (
        <div className="space-y-3">
          {/* ---- declared against measured ---- */}
          <div className="rounded-lg border border-border p-3">
            <p className="text-[12.5px] font-medium text-text-primary">Declared and measured</p>
            {summary && (
              <p className="mt-0.5 text-[12px] text-text-secondary">
                {summary.received} of {data.measures.length} house{data.measures.length === 1 ? "" : "s"} received
                {summary.differ > 0 && <span className="text-text-warning"> · {summary.differ} differ from what was declared</span>}
                {summary.wmChange !== 0 && <> · W/M {signed(summary.wmChange)}</>}
                {summary.inrChange !== 0 && <span className={summary.inrChange > 0 ? "text-text-success" : "text-text-warning"}> · {inr(summary.inrChange)} on the invoices at the quoted rates</span>}
              </p>
            )}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                    <th className="py-1.5 pr-2 font-medium">Job</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Pieces</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Kg</th>
                    <th className="py-1.5 pr-2 text-right font-medium">CBM</th>
                    <th className="py-1.5 pr-2 text-right font-medium">W/M</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Invoice</th>
                    <th className="py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.measures.map((m) => (
                    <MeasureRow key={m.shipmentId} m={m} busy={busy} onUse={() => void act(`use:${m.shipmentId}`, () => applyMeasured(m), `${m.ref}: the CFS's figures are now the job's.`)} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">Declared → received at the CFS (the job's warehouse receipts). The invoice change is the W/M difference at the rate quoted per W/M.</p>
          </div>

          {/* ---- the load plan ---- */}
          {plan && <PlanView c={c} plan={plan} box={box} sailingBox={sailingBox} suggested={suggested} busy={busy} onBox={(b) => void act("box", () => saveBoxType(c, b))} />}

          {/* ---- the stuffing report ---- */}
          <div className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <p className="mr-auto text-[12.5px] font-medium text-text-primary">Stuffing report</p>
              <label className="block w-40">
                <span className="mb-0.5 block text-[11px] text-text-secondary">Stuffed on</span>
                <input
                  type="date"
                  value={stuffedOn}
                  onChange={(e) => setStuffedOn(e.target.value)}
                  onBlur={() => stuffedOn !== (c.stuffed_on ?? "") && void act("stuffed", () => saveStuffedOn(c, stuffedOn || null))}
                  className="h-8 w-full text-[12.5px]"
                />
              </label>
              <button
                type="button"
                onClick={() => renderStuffingReportPdf(sc, boxes, c.stuffed_on ?? null).save(stuffingReportFileName(sc))}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary"
              >
                <Download size={13} /> PDF
              </button>
              <button type="button" onClick={openReport} disabled={busy !== null} className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60">
                <Mail size={13} /> Email the report
              </button>
            </div>
            {c.stuffing_report_sent_at && (
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-text-success">
                <Check size={12} /> Sent {formatDate(c.stuffing_report_sent_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                {c.stuffing_report_sent_to ? ` to ${c.stuffing_report_sent_to}` : ""}
              </p>
            )}
            {issues.length > 0 && (
              <ul className="mt-2 space-y-1 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                {issues.map((x) => (
                  <li key={x} className="flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {x}
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-2 space-y-1 text-[12px] text-text-secondary">
              {boxes.map((b) => (
                <li key={b.containerNo || "loose"}>
                  <span className="font-mono text-text-primary">{b.containerNo || "Not in a box"}</span>
                  {b.containerNo && <span> {b.sizeType} · {b.sealNo ? `seal ${b.sealNo}` : "no seal"}</span>} · {b.houses.length} house{b.houses.length === 1 ? "" : "s"} · {fig(b.packages, 0)} pkgs · {fig(b.kg, 0)} kg · {fig(b.cbm, 3)} CBM
                </li>
              ))}
            </ul>
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
            setCompose(null);
            void act("sent", () => markStuffingReportSent(c, to.join(", ")), "Stuffing report sent.");
          }}
        />
      )}
    </section>
  );
}

function MeasureRow({ m, busy, onUse }: { m: HouseMeasure; busy: string | null; onUse: () => void }) {
  const r = m.received;
  const cell = (declared: number | null, received: number | null, verdict: string, dp: number) => (
    <td className="py-1.5 pr-2 text-right tabular-nums">
      {fig(declared, dp)}
      {r && (
        <span className={`block text-[11px] ${verdict === "short" || verdict === "over" ? "font-medium text-text-warning" : "text-text-muted"}`}>
          → {fig(received, dp)}
        </span>
      )}
    </td>
  );
  return (
    <tr className="align-top">
      <td className="py-1.5 pr-2">
        <Link to={`/shipments/${m.shipmentId}/warehouse`} className="font-mono text-text-accent hover:underline">
          {m.ref}
        </Link>
        <span className="block text-[11.5px] text-text-secondary">{m.customer}</span>
        {m.conditions.length > 0 && <span className="block text-[11px] text-text-warning">Received {m.conditions.join(", ")}</span>}
      </td>
      {cell(m.declared.pieces, r?.pieces ?? null, m.pieces.verdict, 0)}
      {cell(m.declared.grossKg, r?.grossKg ?? null, m.weight.verdict, 1)}
      {cell(m.declared.volumeCbm, r?.volumeCbm ?? null, m.volume.verdict, 3)}
      <td className="py-1.5 pr-2 text-right tabular-nums">
        {fig(m.quotedWm ?? m.declaredWm, 3)}
        {m.measuredWm !== null && <span className={`block text-[11px] ${m.wmChange ? "font-medium text-text-warning" : "text-text-muted"}`}>→ {fig(m.measuredWm, 3)}</span>}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">{m.inrChange === null ? <span className="text-text-muted">—</span> : inr(m.inrChange)}</td>
      <td className="py-1.5 text-right">
        {m.state === "not_received" ? (
          <span className="text-[11px] text-text-muted">not received</span>
        ) : m.state === "agrees" ? (
          <span className="text-[11px] text-text-success">as declared</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Use the CFS's figures on ${m.ref}? The manifest, the B/L draft and the console follow them; what was declared stays on the timeline and the quotation.`)) onUse();
            }}
            disabled={busy !== null}
            className="h-7 rounded-lg border border-border px-2.5 text-[11.5px] text-text-primary hover:border-border-strong disabled:opacity-60"
          >
            Use measured
          </button>
        )}
      </td>
    </tr>
  );
}

function PlanView({ c, plan, box, sailingBox, suggested, busy, onBox }: { c: Console; plan: LoadPlan; box: BoxType; sailingBox: BoxType | null; suggested: BoxType | null; busy: string | null; onBox: (b: BoxType | null) => void }) {
  const b = BOX[box];
  const colour = new Map(plan.houses.map((h, i) => [h.houseId, HUES[i % HUES.length]]));
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <p className="mr-auto text-[12.5px] font-medium text-text-primary">Load plan</p>
        {sailingBox ? (
          <span className="text-[12px] text-text-secondary">{sailingBox}, from the sailing</span>
        ) : (
          <div className="w-44">
            <Select
              label="Box"
              className="w-full"
              value={c.box_type ?? ""}
              options={[{ value: "", label: suggested ? `Smallest it fits: ${suggested}` : "Choose the box" }, ...BOX_TYPES.map((t) => ({ value: t, label: t }))]}
              onChange={(v) => busy === null && onBox((v || null) as BoxType | null)}
            />
          </div>
        )}
      </div>

      <p className={`mt-1 text-[12.5px] ${plan.fits ? "text-text-primary" : "text-text-danger"}`}>
        {plan.fits ? "Fits" : "Does not fit"} the {box}: {fig(plan.floorLengthCm / 100)} m of {fig(b.lengthCm / 100)} m floor ({plan.floorPct}%) · volume {plan.volumePct}% · {fig(plan.weightKg, 0)} kg,{" "}
        {plan.payloadPct}% of the payload
      </p>
      {plan.problems.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[12px] text-text-warning">
          {plan.problems.map((p) => (
            <li key={p} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {p}
            </li>
          ))}
        </ul>
      )}

      {/* The floor from above: the nose on the left, the doors on the right. */}
      <div className="mt-2 overflow-x-auto">
        <svg viewBox={`-2 -24 ${Math.max(b.lengthCm, plan.floorLengthCm) + 4} ${b.widthCm + 28}`} className="w-full min-w-[34rem]" role="img" aria-label={`Load plan of the ${box}, from above`}>
          <text x={0} y={-7} fontSize={18} fill="currentColor" className="text-text-muted">
            Nose
          </text>
          <text x={b.lengthCm} y={-7} fontSize={18} textAnchor="end" fill="currentColor" className="text-text-muted">
            Doors
          </text>
          <rect x={0} y={0} width={b.lengthCm} height={b.widthCm} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-border-strong" />
          {plan.placements.map((p, i) => {
            const hue = colour.get(p.houseId) ?? 210;
            return (
              <g key={i}>
                <rect
                  x={p.x + 0.5}
                  y={p.y + 0.5}
                  width={Math.max(1, p.length - 1)}
                  height={Math.max(1, p.width - 1)}
                  fill={`hsl(${hue} 65% 55% / ${p.estimated ? 0.25 : 0.55})`}
                  stroke={`hsl(${hue} 60% 40%)`}
                  strokeWidth={0.8}
                  strokeDasharray={p.estimated ? "4 3" : undefined}
                />
                {p.pieces > 1 && p.length >= 34 && p.width >= 22 && (
                  <text x={p.x + p.length / 2} y={p.y + p.width / 2 + 5} fontSize={15} textAnchor="middle" fill="currentColor" className="text-text-primary">
                    ×{p.pieces}
                  </text>
                )}
              </g>
            );
          })}
          {plan.floorLengthCm > b.lengthCm && (
            <line x1={b.lengthCm} y1={-2} x2={b.lengthCm} y2={b.widthCm + 2} stroke="currentColor" strokeWidth={2} className="text-text-danger" />
          )}
        </svg>
      </div>

      <ul className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
        {plan.houses.map((h) => (
          <li key={h.houseId} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm" style={{ background: `hsl(${colour.get(h.houseId)} 65% 55% / 0.7)` }} />
            <span className="min-w-0 flex-1 truncate text-text-primary">{h.house}</span>
            <span className="tabular-nums text-text-secondary">
              {fig(h.floorM)} m floor · {fig(h.cbm, 3)} CBM{h.estimated ? " · estimated" : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-text-muted">
        From the pieces' sizes on each enquiry, stacked where they may be, heaviest house first. Standard internal sizes: the CFS has the last word.
      </p>
    </div>
  );
}
