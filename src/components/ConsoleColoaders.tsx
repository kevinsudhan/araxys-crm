import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Loader2, Mail } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { wmOf } from "../lib/coload";
import { coloaderIssues, coloaderShare, instructionIssues, instructionsHtml, instructionsSubject, type ColoaderHouse } from "../lib/coloaderSale";
import { useTablesChanges } from "../lib/useTableChanges";
import type { Console } from "../services/consoles";
import { coloaderConsole, coloaderHousesFor, markInstructionsSent, saveStuffingCfs } from "../services/coloaderSale";
import ComposeMail from "./ComposeMail";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Space on our console sold to other forwarders (124): whose cargo it is, how
 * much of the box, what it was quoted at, our house B/L to them, and the
 * delivery instructions each needs — the stuffing CFS, the cut-off, and what
 * to send for our B/L. The rules are lib/coloaderSale.ts.
 */
export default function ConsoleColoaders({ console: c, jobs, onChanged }: { console: Console; jobs: number; onChanged: () => void }) {
  const { session } = useAuth();
  const [houses, setHouses] = useState<ColoaderHouse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ shipmentId: string; to: string; subject: string; body: string } | null>(null);
  const [cfs, setCfs] = useState(c.cfs_name ?? "");
  useEffect(() => setCfs(c.cfs_name ?? ""), [c.cfs_name]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHouses(await coloaderHousesFor(c));
    } catch (e) {
      setError(failureText(e, "Could not gather the co-loaders' cargo.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console or its jobs change
  }, [c.id, c.updated_at, jobs]);
  useEffect(() => {
    void load();
  }, [load]);
  useTablesChanges(
    [
      ["house_bills", null],
      ["quotes", null],
    ],
    () => void load()
  );

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(failureText(e, "That did not work.").message);
    } finally {
      setBusy(null);
    }
  }

  const cc = { ...coloaderConsole(c), cfs_name: cfs };
  const share = houses ? coloaderShare(houses, { cbm: Number(c.summary?.volume_cbm ?? 0), grossKg: Number(c.summary?.gross_weight_kg ?? 0) }) : null;
  const before = instructionIssues(cc);
  const when = (iso: string) => formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Space sold to co-loaders</h3>
      {error && <p className="mb-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}

      {!houses ? (
        !error && (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Looking for co-loaders' cargo…
          </p>
        )
      ) : !houses.length ? (
        <p className="text-[12px] text-text-muted">
          None on this console. A customer marked as a freight forwarder (on their customer record) shows here when their job is put on it.
        </p>
      ) : (
        <div className="rounded-lg border border-border p-3">
          {share && (
            <p className="text-[12.5px] text-text-primary">
              {share.houses} co-loader house{share.houses === 1 ? "" : "s"}: <span className="font-medium tabular-nums">{share.wm.toLocaleString("en-IN")} W/M</span>
              {share.ofAll !== null && <span className="text-text-secondary"> · {share.ofAll}% of the box</span>}
              {share.quotedInr > 0 && <span className="text-text-secondary"> · quoted {inr(share.quotedInr)}</span>}
            </p>
          )}

          <label className="mt-3 block max-w-md">
            <span className="mb-0.5 block text-[11px] text-text-secondary">Stuffing CFS (where they deliver)</span>
            <input
              value={cfs}
              onChange={(e) => setCfs(e.target.value)}
              onBlur={() => cfs.trim() !== (c.cfs_name ?? "") && void act("cfs", () => saveStuffingCfs(c, cfs))}
              placeholder="e.g. Sical Logistics CFS, Chennai"
              className="h-8 w-full text-[12.5px]"
            />
          </label>
          {before.length > 0 && <p className="mt-1 text-[11.5px] text-text-warning">Before sending instructions: {before.join("; ")}.</p>}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10.5px] uppercase tracking-wide text-text-secondary">
                  <th className="py-1.5 pr-2 font-medium">Co-loader</th>
                  <th className="py-1.5 pr-2 font-medium">Job</th>
                  <th className="py-1.5 pr-2 text-right font-medium">W/M</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Quoted</th>
                  <th className="py-1.5 pr-2 font-medium">Our B/L</th>
                  <th className="py-1.5 font-medium">Instructions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {houses.map((h) => {
                  const issues = coloaderIssues(h).filter((x) => x !== "Delivery instructions not sent");
                  return (
                    <tr key={h.shipmentId} className="align-top">
                      <td className="py-2 pr-2">
                        <span className="font-medium text-text-primary">{h.forwarder.name}</span>
                        {issues.length > 0 && (
                          <span className="mt-0.5 flex items-start gap-1 text-[11px] text-text-warning">
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {issues.join("; ")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <Link to={`/shipments/${h.shipmentId}/bill`} className="font-mono text-text-accent hover:underline">
                          {h.ref}
                        </Link>
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{wmOf(h.cbm, h.grossKg) || "—"}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{h.quotedInr === null ? "—" : inr(h.quotedInr)}</td>
                      <td className="py-2 pr-2">
                        {h.hblNo ? (
                          <span className={h.hblIssued ? "text-text-success" : "text-text-secondary"}>
                            <span className="font-mono">{h.hblNo}</span> {h.hblIssued ? "issued" : "draft"}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setCompose({ shipmentId: h.shipmentId, to: h.forwarder.email, subject: instructionsSubject(cc, h), body: instructionsHtml(cc, h) })
                            }
                            disabled={busy !== null}
                            className="flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11.5px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
                          >
                            <Mail size={12} /> {h.instructionsSentAt ? "Send again" : "Email"}
                          </button>
                          {h.instructionsSentAt ? (
                            <span className="flex items-center gap-1 text-[11px] text-text-success">
                              <Check size={11} /> {when(h.instructionsSentAt)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-text-warning">not sent</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {compose && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={{ to: compose.to, subject: compose.subject, body: compose.body }}
          onClose={() => setCompose(null)}
          onSent={({ to }) => {
            const id = compose.shipmentId;
            setCompose(null);
            void act("sent", () => markInstructionsSent(id, to.join(", ")));
          }}
        />
      )}
    </section>
  );
}
