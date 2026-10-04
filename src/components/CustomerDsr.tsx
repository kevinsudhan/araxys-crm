import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, ClipboardList, Download, Loader2, Mail, RefreshCw } from "lucide-react";
import ComposeMail from "./ComposeMail";
import { useAuth } from "../lib/auth";
import { MAIL_LOGO_PATH } from "../lib/company";
import { formatDate } from "../lib/dates";
import { failureText } from "../lib/errorText";
import { istDate } from "../lib/liveRates";
import { useLiveVersions } from "../lib/liveVersions";
import { buildWorkbook, downloadWorkbook } from "../lib/xlsx";
import { DSR_COLUMNS, dsrFileName, dsrMailHtml, dsrNote, dsrSheet, dsrSubject, sortRows, type DsrRow } from "../lib/dsr";
import { customerName, dsrFor, dsrSends, recordDsrSent, saveDsrNote, DELIVERED_KEPT_DAYS, type DsrSend } from "../services/dsr";
import type { Customer } from "../services/customers";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The customer's DSR (108), on their page: every live shipment in the desk's
 * columns, the REASON and STATUS written here, downloaded as Excel or mailed
 * to the customer with the sheet attached. lib/dsr.ts lays it out.
 */
export default function CustomerDsr({ customer }: { customer: Customer }) {
  const { session } = useAuth();
  const [rows, setRows] = useState<DsrRow[] | null>(null);
  const [sends, setSends] = useState<DsrSend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<{ bytes: Uint8Array; html: string; subject: string; file: string; ids: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const name = customerName(customer);
  const today = istDate(new Date());

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, s] = await Promise.all([dsrFor(customer), dsrSends(customer.id)]);
      setRows(sortRows(r));
      setSends(s);
    } catch (e) {
      setError(failureText(e, "Could not load the DSR.").message);
    }
  }, [customer]);

  useEffect(() => {
    void load();
  }, [load]);

  // A line changed by a colleague, a milestone ticked, a DSR mailed: read again.
  const versions = useLiveVersions([
    ["shipment_dsr_notes", null],
    ["customer_dsr_sends", `customer_id=eq.${customer.id}`],
    ["shipments", `customer_id=eq.${customer.id}`],
  ]);
  const liveKey = JSON.stringify(versions);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void load();
  }, [liveKey, load]);

  const last = sends[0] ?? null;

  function download() {
    if (!rows) return;
    downloadWorkbook(dsrFileName(name, today), [dsrSheet(rows, { customer: name, today })]);
  }

  function email() {
    if (!rows) return;
    setNotice(null);
    setComposing({
      bytes: buildWorkbook([dsrSheet(rows, { customer: name, today })]),
      html: dsrMailHtml({
        customer: name,
        today,
        rows,
        note: dsrNote(rows.length),
        fromName: session?.name,
        logoSrc: `${window.location.origin}${MAIL_LOGO_PATH}`,
      }),
      subject: dsrSubject(name, today),
      file: dsrFileName(name, today),
      ids: rows.map((r) => r.shipmentId),
    });
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
            <ClipboardList size={14} /> Daily status report
            {rows && <span className="text-[12px] font-normal text-text-muted">{rows.length} shipment{rows.length === 1 ? "" : "s"}</span>}
          </h2>
          <p className="mt-0.5 max-w-prose text-[12px] text-text-secondary">
            Every shipment in progress, and those delivered in the last {DELIVERED_KEPT_DAYS} days. Write the reason and status here; the rest
            comes from the job. The customer gets exactly these columns.
          </p>
          <p className="mt-1 text-[11.5px] text-text-muted">
            {last
              ? `Last sent ${formatDate(last.sent_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })}${last.by_name ? ` by ${last.by_name}` : ""} to ${last.to_addresses.join(", ")}`
              : "Not sent to the customer yet."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="grid size-8 place-items-center rounded-lg border border-border bg-surface-1 text-text-secondary hover:text-text-primary"
            aria-label="Read the DSR again"
            title="Read again"
          >
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            disabled={!rows?.length}
            onClick={download}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-50"
          >
            <Download size={13} /> Download Excel
          </button>
          <button
            type="button"
            disabled={!rows}
            onClick={email}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            <Mail size={13} /> Email to customer
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}
      {notice && <p className="mt-3 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">{notice}</p>}

      {rows === null ? (
        !error && (
          <p className="mt-4 flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Reading the shipments…
          </p>
        )
      ) : !rows.length ? (
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-3 text-[12.5px] text-text-secondary">
          No shipments in progress for {name}. A job appears here once it is booked, and leaves {DELIVERED_KEPT_DAYS} days after delivery.
        </p>
      ) : (
        <>
          {/* Wide screens: the sheet exactly as the customer gets it. */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
            <table className="w-max min-w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-surface-2 text-left">
                  {DSR_COLUMNS.map((c) => (
                    <th key={c.header} className="whitespace-nowrap border-b border-border px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-secondary">
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.shipmentId} className="align-top odd:bg-surface-1 even:bg-surface-2/40">
                    <td className="border-b border-border px-2.5 py-2 text-center tabular-nums text-text-muted">{i + 1}</td>
                    <td className="border-b border-border px-2.5 py-2">
                      <Link to={`/enquiries/${encodeURIComponent(r.enquiryRef)}`} className="font-mono font-medium text-text-accent hover:underline">
                        {r.enquiryRef}
                      </Link>
                      {r.delivered && <span className="mt-0.5 block text-[10.5px] text-text-success">Delivered</span>}
                    </td>
                    <Td>{r.bookingNo}</Td>
                    <Td>{r.blNo}</Td>
                    <Td wide>{r.customer}</Td>
                    <Td>{r.term}</Td>
                    <Td>{r.mode}</Td>
                    <Td>{r.port}</Td>
                    <Td>{day(r.bookingReceived)}</Td>
                    <Td>{day(r.bookingConfirmed)}</Td>
                    <Td>
                      {day(r.pickup)}
                      {r.pickupPlanned && <span className="block text-[10.5px] text-text-muted">planned</span>}
                    </Td>
                    <Td>{r.pkg}</Td>
                    <Td>{r.weight}</Td>
                    <Td>{r.cbm ?? ""}</Td>
                    <Td wide>{r.vessel}</Td>
                    <Td>{day(r.cutoff)}</Td>
                    <Td>{day(r.etd)}</Td>
                    <Td>{day(r.eta)}</Td>
                    <td className="min-w-[16rem] border-b border-border px-1.5 py-1">
                      <NoteField row={r} field="remark" onSaved={load} />
                    </td>
                    <td className="min-w-[14rem] border-b border-border px-1.5 py-1">
                      <NoteField row={r} field="status" onSaved={load} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones and narrow windows: a card per shipment, the same facts and the same two fields. */}
          <ul className="mt-4 space-y-3 lg:hidden">
            {rows.map((r, i) => (
              <li key={r.shipmentId} className="rounded-lg border border-border p-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
                  <span className="text-text-muted">{i + 1}.</span>
                  <Link to={`/enquiries/${encodeURIComponent(r.enquiryRef)}`} className="font-mono font-medium text-text-accent hover:underline">
                    {r.enquiryRef}
                  </Link>
                  <span className="text-text-secondary">{[r.bookingNo, r.blNo && `BL ${r.blNo}`].filter(Boolean).join(" · ")}</span>
                  {r.delivered && <span className="text-[11px] text-text-success">Delivered</span>}
                </p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  {[r.term, r.mode, r.port, r.pkg, r.weight, r.cbm != null ? `${r.cbm} CBM` : ""].filter(Boolean).join(" · ")}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px] sm:grid-cols-4">
                  <Fact label="Booking received" value={day(r.bookingReceived)} />
                  <Fact label="Booking confirmed" value={day(r.bookingConfirmed)} />
                  <Fact label={r.pickupPlanned ? "Pickup (planned)" : "Pickup"} value={day(r.pickup)} />
                  <Fact label="Vessel" value={r.vessel} />
                  <Fact label="Cut-off" value={day(r.cutoff)} />
                  <Fact label="ETD" value={day(r.etd)} />
                  <Fact label="ETA" value={day(r.eta)} />
                </dl>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-text-muted">
                    Reason
                    <NoteField row={r} field="remark" onSaved={load} />
                  </label>
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-text-muted">
                    Status
                    <NoteField row={r} field="status" onSaved={load} />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {sends.length > 1 && (
        <details className="mt-4 text-[12px] text-text-secondary">
          <summary className="cursor-pointer text-text-muted hover:text-text-primary">Sent before ({sends.length})</summary>
          <ul className="mt-1.5 space-y-0.5">
            {sends.map((s) => (
              <li key={s.id}>
                {formatDate(s.sent_at, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} ·{" "}
                {s.shipment_ids.length} shipment{s.shipment_ids.length === 1 ? "" : "s"} · to {s.to_addresses.join(", ")}
                {s.by_name ? ` · by ${s.by_name}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {composing && (
        <ComposeMail
          mailbox={session?.email ?? ""}
          fromName={session?.name ?? ""}
          signature={session?.signature ?? ""}
          initial={{ to: customer.emails.join(", "), subject: composing.subject, body: composing.html }}
          attachments={[{ name: composing.file, contentType: XLSX, bytes: composing.bytes }]}
          onClose={() => setComposing(null)}
          onSent={(sent) => {
            const ids = composing.ids;
            setComposing(null);
            setNotice(`DSR sent to ${sent.to.join(", ")}.`);
            // The mail has gone; a failure to note it must not read as a failed send.
            void recordDsrSent({ customerId: customer.id, sentFrom: session?.email ?? "", to: sent.to, cc: sent.cc, subject: sent.subject, shipmentIds: ids })
              .then(load)
              .catch((e) => setError(`Sent, but not recorded here: ${failureText(e, "unknown error").message}`));
          }}
        />
      )}
    </section>
  );
}

const day = (iso: string | null) => (iso ? formatDate(iso, { day: "2-digit", month: "short", year: "numeric" }) : "");

function Td({ children, wide, muted }: { children: React.ReactNode; wide?: boolean; muted?: boolean }) {
  return (
    <td className={`border-b border-border px-2.5 py-2 ${wide ? "min-w-[9rem]" : "whitespace-nowrap"} ${muted ? "text-text-muted" : "text-text-primary"}`}>
      {children}
    </td>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="truncate text-text-primary">{value || "—"}</dd>
    </div>
  );
}

/**
 * The REASON or the STATUS of one line, written in place and saved when the
 * field is left. A STATUS left empty reads from the milestones, shown faint
 * until somebody writes their own.
 */
function NoteField({ row, field, onSaved }: { row: DsrRow; field: "remark" | "status"; onSaved: () => Promise<void> | void }) {
  const saved = field === "remark" ? row.reason : row.statusFromMilestones ? "" : row.status;
  const [value, setValue] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);

  // Someone else's change arrives unless this one is being typed.
  useEffect(() => {
    if (!editing.current) setValue(saved);
  }, [saved]);

  const other = useMemo(
    () => (field === "remark" ? (row.statusFromMilestones ? "" : row.status) : row.reason),
    [field, row.reason, row.status, row.statusFromMilestones]
  );

  async function save() {
    editing.current = false;
    if (value.trim() === saved.trim()) return;
    setState("saving");
    setError(null);
    try {
      await saveDsrNote(row.shipmentId, field === "remark" ? { remark: value, status: other } : { remark: other, status: value });
      setState("saved");
      await onSaved();
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setState("error");
      setError(failureText(e, "Not saved.").message);
    }
  }

  return (
    <div className="relative mt-0.5 normal-case tracking-normal">
      <textarea
        value={value}
        onChange={(e) => {
          editing.current = true;
          setValue(e.target.value);
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
          if (e.key === "Escape") {
            editing.current = false;
            setValue(saved);
          }
        }}
        rows={2}
        maxLength={field === "remark" ? 1000 : 500}
        placeholder={field === "status" && row.statusFromMilestones ? row.status || "What is awaited" : field === "remark" ? "What is happening" : "What is awaited"}
        aria-label={`${field === "remark" ? "Reason" : "Status"} for ${row.enquiryRef}`}
        className="w-full resize-y rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12px] font-normal text-text-primary placeholder:text-text-muted hover:border-border focus:border-border-strong focus:bg-surface-1"
      />
      {state !== "idle" && (
        <span className={`absolute right-1.5 top-1 text-[10.5px] ${state === "error" ? "text-text-danger" : "text-text-muted"}`} title={error ?? undefined}>
          {state === "saving" ? <Loader2 size={11} className="animate-spin" /> : state === "saved" ? <Check size={11} /> : "Not saved"}
        </span>
      )}
    </div>
  );
}
