import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Mail } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { csnListHtml, csnListIssues, csnListSubject, type CsnListHouse } from "../lib/coload";
import { manifestSheet, type ManifestLine } from "../lib/consoleManifest";
import { manifestFileName, manifestPdfBytes } from "../lib/documents/manifestPdf";
import { buildWorkbook } from "../lib/xlsx";
import { csnListFor, markCsnListSent } from "../services/coload";
import { manifestConsole } from "../services/consoleManifest";
import type { Console } from "../services/consoles";
import { recordCsn } from "../services/icegateCsn";
import { listPartners } from "../services/partners";
import ComposeMail from "./ComposeMail";

/**
 * The CSN on a co-load when the co-loader files it (122): our house list to
 * them in time for their filing, with each export house's shipping bill, and
 * their CSN number recorded when they confirm it — on the console and every
 * job, as our own would be.
 */
export default function ConsoleCsnByColoader({ console: c, exporting, onChanged }: { console: Console; exporting: boolean; onChanged: () => void }) {
  const { session } = useAuth();
  const [data, setData] = useState<{ houses: CsnListHouse[]; lines: ManifestLine[]; provisional: boolean } | null>(null);
  const [coloader, setColoader] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string; attachments: Array<{ name: string; contentType: string; bytes: Uint8Array }> } | null>(null);
  const [csnNo, setCsnNo] = useState(c.csn_no ?? "");
  const [csnDate, setCsnDate] = useState(c.csn_date ?? "");
  useEffect(() => {
    setCsnNo(c.csn_no ?? "");
    setCsnDate(c.csn_date ?? "");
  }, [c.csn_no, c.csn_date]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, partners] = await Promise.all([csnListFor(c), listPartners(true).catch(() => [])]);
      const p = partners.find((x) => x.id === c.coloader_id);
      setData(d);
      setColoader({ name: p ? p.organisation || p.name : "", email: p?.emails[0] ?? "" });
    } catch (e) {
      setError(failureText(e, "Could not gather the house bills.").message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again when the console changes
  }, [c.id, c.updated_at]);
  useEffect(() => {
    void load();
  }, [load]);

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

  function openMail() {
    if (!data) return;
    const mc = manifestConsole(c);
    const files = [
      { name: manifestFileName(mc, "pdf"), contentType: "application/pdf", bytes: manifestPdfBytes(mc, data.lines, data.provisional) },
      { name: manifestFileName(mc, "xlsx"), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: buildWorkbook([manifestSheet(mc, data.lines, data.provisional)]) },
    ];
    setCompose({
      to: coloader.email,
      subject: csnListSubject(c, exporting),
      body: csnListHtml(c, data.houses, coloader.name, exporting, files.map((f) => f.name)),
      attachments: files,
    });
  }

  const who = coloader.name || "The co-loader";
  const issues = data ? csnListIssues(data.houses, exporting, coloader.email) : [];
  const when = (iso: string) => formatDate(iso, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <div className="space-y-3 rounded-card border border-border p-3">
      <p className="text-[12px] leading-relaxed text-text-secondary">
        {who} files the CSN for its box, our houses in it. Send them our house list{exporting ? " with each exporter's shipping bill" : ""} before it is due, then record their CSN number here when they confirm it: it goes on every job as ours would.
      </p>

      {error && <p className="rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">{error}</p>}

      {!data ? (
        !error && (
          <p className="flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Gathering the house bills…
          </p>
        )
      ) : (
        <>
          {issues.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
              {issues.map((x) => (
                <li key={x} className="flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {x}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openMail}
              disabled={busy !== null || !data.houses.length}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              <Mail size={13} /> {c.csn_list_sent_at ? "Send the house list again" : `Email our house list to ${who}`}
            </button>
            {c.csn_list_sent_at && (
              <span className="flex items-center gap-1 text-[11.5px] text-text-success">
                <Check size={12} /> Sent {when(c.csn_list_sent_at)}
                {c.csn_list_sent_to ? ` to ${c.csn_list_sent_to}` : ""}
              </span>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <label className="block w-48">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Their CSN number</span>
          <input value={csnNo} onChange={(e) => setCsnNo(e.target.value)} className="h-8 w-full font-mono text-[12.5px]" />
        </label>
        <label className="block w-40">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Date</span>
          <input type="date" value={csnDate} onChange={(e) => setCsnDate(e.target.value)} className="h-8 w-full text-[12.5px]" />
        </label>
        <button
          type="button"
          onClick={() => void act("record", () => recordCsn(c, csnNo, csnDate))}
          disabled={busy !== null || !csnNo.trim() || (csnNo.trim() === (c.csn_no ?? "") && csnDate === (c.csn_date ?? ""))}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-60"
        >
          {busy === "record" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Record their CSN
        </button>
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
            setCompose(null);
            void act("sent", () => markCsnListSent(c, to.join(", ")));
          }}
        />
      )}
    </div>
  );
}
