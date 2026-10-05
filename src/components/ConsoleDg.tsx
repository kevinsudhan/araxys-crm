import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Ban, Check, Loader2, ShieldCheck } from "lucide-react";
import { formatDate } from "../lib/dates";
import { boxPairs, canAccept, classOf, CLASS_NAME, dgSummary, houseChecks, SEG_WORDS, unOf, type DgCheck, type DgHouse } from "../lib/dgAcceptance";
import { istDay } from "../lib/enquiryRegister";
import { failureText } from "../lib/errorText";
import { useTablesChanges } from "../lib/useTableChanges";
import type { Console } from "../services/consoles";
import { acceptDgHouse, dgHousesOn, saveDgFact, saveDgPapers, withdrawDgAcceptance } from "../services/consoleDg";
import { Segmented, TextSave, YesNo } from "./formControls";

const CLASSES = ["1", "1.4", "2.1", "2.2", "2.3", "3", "4.1", "4.2", "4.3", "5.1", "5.2", "6.1", "6.2", "7", "8", "9"];

/**
 * Dangerous goods on the console (131): every DG house checked — its class,
 * UN number, packing group and flash point, the safety data sheet, the
 * shipper's declaration, the line's approval, and whether it may share the
 * container with the other DG houses — and accepted before it goes in the
 * box. The rules are lib/dgAcceptance.ts.
 */
