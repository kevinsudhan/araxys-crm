import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { AlertCircle, Check, Download, Loader2, PencilLine } from "lucide-react";
import { SectionSkeleton } from "../components/Loading";
import { COMPANY, MAIL_LOGO_PATH } from "../lib/company";
import { normaliseHbl, type HblData } from "../lib/hbl";
import { hblFileName, renderHblPdf } from "../lib/documents/hblPdf";
import { answerHblDraft, hblDraftByToken, type PublicHblDraft } from "../services/publicHbl";

/**
 * The page a shipper lands on from the draft house B/L mail (123).
 *
 * Like the quotation page: somebody outside the company, on a phone, with one
 * thing to do — approve the draft or say what to correct. Arriving records
 * nothing, because mail gateways open every link; only a press does. The
 * draft shown is the one that was mailed, and the PDF is made from it here.
 */
export default function HblDraft() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<PublicHblDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Came by "Ask for a correction" (?correct=1): the box for it is open from the start. */
  const [correcting, setCorrecting] = useState(() => params.get("correct") === "1");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setDraft(await hblDraftByToken(token));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function answer(approve: boolean) {
    if (!approve && note.trim().length < 3) return setSaid("Say what should be corrected.");
    setBusy(true);
    setSaid(null);
    try {
      const r = await answerHblDraft(token, approve, name.trim(), approve ? "" : note.trim());
      if (!r.ok) {
        setSaid(
          r.reason === "issued"
            ? "This B/L has been issued already. Please reply to the email."
            : r.reason === "withdrawn"
              ? "This draft has been withdrawn; a corrected one is on its way."
              : r.reason === "empty"
                ? "Say what should be corrected."
                : "That did not go through. Please reply to the email instead."
        );
      } else {
        setCorrecting(false);
        setNote("");
      }
      await load();
    } catch {
      setSaid("That did not go through. Please try again, or reply to the email.");
    } finally {
      setBusy(false);
    }
  }

  const snap = draft?.draft ?? null;
  const data: HblData | null = snap ? normaliseHbl(snap.data as Partial<HblData>) : null;
  const amendment = snap?.amendment ?? 0;

  function download() {
    if (!snap || !data) return;
    const input = { data, hblNo: snap.hbl_no, release: snap.release_mode, originals: snap.originals, print: "draft" as const, amendment };
    renderHblPdf(input).save(hblFileName(input));
  }

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-8 text-[#1f2937]">
      <div className="mx-auto w-full max-w-[640px] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_12px_32px_-18px_rgba(15,33,58,0.35)]">
        <header className="bg-[#0F213A] px-6 pb-5 pt-6 text-white sm:px-7">
          <img src={MAIL_LOGO_PATH} alt={COMPANY.legalName} width={300} className="block h-auto w-[300px] max-w-full" />
          <p className="mt-5 border-t border-[#24395a] pt-4 text-[20px] font-extrabold tracking-[0.16em]">{amendment ? "DRAFT B/L — AMENDED" : "DRAFT HOUSE B/L"}</p>
          {draft?.hbl_no && <p className="mt-1 font-mono text-[13px] text-[#9fb3cc]">{draft.hbl_no}{amendment ? ` · amendment ${amendment}` : ""}</p>}
        </header>
        <div className="h-1 bg-[#1670b0]" />

        <main className="px-6 py-6 sm:px-7">
          {loading ? (
            <SectionSkeleton lines={4} label="Loading the draft" className="py-6" />
          ) : failed || !draft || draft.state === "unknown" ? (
            <Ended title="We could not open this draft" body="The link may be incomplete. Please reply to the email it came from and we will send it again." />
          ) : draft.state === "withdrawn" ? (
            <Ended title="This draft has been withdrawn" body="We are correcting the B/L and will send you a new draft to approve." />
          ) : draft.state === "issued" ? (
            <Ended title={`B/L ${draft.hbl_no ?? ""} has been issued`} body="The originals have been issued. For anything further, please reply to the email." good />
          ) : (
            <>
              {data && <Summary d={data} />}
              <button
                type="button"
                onClick={download}
                className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#d1d5db] bg-white text-[14px] font-medium text-[#374151] hover:bg-[#f3f4f6]"
              >
                <Download size={16} /> Download the draft (PDF)
              </button>

              {draft.state === "approved" && !correcting && (
                <div className="mt-6 rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-3 text-[13px] text-[#065f46]">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <Check size={15} /> You approved this draft{draft.answered_at ? ` on ${longDate(draft.answered_at)}` : ""}
                    {draft.answered_by ? ` (${draft.answered_by})` : ""}
                  </p>
                  <p className="mt-1 text-[12.5px]">Thank you. We will issue the originals. Something not right after all?</p>
                  <button type="button" onClick={() => setCorrecting(true)} className="mt-1 text-[12.5px] font-medium text-[#1670b0] hover:underline">
                    Ask for a correction
                  </button>
                </div>
              )}

              {draft.state === "changes" && draft.note && !correcting && (
                <div className="mt-6 rounded-lg border border-[#fcd34d] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
                  <p className="font-semibold">You asked for corrections{draft.answered_at ? ` on ${longDate(draft.answered_at)}` : ""}</p>
                  <p className="mt-1 whitespace-pre-line">&ldquo;{draft.note}&rdquo;</p>
                  <p className="mt-1 text-[12px]">We will send you a corrected draft. If this one is right after all, you can approve it below.</p>
                </div>
              )}

              {(draft.state !== "approved" || correcting) && (
                <div className="mt-6 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-5">
                  <p className="text-[14px] font-semibold">{correcting ? "What should be corrected?" : "Approve this draft, or ask for a correction"}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[#6b7280]">
                    {correcting
                      ? "Say which box and what it should read; we will send you a corrected draft."
                      : "Please check every detail against your invoice, packing list and letter of credit. The originals are issued once you approve."}
                  </p>

                  <label className="mt-3 block">
                    <span className="mb-1 block text-[12px] text-[#6b7280]">Your name (optional)</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-10 w-full rounded-lg border border-[#d1d5db] px-3 text-[14px]" />
                  </label>
                  {correcting && (
                    <label className="mt-3 block">
                      <span className="mb-1 block text-[12px] text-[#6b7280]">The correction</span>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={4}
                        autoFocus
                        maxLength={2000}
                        placeholder="e.g. Consignee address should read 14 Hafenstrasse, 20457 Hamburg. Please show the LC number in the description."
                        className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-[14px]"
                      />
                    </label>
                  )}
                  {said && <p className="mt-2 text-[12.5px] text-[#b91c1c]">{said}</p>}

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {!correcting ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void answer(true)}
                          disabled={busy}
                          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1670b0] text-[15px] font-semibold text-white hover:bg-[#125e94] disabled:opacity-60"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                          Approve the draft
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCorrecting(true);
                            setSaid(null);
                          }}
                          disabled={busy}
                          className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#1670b0] bg-white text-[15px] font-semibold text-[#1670b0] hover:bg-[#eaf3fb] disabled:opacity-60"
                        >
                          <PencilLine size={16} />
                          Ask for a correction
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => void answer(false)}
                          disabled={busy || note.trim().length < 3}
                          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#1670b0] text-[15px] font-semibold text-white hover:bg-[#125e94] disabled:opacity-60"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <PencilLine size={16} />}
                          Send the correction
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCorrecting(false);
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
                  <p className="mt-3 text-[12px] text-[#6b7280]">You can also simply reply to the email.</p>
                </div>
              )}
            </>
          )}
        </main>

        <footer className="border-t border-[#e2e8f0] bg-[#f6f8fb] px-6 py-4 text-[11.5px] leading-relaxed text-[#64748b] sm:px-7">
          <p className="text-[12.5px] font-bold text-[#0F213A]">{COMPANY.legalName}</p>
          <p>{COMPANY.address.join(", ")}</p>
          <p>
            Tel {COMPANY.phone} · {COMPANY.website} · GSTIN {COMPANY.gstin}
          </p>
        </footer>
      </div>
    </div>
  );
}

