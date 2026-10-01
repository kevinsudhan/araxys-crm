import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertCircle, Check, Loader2, PencilLine, Truck } from "lucide-react";
import {
  acceptByToken,
  quoteByToken,
  requestRevisionByToken,
  shipperByToken,
  type PublicQuote,
  type QuoteLinkState,
  type ShipperGiven,
} from "../services/publicQuote";
import { SectionSkeleton } from "../components/Loading";
import { COMPANY, MAIL_LOGO_PATH } from "../lib/company";
import { quotationNumber, quotationTitle } from "../lib/quoteRevision";

/**
 * The page a customer lands on from the quotation mail.
 *
 * ---------------------------------------------------------------------------
 * WHO IS READING THIS
 *
 * Somebody outside the company, on a phone, who has never seen this system and
 * never will again. So: no navigation, no branding they have to decode, no
 * jargon, and one thing to do. Everything that would be useful to an operator
 * is absent, because none of it is useful to them.
 *
 * WHY THE PAGE LOADS WITHOUT ACCEPTING
 *
 * Their mail gateway fetched this URL before they saw it. If arriving here
 * accepted the quotation, a scanner would have accepted it. Arriving reads;
 * the button accepts.
 *
 * WHY THE NAME FIELD IS OPTIONAL
 *
 * Because insisting on it would stop somebody from agreeing, and an acceptance
 * with no name is still an acceptance — the link was sent to one address for
 * one quotation. The name is worth asking for and not worth blocking on.
 *
 * WHY EVERY ENDED STATE READS PLAINLY
 *
 * Expired, withdrawn, already accepted: all of them are ordinary and none is
 * the customer's fault. They get a sentence and the desk's address, not an
 * error.
 * ---------------------------------------------------------------------------
 */
