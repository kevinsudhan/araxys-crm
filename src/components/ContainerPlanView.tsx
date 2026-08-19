import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import StatusPill from "./StatusPill";
import { getSlotPlan, type SlotPlan, type PlacedConsignment } from "../services/backend";

/**
 * Hybrid 2D/3D load plan.
 *
 * The main view is an isometric projection of the container with every consignment drawn
 * where it actually sits; alongside it are a top-down plan and a side elevation, because
 * those two flat views answer the questions the 3D view is bad at — how much floor is
 * left, and how high things are stacked.
 *
 * Isometric mapping, with x along the container, y up, z across:
 *   sx = (x - z) * cos30      sy = (x + z) * sin30 - y
 * That makes the top, far-x and far-z faces of every box the visible ones.
 */

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** [top, left face, right face] per client — light to dark gives the 3D read. */
const PALETTE: Array<[string, string, string]> = [
  ["#9FE1CB", "#1D9E75", "#0F6E56"],
  ["#B5D4F4", "#378ADD", "#185FA5"],
  ["#FAC775", "#BA7517", "#854F0B"],
  ["#CECBF6", "#7F77DD", "#534AB7"],
  ["#F5C4B3", "#D85A30", "#993C1D"],
  ["#C0DD97", "#639922", "#3B6D11"],
  ["#F4C0D1", "#D4537E", "#993556"],
  ["#D3D1C7", "#888780", "#5F5E5A"],
];

const paletteFor = (i: number) => PALETTE[i % PALETTE.length];

interface Box {
  x: number;
  y: number;
  z: number;
  l: number;
  w: number;
  h: number;
  colorIndex: number;
  client: string;
}

/** Expands consignments into individual pieces; merges very large ones to stay legible. */
function toBoxes(consignments: PlacedConsignment[]): Box[] {
  const boxes: Box[] = [];
  for (const c of consignments) {
    const spanW = c.piecesAcross * c.pieceWidthM;
    const spanH = c.piecesHigh * c.pieceHeightM;

    if (c.quantity > 60) {
      boxes.push({
        x: c.xM, y: 0, z: 0,
        l: c.lengthM, w: spanW, h: spanH,
        colorIndex: c.colorIndex, client: c.clientName,
      });
      continue;
    }

    let placed = 0;
    for (let r = 0; r < c.rows && placed < c.quantity; r++) {
      for (let a = 0; a < c.piecesAcross && placed < c.quantity; a++) {
        for (let s = 0; s < c.piecesHigh && placed < c.quantity; s++) {
          boxes.push({
            x: c.xM + r * c.pieceLengthM,
            y: s * c.pieceHeightM,
            z: a * c.pieceWidthM,
            l: c.pieceLengthM,
            w: c.pieceWidthM,
            h: c.pieceHeightM,
            colorIndex: c.colorIndex,
            client: c.clientName,
          });
          placed++;
        }
      }
    }
  }
  // Painter's algorithm: further boxes (smaller x+z) first, then lower ones.
  return boxes.sort((a, b) => a.x + a.z - (b.x + b.z) || a.y - b.y);
}

