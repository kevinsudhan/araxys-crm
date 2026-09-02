import { useState } from "react";
import { AlertCircle, Check, IndianRupee, Loader2, Send, ThumbsDown } from "lucide-react";
import {
  acceptQuote,
  addQuote,
  declineQuote,
  markQuoteSent,
  missingForQuote,
  type Enquiry,
  type Quote,
} from "../services/enquiries";

/**
 * Quoting, and the customer's answer.
 *
 * Acceptance is the end of the inbound half, and it is recorded as a deliberate
 * act rather than inferred from a mail that looks agreeable. Everything
 * downstream -- booking, container space, documents -- starts from this flag, so
 * it should be something a person at the desk affirms, not something a parser
 * decides.
 *
 * Superseded versions are kept. When a customer says "you quoted me less last
 * week", the earlier row is the answer.
 */
export default function QuotePanel({
  enquiry,
  quotes,
  onChanged,
}: {
  enquiry: Enquiry;
  quotes: Quote[];
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [basis, setBasis] = useState("");
  const [sailing, setSailing] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const missing = missingForQuote(enquiry);
  const live = quotes.find((q) => q.status === "sent" || q.status === "draft") ?? null;
  const accepted = quotes.find((q) => q.status === "accepted") ?? null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-4 rounded-card border border-border bg-surface-1 p-5">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-3">
        <IndianRupee size={12} /> Quotation
      </h2>

      {accepted ? (
        <div className="rounded-lg bg-bg-success px-3 py-3 text-[13px] text-text-success">
          <p className="flex items-center gap-1.5 font-medium">
            <Check size={14} /> Accepted at ₹{Number(accepted.amount_inr).toLocaleString("en-IN")}
          </p>
          <p className="mt-0.5 text-[12px]">
            {accepted.basis}
            {accepted.sailing_date ? ` · sailing ${accepted.sailing_date}` : ""}
          </p>
          <p className="mt-2 text-[12px]">
            This enquiry is ready to become a booking. Container allocation and documentation
            follow from here.
          </p>
        </div>
      ) : missing.length > 0 && !live ? (
        <p className="text-[12px] text-text-muted">
          Fill in the shipment details above before quoting — a rate without dimensions is a guess,
          and space cannot be checked in three dimensions without them.
        </p>
      ) : null}

      {/* ---- outstanding quote ---- */}
      {live && !accepted && (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[15px] font-semibold text-text-primary">
                ₹{Number(live.amount_inr).toLocaleString("en-IN")}
              </p>
              <p className="text-[12px] text-text-secondary">
                Version {live.version} · {live.status}
                {live.basis ? ` · ${live.basis}` : ""}
                {live.sailing_date ? ` · sailing ${live.sailing_date}` : ""}
                {live.valid_until ? ` · valid to ${live.valid_until}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {live.status === "draft" && (
                <button
                  onClick={() =>
                    run("send", () => markQuoteSent(live.id, enquiry.ref, Number(live.amount_inr)))
                  }
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                >
                  {busy === "send" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Mark sent
                </button>
              )}

              {live.status === "sent" && (
                <>
                  <button
                    onClick={() =>
                      run("accept", () =>
                        acceptQuote(live.id, enquiry.ref, Number(live.amount_inr))
                      )
                    }
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                  >
                    {busy === "accept" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    Customer accepted
                  </button>
                  <button
                    onClick={() =>
                      run("decline", () => declineQuote(live.id, enquiry.ref, "Customer declined"))
                    }
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
                  >
                    <ThumbsDown size={13} />
                    Declined
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- new quote ---- */}
      {!accepted && (
        <div className="mt-3">
          {!drafting ? (
            <button
              onClick={() => setDrafting(true)}
              disabled={missing.length > 0}
              className="h-8 px-3 rounded-lg border border-border bg-surface-1 text-[12px] font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {live ? "Revise quote" : "Add quote"}
            </button>
          ) : (
            <div className="rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Amount (₹)" value={amount} onChange={setAmount} type="number" />
                <Field
                  label="Basis"
                  value={basis}
                  onChange={setBasis}
                  placeholder="All-in LCL, door to port"
                />
                <Field label="Sailing" value={sailing} onChange={setSailing} type="date" />
                <Field label="Valid until" value={validUntil} onChange={setValidUntil} type="date" />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() =>
                    run("add", async () => {
                      const n = Number(amount);
                      if (!n || n <= 0) throw new Error("Enter the amount being quoted.");
                      await addQuote({
                        ref: enquiry.ref,
                        amountInr: n,
                        basis: basis.trim(),
                        sailingDate: sailing || undefined,
                        validUntil: validUntil || undefined,
                      });
                      setAmount("");
                      setBasis("");
                      setSailing("");
                      setValidUntil("");
                      setDrafting(false);
                    })
                  }
                  disabled={busy !== null}
                  className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 text-white text-[12px] font-medium"
                >
                  {busy === "add" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Save quote
                </button>
                <button
                  onClick={() => setDrafting(false)}
                  className="h-8 px-3 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger"
        >
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- history ---- */}
      {quotes.length > 1 && (
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">
            Earlier versions
          </p>
          <ul className="space-y-1">
            {quotes
              .filter((q) => q.id !== live?.id && q.id !== accepted?.id)
              .map((q) => (
                <li key={q.id} className="text-[12px] text-text-secondary">
                  v{q.version} · ₹{Number(q.amount_inr).toLocaleString("en-IN")} · {q.status}
                  {q.basis ? ` · ${q.basis}` : ""}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-text-secondary mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full"
        autoComplete="off"
      />
    </div>
  );
}
