import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Check, Plane, Ship, Truck, TrainFront } from "lucide-react";
import type { Enquiry } from "../services/enquiries";
import ShipmentRouteMap from "../components/ShipmentRouteMap";
import { trackingByToken, type PublicTracking } from "../services/tracking";
import { customerView, expectedFor, milestoneWhen } from "../lib/milestones";
import { SectionSkeleton } from "../components/Loading";
import { COMPANY, MAIL_LOGO_PATH } from "../lib/company";

/**
 * The customer's tracking page: /t/:token, no account needed.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SHOWS, AND WHO DECIDED
 *
 * The milestones the desk recorded on the job's Tracking tab — booking
 * confirmed, picked up, sailed, arrived, delivered, and any update of their
 * own — each with its day, the time if known, where, and a note; then what is
 * still to come. Beside them the booking's own details: the route, the carrier
 * and the flight or vessel, the ETD and ETA, the house bill, the boxes.
 *
 * Nothing on it moves by itself (102). No carrier's feed, no ship's position,
 * no internal step and no date a rule worked out reaches this page: a
 * customer is told what somebody at the desk checked and wrote down. Money,
 * notes and the office's own people are not in the answer either.
 *
 * It reads again every five minutes while it is open, and when the tab comes
 * back into view, so a milestone recorded while the customer has it open
 * appears without a reload.
 *
 * The same shell as the quotation page and the mails — the logo on navy, the
 * blue rule, the registered details at the foot: somebody opening it on a
 * phone from a mail should see their shipment, from the company that sent it,
 * not an application.
 * ---------------------------------------------------------------------------
 */

const INK = "#1f2937";
const MUTED = "#6b7280";
const FAINT = "#9ca3af";
const BRAND = "#0F213A";
const DONE = "#2f7a4f";
const LINE = "#e5e7eb";