/** The draft in brief, box by box as the B/L says it. */
function Summary({ d }: { d: HblData }) {
  const rows: Array<[string, string]> = [
    ["Shipper", [d.shipper_name, d.shipper_address].filter(Boolean).join("\n")],
    ["Consignee", d.consignee_mode === "to_order" ? `TO ORDER${d.consignee_name ? ` OF ${d.consignee_name}` : ""}` : [d.consignee_name, d.consignee_address].filter(Boolean).join("\n")],
    ["Notify party", [d.notify_name, d.notify_address].filter(Boolean).join("\n")],
    ["Vessel / voyage", [d.vessel, d.voyage].filter(Boolean).join(" / ")],
    ["Port of loading", d.port_of_loading],
    ["Port of discharge", d.port_of_discharge],
    ["Place of delivery", d.place_of_delivery],
    ["Containers", d.containers.map((c) => [c.container_no, c.size_type, c.seal_no && `seal ${c.seal_no}`].filter(Boolean).join(" · ")).filter(Boolean).join("\n")],
    ["Marks & numbers", d.marks_numbers],
    ["Packages", [d.packages, d.package_type].filter(Boolean).join(" ")],
    ["Description", d.description],
    ["Gross weight", d.gross_weight_kg ? `${d.gross_weight_kg} KGS` : ""],
    ["Measurement", d.measurement_cbm ? `${d.measurement_cbm} CBM` : ""],
    ["Freight", [d.freight_terms.toUpperCase(), d.freight_payable_at && `payable at ${d.freight_payable_at}`].filter(Boolean).join(", ")],
  ];
  return (
    <dl className="divide-y divide-[#e5e7eb] rounded-lg border border-[#e5e7eb]">
      {rows
        .filter(([, v]) => v && v.trim())
        .map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5 text-[13px] max-sm:grid-cols-1 max-sm:gap-0.5">
            <dt className="text-[#6b7280]">{k}</dt>
            <dd className="whitespace-pre-line break-words font-medium text-[#111827]">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function Ended({ title, body, good }: { title: string; body: string; good?: boolean }) {
  return (
    <div className="py-6 text-center">
      <span className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${good ? "bg-[#e7f6ee] text-[#0f6e56]" : "bg-[#f3f4f6] text-[#6b7280]"}`}>
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