export default function QuoteAccept() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /**
   * "Revise this quote" open, and what they want changed (114). Open from the
   * start when they came by the mail's "Revise this quote" button (?revise=1).
   */
  const [revising, setRevising] = useState(() => params.get("revise") === "1");
  const [change, setChange] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setQuote(await quoteByToken(token));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    setBusy(true);
    try {
      await acceptByToken(token, name.trim(), note.trim());
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function revise() {
    if (change.trim().length < 3) return setSaid("Say what you would like changed.");
    setBusy(true);
    setSaid(null);
    try {
      const r = await requestRevisionByToken(token, change.trim(), name.trim());
      if (!r.ok) setSaid(r.reason === "empty" ? "Say what you would like changed." : "This quotation can no longer be revised here. Please reply to the email.");
      else {
        setRevising(false);
        setChange("");
        await load();
      }
    } catch {
      setSaid("That did not go through. Please try again, or reply to the email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-8 text-[#1f2937]">
      <div className="mx-auto w-full max-w-[640px] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_12px_32px_-18px_rgba(15,33,58,0.35)]">
        {/* The mail's header: the logo on the navy it was cut from, then the blue rule. */}
        <header className="bg-[#0F213A] px-6 pb-5 pt-6 text-white sm:px-7">
          <img src={MAIL_LOGO_PATH} alt={COMPANY.legalName} width={300} className="block h-auto w-[300px] max-w-full" />
          <p className="mt-5 border-t border-[#24395a] pt-4 text-[20px] font-extrabold tracking-[0.16em]">{quote ? quotationTitle(quote.version) : "QUOTATION"}</p>
        </header>
        <div className="h-1 bg-[#1670b0]" />

        <main className="px-6 py-6 sm:px-7">
          {loading ? (
            <SectionSkeleton lines={4} label="Loading the quotation" className="py-6" />
          ) : failed || !quote ? (
            <Ended
              title="We could not open this quotation"
              body="The link may be incomplete. Please reply to the email it came from and we will send it again."
            />
          ) : quote.state !== "open" ? (
            <Closed quote={quote} token={token} onChanged={load} />
          ) : (
            <>
              <Summary quote={quote} />

              {quote.revision_requested_at && quote.revision_note && (
                <div className="mt-6 rounded-lg border border-[#fcd34d] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
                  <p className="font-semibold">You asked for a revision on {longDate(quote.revision_requested_at)}</p>
                  <p className="mt-1 whitespace-pre-line">&ldquo;{quote.revision_note}&rdquo;</p>
                  <p className="mt-1 text-[12px]">We will send you a revised quotation. You can still accept this one below.</p>
                </div>
              )}

              <div className="mt-6 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-5">
                <p className="text-[14px] font-semibold">Accept this quotation, or ask us to revise it</p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">
                  Accepting confirms the booking and our team goes ahead. Nothing is charged at this point.
                </p>

                <label className="mt-4 block">
                  <span className="mb-1 block text-[12px] text-[#6b7280]">Your name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Optional"
                    className="h-10 w-full rounded-lg border border-[#d1d5db] px-3 text-[14px]"
                  />
                </label>

                {!revising && (
                  <label className="mt-3 block">
                    <span className="mb-1 block text-[12px] text-[#6b7280]">Anything we should know</span>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px]"
                    />
                  </label>
                )}

                {revising && (
                  <label className="mt-3 block">
                    <span className="mb-1 block text-[12px] text-[#6b7280]">What would you like revised?</span>
                    <textarea
                      value={change}
                      onChange={(e) => setChange(e.target.value)}
                      rows={4}
                      autoFocus
                      maxLength={2000}
                      placeholder="e.g. Please quote without the pickup, we will deliver to your CFS. Can the validity run to month end?"
                      className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px]"
                    />
                  </label>
                )}
                {said && <p className="mt-2 text-[12.5px] text-[#b91c1c]">{said}</p>}

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {!revising ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void accept()}
                        disabled={busy}
                        className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1670b0] text-[15px] font-semibold text-white hover:bg-[#125e94] disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        Accept this quotation
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRevising(true);
                          setSaid(null);
                        }}
                        disabled={busy}
                        className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#1670b0] bg-white text-[15px] font-semibold text-[#1670b0] hover:bg-[#eaf3fb] disabled:opacity-60"
                      >
                        <PencilLine size={16} />
                        Revise this quote
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void revise()}
                        disabled={busy || change.trim().length < 3}
                        className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1670b0] text-[15px] font-semibold text-white hover:bg-[#125e94] disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <PencilLine size={16} />}
                        Send the revision request
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRevising(false);
                          setSaid(null);
                        }}
                        disabled={busy}
                        className="flex h-11 items-center justify-center rounded-lg border border-[#d1d5db] bg-white text-[14px] text-[#374151] hover:bg-[#f3f4f6]"
                      >
                        Back
                      </button>
                    </>
                  )}
                </div>

                <p className="mt-3 text-[12px] text-[#6b7280]">
                  You can also simply reply to the email — we are happy to adjust anything.
                </p>
              </div>
            </>
          )}
        </main>

        <footer className="border-t border-[#e2e8f0] bg-[#f6f8fb] px-6 py-4 text-[11.5px] leading-relaxed text-[#64748b] sm:px-7">
          <p className="text-[12.5px] font-bold text-[#0F213A]">{COMPANY.legalName}</p>
          <p>{COMPANY.address.join(", ")}</p>
          <p>
            Tel {COMPANY.phone} · {COMPANY.website} · GSTIN {COMPANY.gstin}
          </p>
          <p className="mt-1.5 text-[#94a3b8]">Business is transacted subject to our standard trading conditions.</p>
        </footer>
      </div>
    </div>
  );
}