function IsoView({ plan }: { plan: SlotPlan }) {
  const { container, consignments } = plan;
  const L = container.lengthM;
  const W = container.widthM;
  const H = container.heightM;

  const spanW = (L + W) * COS30;
  const spanH = (L + W) * SIN30 + H;
  const scale = 560 / spanW;
  const pad = 34;

  const px = (x: number, y: number, z: number) => ({
    x: (x - z) * COS30 * scale + W * COS30 * scale + pad,
    y: ((x + z) * SIN30 - y) * scale + H * scale + pad,
  });
  const pt = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

  const boxes = toBoxes(consignments);

  function faces(b: Box) {
    const top = [px(b.x, b.y + b.h, b.z), px(b.x + b.l, b.y + b.h, b.z), px(b.x + b.l, b.y + b.h, b.z + b.w), px(b.x, b.y + b.h, b.z + b.w)];
    const right = [px(b.x + b.l, b.y + b.h, b.z), px(b.x + b.l, b.y + b.h, b.z + b.w), px(b.x + b.l, b.y, b.z + b.w), px(b.x + b.l, b.y, b.z)];
    const left = [px(b.x, b.y + b.h, b.z + b.w), px(b.x + b.l, b.y + b.h, b.z + b.w), px(b.x + b.l, b.y, b.z + b.w), px(b.x, b.y, b.z + b.w)];
    return { top, right, left };
  }

  // Container floor and the two back walls, drawn behind the cargo.
  const floor = [px(0, 0, 0), px(L, 0, 0), px(L, 0, W), px(0, 0, W)];
  const backWall = [px(0, 0, 0), px(0, H, 0), px(0, H, W), px(0, 0, W)];
  const sideWall = [px(0, 0, 0), px(0, H, 0), px(L, H, 0), px(L, 0, 0)];

  // Outline of the empty space still available, so "what's left" is visible not inferred.
  const usedL = plan.used.lengthM;
  const freeStart = Math.min(usedL, L);

  return (
    <svg viewBox={`0 0 ${spanW * scale + pad * 2} ${spanH * scale + pad * 2}`} className="w-full">
      <polygon points={floor.map(pt).join(" ")} fill="#efeee9" stroke="#d3d1c7" strokeWidth="1" />
      <polygon points={sideWall.map(pt).join(" ")} fill="#f6f5f2" stroke="#d3d1c7" strokeWidth="1" />
      <polygon points={backWall.map(pt).join(" ")} fill="#f1f0ec" stroke="#d3d1c7" strokeWidth="1" />

      {freeStart < L - 0.01 && (
        <polygon
          points={[px(freeStart, 0, 0), px(L, 0, 0), px(L, 0, W), px(freeStart, 0, W)].map(pt).join(" ")}
          fill="#1D9E75"
          fillOpacity="0.1"
          stroke="#1D9E75"
          strokeDasharray="4 3"
          strokeWidth="1"
        />
      )}

      {boxes.map((b, i) => {
        const [top, left, right] = paletteFor(b.colorIndex);
        const f = faces(b);
        return (
          <g key={i}>
            <polygon points={f.left.map(pt).join(" ")} fill={left} stroke="#ffffff" strokeWidth="0.6" />
            <polygon points={f.right.map(pt).join(" ")} fill={right} stroke="#ffffff" strokeWidth="0.6" />
            <polygon points={f.top.map(pt).join(" ")} fill={top} stroke="#ffffff" strokeWidth="0.6" />
          </g>
        );
      })}

      {consignments.map((c) => {
        const cx = c.xM + c.lengthM / 2;
        const cz = (c.piecesAcross * c.pieceWidthM) / 2;
        const cy = c.piecesHigh * c.pieceHeightM;
        const p = px(cx, cy, cz);
        return (
          <text
            key={c.id}
            x={p.x}
            y={p.y - 8}
            textAnchor="middle"
            fontSize="11"
            fill="#1c1d1a"
            stroke="#ffffff"
            strokeWidth="3"
            paintOrder="stroke"
            fontWeight="500"
          >
            {c.clientName}
          </text>
        );
      })}

      {freeStart < L - 0.01 &&
        (() => {
          const p = px((freeStart + L) / 2, 0, W / 2);
          return (
            <text x={p.x} y={p.y} textAnchor="middle" fontSize="10.5" fill="#0F6E56" stroke="#ffffff" strokeWidth="3" paintOrder="stroke">
              {plan.remaining.lengthM}m free
            </text>
          );
        })()}
    </svg>
  );
}