const REFRESH_MS = 5 * 60_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A booking date, with its time when the booking has one. */
const day = (d: string | null | undefined, time?: string | null) => (d ? milestoneWhen(d, time) : null);

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = new Date(iso);
  return `on ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default function TrackShipment() {
  const { token = "" } = useParams();
  const [t, setT] = useState<PublicTracking | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    void trackingByToken(token)
      .then((x) => {
        setT(x);
        setFailed(false);
      })
      // A refresh that fails keeps what is on screen; only a first load that
      // fails shows the "could not find" message, because `t` is still empty.
      .catch(() => setFailed(true));
  }, [token]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  return (
    <div className="min-h-screen bg-[#eef2f7] px-4 py-8" style={{ color: INK }}>
      <div className="mx-auto w-full max-w-[680px] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-[0_12px_32px_-18px_rgba(15,33,58,0.35)]">
        <header className="px-6 pb-5 pt-6 text-white sm:px-7" style={{ background: BRAND }}>
          <img src={MAIL_LOGO_PATH} alt={COMPANY.legalName} width={300} className="block h-auto w-[300px] max-w-full" />
          <p className="mt-5 border-t border-[#24395a] pt-4 text-[20px] font-extrabold tracking-[0.16em]">SHIPMENT TRACKING</p>
        </header>
        <div className="h-1 bg-[#1670b0]" />

        <main className="px-5 py-6 sm:px-7">
          {!t && !failed ? (
            <SectionSkeleton lines={4} label="Loading the shipment" className="py-6" />
          ) : !t || t.state === "unknown" ? (
            <Ended
              title="We could not find this shipment"
              body="The link may be incomplete. Please reply to the email it came from and we will send it again."
            />
          ) : t.state === "revoked" ? (
            <Ended
              title="This tracking link is no longer active"
              body="Please contact us for the latest on your shipment and we will send a new link."
            />
          ) : (
            <Shipment t={t} />
          )}
        </main>

        <footer className="border-t border-[#e2e8f0] bg-[#f6f8fb] px-6 py-4 text-[11.5px] leading-relaxed text-[#64748b] sm:px-7">
          <p className="text-[12.5px] font-bold text-[#0F213A]">{COMPANY.legalName}</p>
          <p>{COMPANY.address.join(", ")}</p>
          <p>
            Tel {COMPANY.phone} · {COMPANY.website}
          </p>
        </footer>
      </div>
      <p className="mt-3 text-center text-[11px]" style={{ color: FAINT }}>
        Updated by our operations team as your shipment moves. No login is needed.
      </p>
    </div>
  );
}

function Shipment({ t }: { t: PublicTracking }) {
  const mode = (t.mode ?? null) as Enquiry["transport_mode"];
  const air = mode === "air";
  const cancelled = Boolean(t.cancelled);
  const view = useMemo(() => customerView(t.milestones ?? []), [t.milestones]);
  const booking = { etd: t.etd ?? null, eta: t.eta ?? null };
  const legs = t.legs ?? [];
  // Keyed on the answer, not on `legs`, which is a new array every render.
  const mapLegs = useMemo(() => (t.legs ?? []).map((l) => ({ move: l.move, from: l.from, to: l.to, status: "planned" })), [t.legs]);
  const anyTime = view.done.some((m) => m.reached_time);
  const cargo = [
    t.pieces ? `${t.pieces} pcs` : null,
    t.gross_weight_kg ? `${Number(t.gross_weight_kg).toLocaleString("en-IN")} kg` : null,
    t.volume_cbm ? `${Number(t.volume_cbm)} CBM` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <p className="text-[12px]" style={{ color: MUTED }}>
        {t.reference}
        {t.customer ? ` · ${t.customer}` : ""}
      </p>
      <p className="mt-1 text-[19px] font-semibold leading-snug">{[t.origin, t.destination].filter(Boolean).join(" → ")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {cancelled ? (
          <span className="inline-block rounded-full bg-[#fdecec] px-3 py-1 text-[12.5px] font-semibold text-[#b42318]">Cancelled</span>
        ) : (
          view.latest && (
            <span className="inline-block rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ background: "#e8f0f7", color: BRAND }}>
              {view.latest.label} · {milestoneWhen(view.latest.reached_on, null, false)}
            </span>
          )
        )}
        {t.updated_at && (
          <span className="text-[11.5px]" style={{ color: FAINT }}>
            Last updated {ago(t.updated_at)}
          </span>
        )}
      </div>

      {cancelled ? (
        <p className="mt-5 rounded-lg bg-[#fdecec] px-4 py-3 text-[13px] text-[#b42318]">
          This shipment has been cancelled. Please contact us if you were not expecting this.
        </p>
      ) : (
        <Section title="Progress">
          <ol aria-label="Progress">
            {view.done.map((m, i) => (
              <Milestone
                key={`d${i}`}
                label={m.label}
                done
                latest={m === view.latest}
                when={milestoneWhen(m.reached_on, m.reached_time)}
                where={m.location}
                note={m.note}
                lineDone={i < view.done.length - 1}
                last={i === view.done.length - 1 && !view.ahead.length}
              />
            ))}
            {view.ahead.map((m, i) => {
              const expected = expectedFor(m, booking);
              return (
                <Milestone
                  key={`a${i}`}
                  label={m.label}
                  done={false}
                  latest={false}
                  when={expected ? `Expected ${milestoneWhen(expected)}` : null}
                  where={null}
                  note={m.note}
                  lineDone={false}
                  last={i === view.ahead.length - 1}
                />
              );
            })}
          </ol>
          {anyTime && (
            <p className="mt-3 text-[11px]" style={{ color: FAINT }}>
              Times are local to where each step happened.
            </p>
          )}
        </Section>
      )}

      {!cancelled && (
        <div className="mt-6">
          <ShipmentRouteMap
            input={{
              mode,
              stage: view.stage,
              pol: t.port_of_loading ?? t.origin ?? null,
              pod: t.port_of_discharge ?? t.destination ?? null,
              finalDestination: t.destination ?? null,
              legs: mapLegs,
            }}
            loadPositions={async () => []}
            canLookUp={false}
            height={300}
          />
        </div>
      )}

      <Section title="Shipment details">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <Item label={air ? "Airline" : "Carrier"} value={t.carrier} />
          <Item label={air ? "Flight" : "Vessel"} value={air ? t.flight_number : [t.vessel, t.voyage].filter(Boolean).join(" / ") || null} />
          <Item label={air ? "Airport of loading" : "Port of loading"} value={t.port_of_loading} />
          <Item label={air ? "Airport of discharge" : "Port of discharge"} value={t.port_of_discharge} />
          <Item label="Departure (ETD)" value={day(t.etd, t.etd_time)} />
          <Item label="Arrival (ETA)" value={day(t.eta, t.eta_time)} />
          <Item label={air ? "HAWB" : "House B/L"} value={t.house_bill} />
          <Item label="Cargo" value={cargo || null} />
          {(t.containers ?? []).length > 0 && (
            <div className="col-span-2">
              <dt className="text-[11.5px]" style={{ color: MUTED }}>
                Container{t.containers!.length === 1 ? "" : "s"}
              </dt>
              <dd className="mt-0.5 flex flex-wrap gap-1.5">
                {t.containers!.map((c) => (
                  <span key={c.number} className="rounded bg-[#f3f4f6] px-2 py-0.5 font-mono text-[12px]">
                    {c.number}
                    {c.type ? <span style={{ color: MUTED }}> · {c.type}</span> : null}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      {legs.length > 0 && (
        <Section title="Route">
          <ol className="space-y-2.5">
            {legs.map((l, i) => {
              const Icon = l.move === "air" ? Plane : l.move === "sea" ? Ship : l.move === "rail" ? TrainFront : Truck;
              return (
                <li key={i} className="flex items-start gap-3 text-[13px]">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#f3f4f6]" style={{ color: BRAND }}>
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{[l.from, l.to].filter(Boolean).join(" → ") || "Leg"}</p>
                    <p className="text-[11.5px]" style={{ color: MUTED }}>
                      {[l.carrier, l.voyage_flight, [day(l.etd), day(l.eta)].filter(Boolean).join(" → ")].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      <p className="mt-6 border-t border-[#e5e7eb] pt-4 text-[12px]" style={{ color: MUTED }}>
        Questions about this shipment? Reply to our last email and keep <strong>{t.reference}</strong> in the subject.
      </p>
    </>
  );
}

/** One milestone on the line: a dot, the line down to the next, what and when. */
function Milestone({
  label,
  done,
  latest,
  when,
  where,
  note,
  lineDone,
  last,
}: {
  label: string;
  done: boolean;
  latest: boolean;
  when: string | null;
  where: string | null;
  note: string | null;
  /** The line down to the next milestone is green: that one is done too. */
  lineDone: boolean;
  last: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute bottom-0 left-[11px] top-6 w-[2px]" style={{ background: lineDone ? DONE : LINE }} />}
      <span
        className="relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-white"
        style={
          latest
            ? { borderColor: DONE, background: DONE, boxShadow: "0 0 0 4px #e8f5ee" }
            : done
              ? { borderColor: DONE, background: DONE }
              : { borderColor: "#d1d5db", background: "#fff" }
        }
      >
        {done && <Check size={12} strokeWidth={3} />}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={`text-[13.5px] leading-snug ${latest ? "font-semibold" : done ? "font-medium" : ""}`} style={{ color: done ? INK : MUTED }}>
          {label}
        </p>
        {(when || where) && (
          <p className="mt-0.5 text-[12px]" style={{ color: done ? MUTED : FAINT }}>
            {[when, where].filter(Boolean).join(" · ")}
          </p>
        )}
        {note && (
          <p className="mt-1 whitespace-pre-line text-[12.5px] leading-snug" style={{ color: done ? INK : MUTED }}>
            {note}
          </p>
        )}
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px]" style={{ color: MUTED }}>
        {label}
      </dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function Ended({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-6">
      <p className="text-[16px] font-semibold">{title}</p>
      <p className="mt-2 text-[13px]" style={{ color: MUTED }}>
        {body}
      </p>
    </div>
  );
}