function Summary({ quote }: { quote: PublicQuote }) {
  const lane = [quote.origin, quote.destination].filter(Boolean).join(" → ");
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#6b7280]">Prepared for</p>
          <p className="text-[15px] font-semibold">{quote.customer ?? "—"}</p>
        </div>
        <div className="text-right text-[12.5px] leading-relaxed text-[#6b7280]">
          <p>
            <strong className="text-[#1f2937]">Ref</strong> {quotationNumber(quote.reference, quote.version)}
          </p>
          <p>
            <strong className="text-[#1f2937]">Date</strong> {longDate(quote.issued_on)}
          </p>
          {quote.valid_until && (
            <p>
              <strong className="text-[#1f2937]">Valid to</strong> {longDate(quote.valid_until)}
            </p>
          )}
        </div>
      </div>

      {(lane || quote.cargo) && (
        <div className="mt-4 rounded-lg bg-[#f9fafb] px-4 py-3 text-[13px]">
          {lane && <p className="font-medium">{lane}</p>}
          {quote.cargo && <p className="text-[#6b7280]">{quote.cargo}</p>}
        </div>
      )}

      <table className="mt-5 w-full text-[13px]">
        <thead>
          <tr className="bg-[#0F213A] text-left text-[10.5px] uppercase tracking-[0.08em] text-white">
            <th className="px-2.5 py-2.5 font-bold">Charge</th>
            <th className="px-2.5 py-2.5 text-right font-bold">Qty</th>
            <th className="px-2.5 py-2.5 text-right font-bold">Rate</th>
            <th className="px-2.5 py-2.5 text-right font-bold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l, n) => (
            <tr key={n} className="border-b border-[#e2e8f0]">
              <td className="px-2.5 py-3">
                {l.description}
                {l.unit && <span className="block text-[11.5px] text-[#64748b]">per {l.unit}</span>}
              </td>
              <td className="px-2.5 py-3 text-right tabular-nums">{fmt(l.quantity)}</td>
              <td className="whitespace-nowrap px-2.5 py-3 text-right tabular-nums text-[#64748b]">
                {l.currency} {fmt(l.rate)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-3 text-right font-semibold tabular-nums">
                {money(l.amount_inr)}
              </td>
            </tr>
          ))}
          {!quote.lines.length && (
            <tr>
              <td colSpan={4} className="px-2.5 py-3.5 italic text-[#64748b]">
                Charges as discussed.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-[#eaf3fb] text-[#0F213A]">
            <td colSpan={3} className="px-2.5 py-3.5 text-right text-[12px] font-bold uppercase tracking-[0.08em]">
              Total (INR)
            </td>
            <td className="whitespace-nowrap px-2.5 py-3.5 text-right text-[18px] font-extrabold tabular-nums">
              {money(quote.amount_inr)}
            </td>
          </tr>
        </tfoot>
      </table>

      {quote.terms?.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] uppercase tracking-wide text-[#6b7280]">Terms</p>
          <ol className="mt-1.5 list-decimal pl-5 text-[12px] leading-relaxed text-[#6b7280]">
            {quote.terms
              .filter((t) => t.text?.trim())
              .map((t, n) => (
                <li key={n} className="mb-1">
                  {t.text}
                </li>
              ))}
          </ol>
        </div>
      )}
    </>
  );
}

/** Every state that is not "waiting for you", said plainly. */
function Closed({ quote, token, onChanged }: { quote: PublicQuote; token: string; onChanged: () => Promise<void> }) {
  const copy: Record<Exclude<QuoteLinkState, "open">, { title: string; body: string }> = {
    accepted: {
      title: "Booking confirmed",
      body: `Thank you${quote.accepted_name ? `, ${quote.accepted_name}` : ""} — we have your confirmation${
        quote.accepted_at ? ` of ${longDate(quote.accepted_at)}` : ""
      } and our team is going ahead. We will be in touch with the booking details.`,
    },
    expired: {
      title: "This quotation has expired",
      body: "Rates move, so our quotations carry a validity date and this one has passed. Reply to the email it came from and we will re-quote — usually the same day.",
    },
    revoked: {
      title: "This quotation has been withdrawn",
      body: "It has been replaced by a newer version. Please use the most recent quotation we sent, or reply to the email and we will resend it.",
    },
    declined: {
      title: "This quotation was closed",
      body: "It is recorded as not proceeding. If that is wrong, reply to the email and we will reopen it.",
    },
    unknown: {
      title: "We could not find this quotation",
      body: "The link may be incomplete or may have been superseded. Please reply to the email it came from and we will send it again.",
    },
  };
  const c = copy[quote.state as Exclude<QuoteLinkState, "open">] ?? copy.unknown;

  return (
    <>
      <Ended title={c.title} body={c.body} good={quote.state === "accepted"} />
      {quote.state === "accepted" && <ShipperBox quote={quote} token={token} onChanged={onChanged} />}
      {quote.state === "expired" && <RequoteBox quote={quote} token={token} onChanged={onChanged} />}
      {quote.state === "accepted" && <div className="mt-6 opacity-70"><Summary quote={quote} /></div>}
    </>
  );
}

/**
 * The shipper, asked for once the booking is confirmed (114): who we collect
 * from and whose name goes on the bill of lading. Shown back once given, with
 * a way to correct it.
 */