function FlatViews({ plan }: { plan: SlotPlan }) {
  const { container, consignments } = plan;
  const L = container.lengthM;
  const W = container.widthM;
  const H = container.heightM;
  const w = 560;
  const scale = w / L;

  const Row = ({
    label,
    depth,
    extent,
  }: {
    label: string;
    depth: number;
    extent: (c: PlacedConsignment) => number;
  }) => (
    <div className="mb-3">
      <p className="text-[11px] text-text-secondary mb-1">{label}</p>
      <svg viewBox={`0 0 ${w} ${depth * scale + 2}`} className="w-full">
        <rect x="0" y="1" width={w} height={depth * scale} fill="#f6f5f2" stroke="#d3d1c7" strokeWidth="1" />
        {consignments.map((c) => {
          const [top, mid] = paletteFor(c.colorIndex);
          const e = extent(c) * scale;
          return (
            <g key={c.id}>
              <rect
                x={c.xM * scale}
                y={depth * scale - e + 1}
                width={c.lengthM * scale}
                height={e}
                fill={top}
                stroke={mid}
                strokeWidth="1"
              />
              {c.lengthM * scale > 54 && (
                <text
                  x={c.xM * scale + (c.lengthM * scale) / 2}
                  y={depth * scale - e / 2 + 5}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#1c1d1a"
                >
                  {c.clientName.split(" ")[0]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );

  return (
    <div>
      <Row label={`Top-down plan — floor use across ${W}m width`} depth={W} extent={(c) => c.piecesAcross * c.pieceWidthM} />
      <Row label={`Side elevation — stacking against ${H}m height`} depth={H} extent={(c) => c.piecesHigh * c.pieceHeightM} />
      <div className="flex justify-between text-[10px] text-text-muted">
        <span>0m</span>
        <span>{L}m (back of container to doors)</span>
      </div>
    </div>
  );
}

export default function ContainerPlanView({ slotId, onClose }: { slotId: string; onClose: () => void }) {
  const [plan, setPlan] = useState<SlotPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSlotPlan(slotId).then(setPlan).catch((e) => setError(String(e)));
  }, [slotId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6" onClick={onClose}>
      <div
        className="bg-surface-1 border border-border rounded-card w-full max-w-4xl max-h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface-1 border-b border-border px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {plan ? `${plan.slot.route} · ${plan.slot.sailingDate}` : "Load plan"}
            </p>
            {plan && (
              <p className="text-xs text-text-secondary mt-0.5">
                {plan.container.code} · {plan.container.lengthM}m × {plan.container.widthM}m × {plan.container.heightM}m
                {" · "}
                {plan.slot.carrier}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {plan && (
              <StatusPill tone={plan.slot.status === "full" ? "danger" : plan.slot.status === "closing_soon" ? "warning" : "success"}>
                {plan.slot.status.replace("_", " ")}
              </StatusPill>
            )}
            <button onClick={onClose} aria-label="Close" className="text-text-secondary hover:text-text-primary">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4">
          {error && <p className="text-[13px] text-text-danger">Couldn't load the plan: {error}</p>}
          {!plan && !error && (
            <p className="text-[13px] text-text-muted flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          )}

          {plan && (
            <>
              {plan.consignments.length === 0 ? (
                <p className="text-[13px] text-text-muted py-8 text-center">
                  This container is empty — the whole {plan.container.lengthM}m is available.
                </p>
              ) : (
                <>
                  <IsoView plan={plan} />
                  <FlatViews plan={plan} />
                </>
              )}

              <div className="grid grid-cols-3 gap-3 mt-4 mb-4">
                <div className="rounded-card bg-surface-2 p-3">
                  <p className="text-xs text-text-secondary">Floor used</p>
                  <p className="text-[15px] font-medium text-text-primary">
                    {plan.used.lengthM}m <span className="text-text-muted text-xs">of {plan.container.lengthM}m</span>
                  </p>
                </div>
                <div className="rounded-card bg-surface-2 p-3">
                  <p className="text-xs text-text-secondary">Payload used</p>
                  <p className="text-[15px] font-medium text-text-primary">
                    {plan.used.weightKg.toLocaleString("en-IN")}kg{" "}
                    <span className="text-text-muted text-xs">of {plan.container.maxPayloadKg.toLocaleString("en-IN")}kg</span>
                  </p>
                </div>
                <div className="rounded-card bg-surface-2 p-3">
                  <p className="text-xs text-text-secondary">Still free</p>
                  <p className="text-[15px] font-medium text-text-success">
                    {plan.remaining.lengthM}m <span className="text-text-muted text-xs">· {plan.remaining.cbm} CBM</span>
                  </p>
                </div>
              </div>

              <p className="text-sm font-medium text-text-primary mb-2">Consignments in this container</p>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-secondary">
                    <th className="py-2">Client</th>
                    <th className="py-2 w-28">Reference</th>
                    <th className="py-2 w-24">Position</th>
                    <th className="py-2 w-32">Arrangement</th>
                    <th className="py-2 w-20">Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.consignments.map((c) => {
                    const [top, mid] = paletteFor(c.colorIndex);
                    return (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="py-2">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-sm inline-block"
                              style={{ background: top, border: `1px solid ${mid}` }}
                            />
                            <span className="text-text-primary">{c.clientName}</span>
                          </span>
                        </td>
                        <td className="py-2 font-mono text-xs text-text-secondary">{c.reference}</td>
                        <td className="py-2 text-text-secondary">
                          {c.xM}–{Math.round((c.xM + c.lengthM) * 100) / 100}m
                        </td>
                        <td className="py-2 text-text-secondary">
                          {c.quantity} pcs · {c.piecesAcross}×{c.piecesHigh}×{c.rows}
                        </td>
                        <td className="py-2 text-text-secondary">{c.weightKg.toLocaleString("en-IN")}kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
