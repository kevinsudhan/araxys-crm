import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownUp, ClipboardPaste, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { PASTE_CURRENCIES, PASTE_UNITS, chargesText, figure, isStrongLine, totalInInr, type PastedLine, type PastedQuote, type Section } from "../lib/pastedQuote";
import { applyPastedQuote, readPastedQuote } from "../services/pasteQuote";
import type { Enquiry, Quote } from "../services/enquiries";

/**
 * "Paste a quotation": the rate as the desk has it — from a mail, a WhatsApp
 * message, a rate sheet — read by the AI into charges under Ex works and Other
 * charges, checked here, then saved as the quotation's charges (106).
 *
 * The AI only reads. Every total, and the plain text the mail carries, is
 * worked out by the app from the lines shown here, which can be corrected
 * before anything is saved: a misread figure is one wrong line on this screen,
 * not a wrong total in a customer's inbox.
 */
export default function PasteQuoteDialog({
  enquiry,
  live,
  liveCount,
  onClose,
  onApplied,
}: {
  enquiry: Enquiry;
  /** The quotation being written, if any: a draft has its charges replaced. */
  live: Quote | null;
  /** How many charges that draft has now, to say what is being replaced. */
  liveCount: number;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [text, setText] = useState("");
  const [q, setQ] = useState<PastedQuote | null>(null);
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [termsText, setTermsText] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((text.trim() || q) && !window.confirm("Close without saving this quotation?")) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [text, q]);

  async function read() {
    if (!text.trim()) return setError("Paste the quotation first.");
    setBusy("read");
    setError(null);
    try {
      const got = await readPastedQuote(enquiry, text);
      setQ(got);
      setTermsText(got.terms.join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The quotation could not be read.");
    } finally {
      setBusy(null);
    }
  }

  const current: PastedQuote | null = useMemo(
    () => (q ? { ...q, terms: termsText.split(/\r?\n/).map((t) => t.trim()).filter(Boolean) } : null),
    [q, termsText]
  );
  const foreign = useMemo(() => [...new Set((q?.lines ?? []).map((l) => l.currency).filter((c) => c !== "INR"))], [q]);
  const missingRoe = foreign.filter((c) => !(q?.roe[c] && q.roe[c] > 0));
  const preview = current ? chargesText(current) : "";

  const setLine = (i: number, patch: Partial<PastedLine>) =>
    setQ((prev) => (prev ? { ...prev, lines: prev.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) } : prev));

  async function save() {
    if (!current) return;
    if (!current.lines.length) return setError("There are no charges to save.");
    if (current.lines.some((l) => !l.description.trim())) return setError("Every charge needs a name.");
    if (missingRoe.length) return setError(`Give the rate of exchange for ${missingRoe.join(", ")}.`);
    setBusy("save");
    setError(null);
    try {
      await applyPastedQuote({ enquiry, live, pasted: current, pastedText: text });
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The quotation could not be saved.");
      setBusy(null);
    }
  }

  const group = (section: Section, title: string) => {
    const rows = (q?.lines ?? []).map((l, i) => ({ l, i })).filter((x) => x.l.section === section);
    return (
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{title}</p>
          <button
            type="button"
            onClick={() =>
              setQ((prev) =>
                prev ? { ...prev, lines: [...prev.lines, { section, description: "", currency: "INR", unit: "Shipment", quantity: 1, rate: 0, note: null }] } : prev
              )
            }
            className="flex items-center gap-1 text-[11.5px] text-text-accent hover:underline"
          >
            <Plus size={11} /> Add a charge
          </button>
        </div>
        {rows.length === 0 && <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-text-muted">None.</p>}
        <div className="space-y-1.5">
          {rows.map(({ l, i }) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-1 p-1.5">
              <input
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
                placeholder="Charge"
                aria-label="Charge"
                className="h-8 min-w-[10rem] flex-[3] text-[12.5px]"
              />
              <select value={l.currency} onChange={(e) => setLine(i, { currency: e.target.value })} aria-label="Currency" className="h-8 w-[4.6rem] text-[12.5px]">
                {PASTE_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                value={String(l.rate)}
                onChange={(e) => setLine(i, { rate: Number(e.target.value.replace(/,/g, "")) || 0 })}
                inputMode="decimal"
                aria-label="Rate"
                className="h-8 w-24 text-right text-[12.5px] tabular-nums"
              />
              <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} aria-label="Per" className="h-8 w-[6.6rem] text-[12.5px]">
                {PASTE_UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
              <span className="text-[11.5px] text-text-muted">×</span>
              <input
                value={String(l.quantity)}
                onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })}
                inputMode="decimal"
                aria-label="Units"
                className="h-8 w-14 text-right text-[12.5px] tabular-nums"
              />
              <span className="min-w-[6.5rem] flex-1 text-right text-[12.5px] font-medium tabular-nums text-text-primary">
                {l.currency} {figure(l.rate * l.quantity)}
              </span>
              <button
                type="button"
                onClick={() => setLine(i, { section: section === "ex_works" ? "other" : "ex_works" })}
                title={section === "ex_works" ? "Move to Other charges" : "Move to Ex works"}
                aria-label={section === "ex_works" ? "Move to Other charges" : "Move to Ex works"}
                className="grid size-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"
              >
                <ArrowDownUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => setQ((prev) => (prev ? { ...prev, lines: prev.lines.filter((_, k) => k !== i) } : prev))}
                aria-label="Remove this charge"
                title="Remove this charge"
                className="grid size-7 place-items-center rounded-md text-text-muted hover:bg-bg-danger hover:text-text-danger"
              >
                <Trash2 size={13} />
              </button>
              {l.note && <p className="w-full pl-1 text-[11px] text-text-muted">Note: {l.note}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const inr = current ? totalInInr(current.lines, current.roe) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6">
      <div className="flex max-h-[94vh] w-full flex-col rounded-t-card bg-surface-1 shadow-xl sm:card sm:max-w-4xl" role="dialog" aria-label="Paste a quotation">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-text-primary">
            <ClipboardPaste size={15} /> Paste a quotation
          </h2>
          <button
            onClick={() => ((text.trim() || q) && !window.confirm("Close without saving this quotation?") ? null : onClose())}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!q ? (
            <>
              <p className="mb-2 text-[12.5px] text-text-secondary">
                Paste the rate as you have it — a mail, a WhatsApp message, a rate sheet. The AI sorts the charges into
                <strong className="font-medium text-text-primary"> Ex works</strong> and <strong className="font-medium text-text-primary">Other charges</strong>; you check them next.
                The mail goes out as plain text, and the PDF as a proper quotation with both groups.
              </p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                rows={14}
                placeholder={"EXW charges\nPickup from factory – INR 4,500\nExport customs clearance – 2,500\n\nOcean freight USD 1,150 per 40HC × 2\nBL fee 1,500 per BL\n\nValidity 15 days. Duties extra."}
                className="w-full resize-y font-mono text-[12.5px] leading-relaxed"
              />
            </>
          ) : (
            <>
              {live?.status === "draft" && liveCount > 0 && (
                <p className="mb-2 rounded-lg bg-bg-warning px-3 py-2 text-[12px] text-text-warning">
                  Saving replaces the {liveCount} charge{liveCount === 1 ? "" : "s"} on version {live.version}.
                </p>
              )}
              <p className="text-[12px] text-text-secondary">
                Read by the AI — check every figure against what you pasted. Move a charge between the groups with the arrows.
              </p>
              {group("ex_works", "Ex works charges")}
              {group("other", "Other charges")}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Rates of exchange</p>
                  {foreign.length === 0 ? (
                    <p className="text-[12px] text-text-muted">All in rupees.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {foreign.map((c) => (
                        <label key={c} className="flex items-center gap-2 text-[12.5px] text-text-primary">
                          <span className="w-16">1 {c} = ₹</span>
                          <input
                            value={q.roe[c] ? String(q.roe[c]) : ""}
                            onChange={(e) => setQ((prev) => (prev ? { ...prev, roe: { ...prev.roe, [c]: Number(e.target.value) || 0 } } : prev))}
                            inputMode="decimal"
                            placeholder="needed"
                            aria-label={`Rupees for one ${c}`}
                            className={`h-8 w-28 text-right tabular-nums ${q.roe[c] ? "" : "border-text-danger"}`}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="mt-3 block text-[12px] text-text-secondary">
                    Valid until
                    <input
                      type="date"
                      value={q.validUntil ?? ""}
                      onChange={(e) => setQ((prev) => (prev ? { ...prev, validUntil: e.target.value || null } : prev))}
                      className="mt-1 h-8 w-full"
                    />
                  </label>
                  <label className="mt-3 block text-[12px] text-text-secondary">
                    Terms, one per line
                    <textarea value={termsText} onChange={(e) => setTermsText(e.target.value)} rows={4} className="mt-1 w-full text-[12.5px]" />
                  </label>
                  <p className="mt-2 text-[12.5px] text-text-primary">
                    Total: <strong className="font-semibold tabular-nums">{inr === null ? "needs every rate of exchange" : `₹${figure(inr)}`}</strong>
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">The charges, as the mail shows them</p>
                  {/* As they go in the quotation letter: text, headings and totals in bold, no table. */}
                  <div className="max-h-[22rem] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-[12px] leading-relaxed text-text-primary">
                    {preview.split("\n").map((l, i) => (
                      <div key={i} className={isStrongLine(l) ? "font-semibold" : undefined}>
                        {l || "\u00a0"}
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-text-muted">In the quotation letter as usual, with the PDF attached.</p>
                </div>
              </div>
            </>
          )}

          {error && (
            <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
              <AlertCircle size={13} className="mt-px shrink-0" />
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[11px] text-text-muted">{q ? "Nothing is saved until you press Save." : "The AI reads it; nothing is saved yet."}</p>
          <div className="flex items-center gap-2">
            {q && (
              <button type="button" onClick={() => setQ(null)} className="h-8 rounded-lg border border-border px-3 text-[12px] text-text-secondary hover:text-text-primary">
                Back to the text
              </button>
            )}
            {!q ? (
              <button
                type="button"
                onClick={() => void read()}
                disabled={busy !== null || !text.trim()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {busy === "read" ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {busy === "read" ? "Reading…" : "Lay it out"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy !== null}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {busy === "save" && <Loader2 size={13} className="animate-spin" />}
                Save the quotation
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