function ShipperBox({ quote, token, onChanged }: { quote: PublicQuote; token: string; onChanged: () => Promise<void> }) {
  const given = quote.shipper ?? null;
  const [editing, setEditing] = useState(!given);
  const [s, setS] = useState<ShipperGiven>(given ?? { name: "", address: "", contact: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  async function save() {
    if (s.name.trim().length < 2 || s.address.trim().length < 5) return setSaid("Give the shipper's name and full address.");
    setBusy(true);
    setSaid(null);
    try {
      const r = await shipperByToken(token, { name: s.name.trim(), address: s.address.trim(), contact: s.contact?.trim() || null, email: s.email?.trim() || null });
      if (!r.ok) setSaid(r.reason === "email" ? "That email address does not look right." : r.reason === "incomplete" ? "Give the shipper's name and full address." : "That did not go through. Please reply to the email instead.");
      else {
        setEditing(false);
        await onChanged();
      }
    } catch {
      setSaid("That did not go through. Please try again, or reply to the email.");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-[#d1d5db] px-3 text-[14px]";
  return (
    <div className="mt-2 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-5">
      <p className="flex items-center gap-2 text-[14px] font-semibold">
        <Truck size={16} className="text-[#1670b0]" /> The shipper
      </p>
      {!editing && given ? (
        <>
          <p className="mt-1 text-[12.5px] text-[#0f6e56]">Received — thank you.</p>
          <div className="mt-2 text-[13.5px] leading-relaxed">
            <p className="font-semibold">{given.name}</p>
            <p className="whitespace-pre-line text-[#374151]">{given.address}</p>
            {(given.contact || given.email) && <p className="text-[#6b7280]">{[given.contact, given.email].filter(Boolean).join(" · ")}</p>}
          </div>
          <button type="button" onClick={() => setEditing(true)} className="mt-3 text-[13px] font-medium text-[#1670b0] hover:underline">
            Correct it
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">
            Who we collect the cargo from, as it should read on the bill of lading.
          </p>
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] text-[#6b7280]">Shipper's company name</span>
            <input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} maxLength={200} className={`h-10 ${field}`} />
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] text-[#6b7280]">Full address, with the PIN code</span>
            <textarea value={s.address} onChange={(e) => setS({ ...s, address: e.target.value })} rows={3} maxLength={1000} className={`py-2 ${field}`} />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px] text-[#6b7280]">Contact person and phone</span>
              <input value={s.contact ?? ""} onChange={(e) => setS({ ...s, contact: e.target.value })} maxLength={200} placeholder="Optional" className={`h-10 ${field}`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-[#6b7280]">Email</span>
              <input type="email" value={s.email ?? ""} onChange={(e) => setS({ ...s, email: e.target.value })} maxLength={200} placeholder="Optional" className={`h-10 ${field}`} />
            </label>
          </div>
          {said && <p className="mt-2 text-[12.5px] text-[#b91c1c]">{said}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1670b0] px-5 text-[15px] font-semibold text-white hover:bg-[#125e94] disabled:opacity-60 sm:flex-none"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Send the shipper's details
            </button>
            {given && (
              <button type="button" onClick={() => setEditing(false)} className="h-11 rounded-lg border border-[#d1d5db] bg-white px-4 text-[14px] text-[#374151]">
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** An expired quotation: ask for a fresh one here, rather than only by reply (114). */
function RequoteBox({ quote, token, onChanged }: { quote: PublicQuote; token: string; onChanged: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (quote.revision_requested_at && quote.revision_note) {
    return (
      <p className="mx-auto mt-2 max-w-sm rounded-lg bg-[#fffbeb] px-4 py-3 text-center text-[13px] text-[#92400e]">
        You asked us to re-quote on {longDate(quote.revision_requested_at)}. We will send the new quotation.
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-5">
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">Ask us to re-quote</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Anything that has changed — the cargo, the dates, the terms."
          className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px]"
        />
      </label>
      {said && <p className="mt-2 text-[12.5px] text-[#b91c1c]">{said}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const note = text.trim() || "Please send a fresh quotation.";
          setBusy(true);
          setSaid(null);
          void requestRevisionByToken(token, note, "")
            .then((r) => (r.ok ? onChanged() : setSaid("That did not go through. Please reply to the email instead.")))
            .catch(() => setSaid("That did not go through. Please reply to the email instead."))
            .finally(() => setBusy(false));
        }}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1670b0] text-[15px] font-semibold text-white hover:bg-[#125e94] disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <PencilLine size={16} />}
        Ask for a new quotation
      </button>
    </div>
  );
}

function Ended({ title, body, good }: { title: string; body: string; good?: boolean }) {
  return (
    <div className="py-6 text-center">
      <span
        className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${
          good ? "bg-[#e7f6ee] text-[#0f6e56]" : "bg-[#f3f4f6] text-[#6b7280]"
        }`}
      >
        {good ? <Check size={20} /> : <AlertCircle size={20} />}
      </span>
      <p className="mt-3 text-[16px] font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-[#6b7280]">{body}</p>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const money = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
