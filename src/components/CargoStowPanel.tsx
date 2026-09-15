import { useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import ContainerScene from "./ContainerScene";
import type { Enquiry } from "../services/enquiries";
import type { PlacedConsignment, SlotPlan } from "../services/backend";

/**
 * This enquiry's cargo, drawn to scale inside a standard container.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY
 *
 * This began as a demonstration panel. It invented a container number, then
 * three neighbouring consignments to sit behind the caller's cargo so the box
 * looked like a working groupage load, and carried a warning banner explaining
 * that most of what you were looking at was made up.
 *
 * All of that is gone. What is drawn now is only the caller's own cargo: the
 * piece count, the three dimensions and the weight, exactly as they were
 * established on the call and read off the transcript. Nothing sits behind it,
 * because nothing has been booked behind it.
 *
 * The container is the one honest piece of scenery left, and it is not invented
 * either — a 40HC's internal dimensions are a physical fact about a standard
 * box, the same on every quay in the world. It is what the cargo is being
 * measured against, not a container anybody has been given.
 *
 * The panel disappears entirely when the measurements do. A block drawn from
 * guessed dimensions would be the one invention this codebase exists to refuse,
 * and an enquiry with no dimensions yet has nothing to show.
 * ---------------------------------------------------------------------------
 */

/** A 40HC, which is what the Singapore and Jebel Ali lanes run. */
const CONTAINER = {
  code: "40HC",
  lengthM: 12.03,
  widthM: 2.35,
  heightM: 2.69,
  maxPayloadKg: 28600,
};

export default function CargoStowPanel({ enquiry }: { enquiry: Enquiry }) {
  const [selected, setSelected] = useState<string | null>("theirs");

  const plan: SlotPlan | null = useMemo(() => {
    const n = enquiry.piece_count;
    const l = enquiry.piece_length_cm;
    const w = enquiry.piece_width_cm;
    const h = enquiry.piece_height_cm;
    if (!n || !l || !w || !h) return null;

    const pieceL = l / 100;
    const pieceW = w / 100;
    const pieceH = h / 100;

    // How the block actually stacks in a 2.35 m wide, 2.69 m high box. Cargo
    // marked not stackable is laid in a single tier however tall the box is,
    // which is the whole reason the desk asks the question.
    const across = Math.max(1, Math.min(n, Math.floor(CONTAINER.widthM / pieceW) || 1));
    const tiersThatFit = Math.floor(CONTAINER.heightM / pieceH) || 1;
    const high =
      enquiry.stackable === false
        ? 1
        : Math.max(1, Math.min(Math.ceil(n / across), tiersThatFit));
    const rows = Math.max(1, Math.ceil(n / (across * high)));
    const usedLength = Number((rows * pieceL).toFixed(2));

    const theirs: PlacedConsignment = {
      id: "theirs",
      slotId: "cargo",
      clientName: "This enquiry",
      reference: enquiry.ref,
      xM: 0,
      lengthM: usedLength,
      piecesAcross: across,
      piecesHigh: high,
      rows,
      quantity: n,
      pieceLengthM: pieceL,
      pieceWidthM: pieceW,
      pieceHeightM: pieceH,
      weightKg: Number(enquiry.gross_weight_kg ?? (enquiry.weight_per_piece_kg ?? 0) * n),
      colorIndex: 0,
      source: "crm",
    };

    const remaining = {
      lengthM: Number((CONTAINER.lengthM - usedLength).toFixed(2)),
      payloadKg: Math.max(0, CONTAINER.maxPayloadKg - theirs.weightKg),
      cbm: Number(((CONTAINER.lengthM - usedLength) * CONTAINER.widthM * CONTAINER.heightM).toFixed(2)),
    };

    return {
      slot: {
        id: "cargo",
        route: [enquiry.origin, enquiry.destination].filter(Boolean).join(" to ") || "—",
        carrier: "",
        sailingDate: "",
        cutoffDate: "",
        containerCode: CONTAINER.code,
        mode: "LCL",
        usedLengthM: usedLength,
        usedWeightKg: theirs.weightKg,
        consignmentCount: 1,
        status: "open",
        internal: CONTAINER,
        remaining,
      },
      container: CONTAINER,
      consignments: [theirs],
      used: { lengthM: usedLength, weightKg: theirs.weightKg },
      frontier: usedLength,
      trappedM: 0,
      remaining,
    };
  }, [enquiry]);

  if (!plan) return null;

  const theirs = plan.consignments[0];
  const positions = { theirs: 0 };
  const floorPct = Math.round((theirs.lengthM / CONTAINER.lengthM) * 100);

  return (
    <section className="mt-4 card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <Boxes size={12} /> How this cargo stows
        </h2>
        <span className="text-[11px] text-text-muted">
          Measured against a standard {CONTAINER.code}
        </span>
      </div>

      <p className="text-[12px] text-text-secondary mb-3 max-w-prose leading-relaxed">
        <strong className="text-text-primary">{theirs.quantity} pieces</strong> at{" "}
        {enquiry.piece_length_cm} × {enquiry.piece_width_cm} × {enquiry.piece_height_cm} cm, stacked{" "}
        {theirs.piecesAcross} across and {theirs.piecesHigh} high
        {enquiry.stackable === false && " — a single tier, because the cargo is marked not stackable"}
        , taking <strong className="text-text-primary">{theirs.lengthM} m</strong> of floor.
      </p>

      <div className="rounded-lg border border-border overflow-hidden">
        <ContainerScene
          plan={plan}
          positions={positions}
          onMove={() => {}}
          onRestow={() => {}}
          dragMode="nudge"
          selectedId={selected}
          onSelect={setSelected}
          explode={0}
          editable={false}
          autoSpin
        />
      </div>

      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ["Floor used", `${theirs.lengthM} m`, `${floorPct}% of the box`],
          ["Gross weight", `${theirs.weightKg.toLocaleString("en-IN")} kg`, "From the call"],
          ["Floor left", `${plan.remaining.lengthM} m`, `${plan.remaining.cbm} CBM`],
          ["Payload left", `${plan.remaining.payloadKg.toLocaleString("en-IN")} kg`, "To the limit"],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
            <dt className="text-[11px] text-text-secondary">{label}</dt>
            <dd className="text-[14px] font-medium text-text-primary tabular-nums">{value}</dd>
            <dd className="text-[11px] text-text-muted">{hint}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] text-text-muted leading-relaxed">
        Drawn from this enquiry's own measurements against a standard container's internal
        dimensions. No space has been reserved and nothing is booked on a sailing — the space board
        is where that happens.
      </p>
    </section>
  );
}