export default function ConsoleDg({ console: c, jobs }: { console: Console; jobs: number }) {
  const [houses, setHouses] = useState<DgHouse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const coload = c.space_from === "coloader";

  const load = useCallback(async () => {
    setError(null);
    try {
      setHouses(await dgHousesOn(c));
    } catch (e) {
      setError(failureText(e, "Could not read the console's dangerous goods.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or its jobs change
  }, [c.id, c.updated_at, jobs]);
  useEffect(() => {
    void load();
  }, [load]);
  useTablesChanges(
    [
      ["shipments", `console_id=eq.${c.id}`],
      ["enquiries", null],
    ],
    () => void load()
  );

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const today = istDay(new Date().toISOString());
  const pairs = houses && houses.length > 1 ? boxPairs(houses) : [];

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Dangerous goods</h3>
      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}

      {!houses ? (
        !error && (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Looking for dangerous goods…
          </p>
        )
      ) : !houses.length ? (
        <p className="text-[12px] text-text-muted">
          None on this console. A job marked hazardous (in its cargo details) shows here, to be accepted before it goes in the box.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px] text-text-primary">
            {dgSummary(houses)}
            <span className="block text-[11.5px] text-text-muted">
              Each needs its papers and the {coload ? "co-loader's" : "line's"} approval, and must be allowed to share the container with the others. By primary class
              (IMDG 7.2.4): a subsidiary hazard or the DG List's own entry can ask more, and the {coload ? "co-loader's" : "line's"} DG desk has the last word.
            </span>
          </p>

          {houses.map((h) => {
            const checks = houseChecks(h, houses, { coload, today });
            const ok = canAccept(checks);
            const cls = classOf(h.imoClass);
            const un = unOf(h.unNumber);
            const warns = checks.filter((x) => x.state === "warn");
            const k = (s: string) => `${h.shipmentId}:${s}`;
            return (
              <div key={h.shipmentId} className={`rounded-lg border p-3 ${h.acceptedAt ? (ok ? "border-border" : "border-text-danger/40") : "border-border"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link to={`/shipments/${h.shipmentId}`} className="font-mono text-[12px] text-text-accent hover:underline">
                    {h.ref ?? h.shipmentId}
                  </Link>
                  <span className="text-[12.5px] text-text-primary">{h.customer}</span>
                  <span className="text-[12px] text-text-secondary">
                    {[un, cls.cls ? `Class ${cls.cls}${CLASS_NAME[cls.cls] ? ` (${CLASS_NAME[cls.cls]})` : ""}` : null, h.packingGroup ? `PG ${h.packingGroup}` : null]
                      .filter(Boolean)
                      .join(" · ") || "No UN number or class yet"}
                  </span>
                  <span className="ml-auto">
                    {h.acceptedAt ? (
                      <span className="flex items-center gap-1 text-[12px] text-text-success">
                        <ShieldCheck size={13} /> Accepted {formatDate(h.acceptedAt, { day: "numeric", month: "short" })}
                      </span>
                    ) : (
                      <span className="text-[12px] text-text-warning">Not accepted yet</span>
                    )}
                  </span>
                </div>

                {/* ---- the job's facts: on the enquiry, which the job follows ---- */}
                <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="block min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">UN number</span>
                    <TextSave
                      value={h.unNumber ?? ""}
                      placeholder="UN1263"
                      busy={busy === k("un")}
                      ariaLabel={`UN number for ${h.ref}`}
                      onSave={(v) => void act(k("un"), () => saveDgFact(h, { un_number: v ? (unOf(v) ?? v.toUpperCase()) : null }))}
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">IMO class</span>
                    <select
                      value={h.imoClass ?? ""}
                      disabled={busy !== null}
                      aria-label={`IMO class for ${h.ref}`}
                      onChange={(e) => void act(k("class"), () => saveDgFact(h, { imo_class: e.target.value || null }))}
                      className="h-9 w-full"
                    >
                      <option value="">—</option>
                      {CLASSES.map((x) => (
                        <option key={x} value={x}>
                          Class {x}
                        </option>
                      ))}
                      {h.imoClass && !CLASSES.includes(h.imoClass) && <option value={h.imoClass}>{h.imoClass}</option>}
                    </select>
                  </label>
                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">Packing group</span>
                    <Segmented
                      options={[
                        { value: "none", label: "—" },
                        { value: "I", label: "I" },
                        { value: "II", label: "II" },
                        { value: "III", label: "III" },
                      ]}
                      value={h.packingGroup ?? "none"}
                      busy={busy !== null}
                      onChange={(v) => void act(k("pg"), () => saveDgFact(h, { packing_group: v === "none" ? null : (v as "I" | "II" | "III") }))}
                    />
                  </div>
                  <label className="block min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">Flash point (°C)</span>
                    <TextSave
                      type="number"
                      value={h.flashPointC === null ? "" : String(h.flashPointC)}
                      placeholder="—"
                      busy={busy === k("fp")}
                      ariaLabel={`Flash point for ${h.ref}`}
                      onSave={(v) => void act(k("fp"), () => saveDgFact(h, { flash_point_c: v === "" ? null : Number(v) }))}
                    />
                  </label>
                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">Safety data sheet in hand</span>
                    <YesNo value={h.msdsProvided} busy={busy !== null} onChange={(v) => void act(k("msds"), () => saveDgFact(h, { msds_provided: v }))} />
                  </div>
                </div>

                {/* ---- the console desk's papers ---- */}
                <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-3">
                  <label className="block min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">Date on the safety data sheet</span>
                    <TextSave
                      type="date"
                      value={h.msdsDate ?? ""}
                      busy={busy === k("msdsdate")}
                      ariaLabel={`Date on the safety data sheet for ${h.ref}`}
                      onSave={(v) => void act(k("msdsdate"), () => saveDgPapers(h.shipmentId, { msds_date: v || null }))}
                    />
                  </label>
                  <div className="min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">Shipper's signed DG declaration</span>
                    <label className="flex h-9 items-center gap-2 text-[12.5px] text-text-primary">
                      <input
                        type="checkbox"
                        checked={Boolean(h.declarationAt)}
                        disabled={busy !== null}
                        onChange={(e) => void act(k("decl"), () => saveDgPapers(h.shipmentId, { dg_declaration_at: e.target.checked ? new Date().toISOString() : null }))}
                        className="size-3.5 accent-[var(--brand)]"
                      />
                      {h.declarationAt ? `In hand since ${formatDate(h.declarationAt, { day: "numeric", month: "short" })}` : "In hand"}
                    </label>
                  </div>
                  <label className="block min-w-0">
                    <span className="mb-0.5 block text-[11px] text-text-secondary">{coload ? "Co-loader's DG acceptance (ref)" : "Line's DG approval (ref)"}</span>
                    <TextSave
                      value={h.lineRef ?? ""}
                      placeholder={coload ? "Their acceptance mail or ref" : "e.g. the line's DG reference"}
                      busy={busy === k("line")}
                      ariaLabel={`DG approval reference for ${h.ref}`}
                      onSave={(v) => void act(k("line"), () => saveDgPapers(h.shipmentId, { dg_line_ref: v || null }))}
                    />
                  </label>
                </div>

                <Checks checks={checks} accepted={Boolean(h.acceptedAt)} />

                {/* ---- accepting it ---- */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {h.acceptedAt ? (
                    <>
                      <p className="mr-auto text-[12px] text-text-secondary">
                        Accepted into the console {formatDate(h.acceptedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}
                        {h.acceptNote && <span className="block text-[11.5px] text-text-muted">“{h.acceptNote}”</span>}
                        <span className="block text-[11px] text-text-muted">A change to its UN number, class or packing group, or moving it to another console, takes the acceptance back.</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => window.confirm(`Take back the acceptance of ${h.ref}?`) && void act(k("withdraw"), () => withdrawDgAcceptance(h.shipmentId))}
                        disabled={busy !== null}
                        className="h-8 rounded-lg px-2.5 text-[12px] text-text-muted hover:text-text-danger disabled:opacity-60"
                      >
                        Take it back
                      </button>
                    </>
                  ) : (
                    <>
                      {ok && warns.length > 0 && (
                        <input
                          value={notes[h.shipmentId] ?? ""}
                          onChange={(e) => setNotes((n) => ({ ...n, [h.shipmentId]: e.target.value }))}
                          placeholder="A note for the warnings, e.g. the approval for “away from”"
                          aria-label={`Note on accepting ${h.ref}`}
                          className="h-8 min-w-0 flex-1 text-[12.5px]"
                        />
                      )}
                      <span className={`text-[12px] ${ok ? "text-text-secondary" : "text-text-danger"} ${ok && warns.length ? "" : "mr-auto"}`}>
                        {ok ? (warns.length ? "" : "Everything is in order.") : "Not until every red line above is cleared."}
                      </span>
                      <button
                        type="button"
                        onClick={() => void act(k("accept"), () => acceptDgHouse(h.shipmentId, notes[h.shipmentId]?.trim() || null))}
                        disabled={!ok || busy !== null}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                      >
                        {busy === k("accept") ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Accept into the console
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {pairs.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[12px] font-medium text-text-primary">In the same container</p>
              <ul className="mt-1.5 space-y-1 text-[12px]">
                {pairs.map(({ a, b, code }) => {
                  const ca = classOf(a.imoClass).cls;
                  const cb = classOf(b.imoClass).cls;
                  const tone = code === null ? "text-text-muted" : code === "X" ? "text-text-success" : code === "1" ? "text-text-warning" : "text-text-danger";
                  const verdict =
                    code === null
                      ? "a class is missing"
                      : code === "X"
                        ? "may share the box"
                        : code === "1"
                          ? `"away from": only with the competent authority's approval`
                          : `not in the same container ("${SEG_WORDS[code]}")`;
                  return (
                    <li key={`${a.shipmentId}-${b.shipmentId}`} className="flex flex-wrap gap-x-2">
                      <span className="text-text-primary">
                        {a.ref} (class {ca ?? "—"}) and {b.ref} (class {cb ?? "—"})
                      </span>
                      <span className={tone}>{verdict}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Checks({ checks, accepted }: { checks: DgCheck[]; accepted: boolean }) {
  const stops = checks.filter((x) => x.state === "stop");
  return (
    <div className="mt-3">
      {accepted && stops.length > 0 && <p className="mb-1 text-[12px] font-medium text-text-danger">Since it was accepted:</p>}
      <ul className="space-y-0.5 text-[12px]">
        {checks.map((x) => (
          <li key={x.key} className={`flex items-start gap-1.5 ${x.state === "ok" ? "text-text-secondary" : x.state === "warn" ? "text-text-warning" : "text-text-danger"}`}>
            {x.state === "ok" ? <Check size={12} className="mt-0.5 shrink-0 text-text-success" /> : x.state === "warn" ? <AlertTriangle size={12} className="mt-0.5 shrink-0" /> : <Ban size={12} className="mt-0.5 shrink-0" />}
            {x.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
