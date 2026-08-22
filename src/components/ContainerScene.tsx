import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Move3d,
  Maximize2,
  Play,
  Pause,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Hand,
} from "lucide-react";
import {
  DEFAULT_CAMERA,
  PRESETS,
  clampPitch,
  clampZoom,
  depthOf,
  dragToMetres,
  faceCorners,
  mixHex,
  normaliseYaw,
  project,
  projectedBounds,
  proposeMove,
  shade,
  visibleFaces,
  type Camera,
  type FaceName,
  type StowItem,
} from "../lib/scene3d";
import type { PlacedConsignment, SlotPlan } from "../services/backend";

/**
 * The interactive load plan.
 *
 * This replaces a static isometric drawing. The drawing was accurate but you could only
 * ever see the stow from one corner, and the questions people actually ask of a load plan
 * -- what is behind that pallet, can this block move forward, how much floor is really
 * left -- all need a different angle or a different arrangement.
 *
 * So: orbit with a drag, zoom with the wheel, and drag a consignment along the container
 * to restow it. Moves are validated against the same physical constraints the fit engine
 * uses, which is why an illegal position turns red under the pointer instead of snapping
 * silently to somewhere it cannot go.
 *
 * Rendered as SVG rather than WebGL on purpose. The scene is a few hundred flat polygons,
 * the projection is parallel so there is no perspective maths to hand to a GPU, and the
 * whole thing costs nothing in bundle size on a page that has to stay fast.
 */

/** [top, mid, dark] per client. The mid and dark tones get interpolated by face angle. */
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

const VW = 760;
const VH = 430;

interface Piece {
  x: number;
  y: number;
  z: number;
  l: number;
  w: number;
  h: number;
  consignmentId: string;
  colorIndex: number;
}

/**
 * Expands consignments into individual pieces at their real positions.
 *
 * Above 60 pieces the individual cartons stop being readable and start being noise, so a
 * large consignment collapses to one block of its true outer dimensions. The block is
 * still honest about the space it occupies; it just stops pretending you can count the
 * cartons in it.
 */
function toPieces(consignments: PlacedConsignment[], xOf: (c: PlacedConsignment) => number): Piece[] {
  const out: Piece[] = [];
  for (const c of consignments) {
    const baseX = xOf(c);
    if (c.quantity > 60) {
      out.push({
        x: baseX,
        y: 0,
        z: 0,
        l: c.lengthM,
        w: c.piecesAcross * c.pieceWidthM,
        h: c.piecesHigh * c.pieceHeightM,
        consignmentId: c.id,
        colorIndex: c.colorIndex,
      });
      continue;
    }
    let placed = 0;
    for (let r = 0; r < c.rows && placed < c.quantity; r++) {
      for (let a = 0; a < c.piecesAcross && placed < c.quantity; a++) {
        for (let s = 0; s < c.piecesHigh && placed < c.quantity; s++) {
          out.push({
            x: baseX + r * c.pieceLengthM,
            y: s * c.pieceHeightM,
            z: a * c.pieceWidthM,
            l: c.pieceLengthM,
            w: c.pieceWidthM,
            h: c.pieceHeightM,
            consignmentId: c.id,
            colorIndex: c.colorIndex,
          });
          placed++;
        }
      }
    }
  }
  return out;
}

type Gesture =
  | { kind: "none" }
  | { kind: "orbit"; lastX: number; lastY: number }
  | { kind: "pan"; lastX: number; lastY: number }
  | { kind: "move"; id: string; startX: number; startY: number; originM: number; moved: boolean };

export interface SceneProps {
  plan: SlotPlan;
  /** Working positions, keyed by consignment id. Lets the parent own unsaved edits. */
  positions: Record<string, number>;
  onMove: (id: string, xM: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 0 = stowed as loaded, 1 = pulled fully apart to see between the blocks. */
  explode: number;
  /** Set false to make the plan read-only (e.g. a full container). */
  editable?: boolean;
}

export default function ContainerScene({
  plan,
  positions,
  onMove,
  selectedId,
  onSelect,
  explode,
  editable = true,
}: SceneProps) {
  const [cam, setCam] = useState<Camera>(DEFAULT_CAMERA);
  const [spin, setSpin] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const gesture = useRef<Gesture>({ kind: "none" });
  const svgRef = useRef<SVGSVGElement>(null);
  const tween = useRef<number | null>(null);

  const { container, consignments } = plan;
  const L = container.lengthM;
  const W = container.widthM;
  const H = container.heightM;

  // The drawing is fitted to the container's real projected extent at the current angle,
  // and centred on that extent rather than on the geometric middle -- with the cargo at
  // one end, those are not the same point and the difference is a visibly off-centre box.
  const bounds = useMemo(() => projectedBounds(cam, L, H, W), [cam, L, W, H]);
  const scale = useMemo(
    () => Math.min(VW / Math.max(bounds.spanX, 0.001), VH / Math.max(bounds.spanY, 0.001)) * 0.88,
    [bounds]
  );
  const centre = useMemo(
    () => ({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }),
    [bounds]
  );

  const to2d = useCallback(
    (x: number, y: number, z: number) => {
      const p = project(cam, x, y, z);
      return {
        x: VW / 2 + (p.x - centre.x) * scale * cam.zoom + cam.panX,
        y: VH / 2 + (p.y - centre.y) * scale * cam.zoom + cam.panY,
      };
    },
    [cam, centre, scale]
  );

  const pt = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  const poly = useCallback(
    (corners: Array<[number, number, number]>) => corners.map((c) => pt(to2d(c[0], c[1], c[2]))).join(" "),
    [to2d]
  );

  // Exploded positions spread the blocks apart along the container so you can see the
  // faces that are normally buried against a neighbour. It is a diagram mode, so blocks
  // are allowed past the doors -- the container outline stays put as the reference.
  const order = useMemo(
    () => [...consignments].sort((a, b) => (positions[a.id] ?? a.xM) - (positions[b.id] ?? b.xM)),
    [consignments, positions]
  );
  const xOf = useCallback(
    (c: PlacedConsignment) => {
      const base = positions[c.id] ?? c.xM;
      const rank = order.findIndex((o) => o.id === c.id);
      return base + explode * rank * (L * 0.09);
    },
    [positions, order, explode, L]
  );

  const pieces = useMemo(() => toPieces(consignments, xOf), [consignments, xOf]);

  // Painter ordering, recomputed from the camera. This is what keeps the stow solid
  // instead of letting the back row punch through the front one after a rotation.
  const sorted = useMemo(() => {
    const withDepth = pieces.map((p) => ({
      p,
      d: depthOf(cam, p.x + p.l / 2, p.y + p.h / 2, p.z + p.w / 2),
    }));
    withDepth.sort((a, b) => a.d - b.d || a.p.y - b.p.y);
    return withDepth.map((w) => w.p);
  }, [pieces, cam]);

  const faces = useMemo(() => visibleFaces(cam), [cam]);

  // ------------------------------------------------------------------ camera moves

  const glideTo = useCallback((target: { yaw: number; pitch: number }) => {
    setSpin(false);
    if (tween.current) cancelAnimationFrame(tween.current);
    const t0 = performance.now();
    setCam((start) => {
      // Take the short way round the compass, so "top" from the reverse corner does not
      // whip the container through a full turn to get there.
      const from = { ...start, yaw: normaliseYaw(start.yaw) };
      let delta = normaliseYaw(target.yaw) - from.yaw;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;

      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 420);
        const e = 1 - Math.pow(1 - k, 3);
        setCam((c) => ({
          ...c,
          yaw: from.yaw + delta * e,
          pitch: from.pitch + (target.pitch - from.pitch) * e,
          panX: from.panX * (1 - e),
          panY: from.panY * (1 - e),
        }));
        if (k < 1) tween.current = requestAnimationFrame(step);
      };
      tween.current = requestAnimationFrame(step);
      return from;
    });
  }, []);

  useEffect(() => () => { if (tween.current) cancelAnimationFrame(tween.current); }, []);

  useEffect(() => {
    if (!spin) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCam((c) => ({ ...c, yaw: c.yaw + dt * 0.42 }));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  const reset = () => {
    setSpin(false);
    setCam(DEFAULT_CAMERA);
  };

  // ------------------------------------------------------------------ pointer input

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const id = (e.target as SVGElement).dataset?.cid;
    if (id && editable && e.button === 0 && !e.shiftKey) {
      setSpin(false);
      onSelect(id);
      const c = consignments.find((x) => x.id === id)!;
      gesture.current = {
        kind: "move",
        id,
        startX: e.clientX,
        startY: e.clientY,
        originM: positions[id] ?? c.xM,
        moved: false,
      };
      return;
    }
    if (e.shiftKey || e.button === 1) {
      gesture.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY };
      return;
    }
    setSpin(false);
    gesture.current = { kind: "orbit", lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (g.kind === "none") return;

    if (g.kind === "orbit") {
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      gesture.current = { ...g, lastX: e.clientX, lastY: e.clientY };
      setCam((c) => ({ ...c, yaw: c.yaw + dx * 0.008, pitch: clampPitch(c.pitch + dy * 0.006) }));
      return;
    }

    if (g.kind === "pan") {
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      gesture.current = { ...g, lastX: e.clientX, lastY: e.clientY };
      // The SVG is scaled to its container width, so pointer pixels have to be converted
      // into viewBox units or panning drifts away from the cursor at other widths.
      const rect = svgRef.current?.getBoundingClientRect();
      const k = rect ? VW / rect.width : 1;
      setCam((c) => ({ ...c, panX: c.panX + dx * k, panY: c.panY + dy * k }));
      return;
    }

    // Dragging a consignment. It may only slide along the container, so the pointer
    // travel is projected onto the screen image of the x axis.
    const rect = svgRef.current?.getBoundingClientRect();
    const k = rect ? VW / rect.width : 1;
    const metres = dragToMetres(
      cam,
      (e.clientX - g.startX) * k,
      (e.clientY - g.startY) * k,
      scale * cam.zoom
    );
    if (metres === null) {
      setRefusal("Turn the container -- you cannot slide cargo from straight down its length");
      return;
    }
    const items: StowItem[] = consignments.map((c) => ({
      id: c.id,
      xM: positions[c.id] ?? c.xM,
      lengthM: c.lengthM,
    }));
    const r = proposeMove(items, g.id, g.originM + metres, L);
    setRefusal(r.ok ? r.reason ?? null : r.reason ?? "That position is taken");
    if (r.ok) {
      onMove(g.id, r.xM);
      gesture.current = { ...g, moved: true };
    }
  };

  const endGesture = () => {
    gesture.current = { kind: "none" };
    setRefusal(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    setSpin(false);
    setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * (e.deltaY > 0 ? 0.9 : 1.11)) }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const nudge: Record<string, () => void> = {
      ArrowLeft: () => setCam((c) => ({ ...c, yaw: c.yaw - 0.12 })),
      ArrowRight: () => setCam((c) => ({ ...c, yaw: c.yaw + 0.12 })),
      ArrowUp: () => setCam((c) => ({ ...c, pitch: clampPitch(c.pitch + 0.08) })),
      ArrowDown: () => setCam((c) => ({ ...c, pitch: clampPitch(c.pitch - 0.08) })),
      "+": () => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.15) })),
      "=": () => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.15) })),
      "-": () => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 0.87) })),
      Escape: () => onSelect(null),
    };
    const fn = nudge[e.key];
    if (fn) {
      e.preventDefault();
      setSpin(false);
      fn();
    }
  };

  // ------------------------------------------------------------------ drawing

  const usedEnd = Math.min(
    L,
    consignments.reduce((m, c) => Math.max(m, (positions[c.id] ?? c.xM) + c.lengthM), 0)
  );
  const freeLeft = Math.max(0, Math.round((L - usedEnd) * 100) / 100);

  const wallFill = "#f4f3ef";
  const dragging = gesture.current.kind === "move";
  const active = hovered ?? selectedId;

  /** Container shell drawn as edges, so cargo is never hidden behind a solid wall. */
  const edges: Array<[[number, number, number], [number, number, number]]> = [
    [[0, 0, 0], [L, 0, 0]], [[0, 0, W], [L, 0, W]], [[0, H, 0], [L, H, 0]], [[0, H, W], [L, H, W]],
    [[0, 0, 0], [0, 0, W]], [[L, 0, 0], [L, 0, W]], [[0, H, 0], [0, H, W]], [[L, H, 0], [L, H, W]],
    [[0, 0, 0], [0, H, 0]], [[L, 0, 0], [L, H, 0]], [[0, 0, W], [0, H, W]], [[L, 0, W], [L, H, W]],
  ];

  const labelFor = (c: PlacedConsignment) => {
    const x = xOf(c);
    const p = to2d(x + c.lengthM / 2, c.piecesHigh * c.pieceHeightM, (c.piecesAcross * c.pieceWidthM) / 2);
    return p;
  };

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${VH}`}
        className={`w-full rounded-card bg-surface-2 border border-border outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
          dragging ? "cursor-grabbing" : gesture.current.kind === "orbit" ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ touchAction: "none" }}
        tabIndex={0}
        role="img"
        aria-label={`Interactive load plan for ${container.code}. Drag to orbit, scroll to zoom, drag a consignment to restow it.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <defs>
          <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#1c1d1a" stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Floor, then the free-space slab, then the shell edges, then cargo. */}
        <polygon points={poly([[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W]])} fill={wallFill} stroke="#dcdad3" strokeWidth="1" />
        <polygon points={poly([[0, 0, 0], [L, 0, 0], [L, 0, W], [0, 0, W]])} fill="url(#ground)" />

        {freeLeft > 0.01 && explode === 0 && (
          <g>
            <polygon
              points={poly([[usedEnd, 0, 0], [L, 0, 0], [L, 0, W], [usedEnd, 0, W]])}
              fill="#1D9E75"
              fillOpacity="0.12"
              stroke="#1D9E75"
              strokeDasharray="5 4"
              strokeWidth="1.2"
            />
            {(() => {
              const p = to2d((usedEnd + L) / 2, 0.02, W / 2);
              return (
                <text x={p.x} y={p.y} textAnchor="middle" fontSize="11" fill="#0F6E56" stroke="#ffffff" strokeWidth="3" paintOrder="stroke" fontWeight="500">
                  {freeLeft}m free
                </text>
              );
            })()}
          </g>
        )}

        {edges.map(([a, b], i) => {
          const p1 = to2d(a[0], a[1], a[2]);
          const p2 = to2d(b[0], b[1], b[2]);
          return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#c9c7bf" strokeWidth="1.1" />;
        })}

        {/* Contact shadows. Cheap, but they are what stops the blocks looking like they
            float once the camera leaves the flattering default angle. */}
        {consignments.map((c) => {
          const x = xOf(c);
          const wSpan = c.piecesAcross * c.pieceWidthM;
          return (
            <polygon
              key={`sh-${c.id}`}
              points={poly([[x, 0.004, 0], [x + c.lengthM, 0.004, 0], [x + c.lengthM, 0.004, wSpan], [x, 0.004, wSpan]])}
              fill="#1c1d1a"
              fillOpacity={active === c.id ? 0.16 : 0.09}
            />
          );
        })}

        {sorted.map((b, i) => {
          const [top, mid, dark] = paletteFor(b.colorIndex);
          const isActive = active === b.consignmentId;
          const dim = active !== null && !isActive;
          const lift = isActive ? -5 : 0;
          return (
            <g
              key={i}
              data-cid={b.consignmentId}
              onPointerEnter={() => gesture.current.kind === "none" && setHovered(b.consignmentId)}
              onPointerLeave={() => setHovered(null)}
              style={{
                transform: `translateY(${lift}px)`,
                transition: dragging ? "none" : "transform 140ms ease-out",
                opacity: dim ? 0.6 : 1,
                cursor: editable ? "grab" : "default",
              }}
            >
              {faces.map((f: FaceName) => (
                <polygon
                  key={f}
                  data-cid={b.consignmentId}
                  points={poly(faceCorners(f, b))}
                  fill={f === "top" ? top : mixHex(dark, mid, shade(f))}
                  stroke={isActive ? "#1c1d1a" : "#ffffff"}
                  strokeWidth={isActive ? 1 : 0.55}
                  strokeLinejoin="round"
                />
              ))}
            </g>
          );
        })}

        {consignments.map((c) => {
          const p = labelFor(c);
          const isActive = active === c.id;
          if (!isActive && active !== null) return null;
          return (
            <text
              key={`lb-${c.id}`}
              x={p.x}
              y={p.y - 12}
              textAnchor="middle"
              fontSize="11.5"
              fill="#1c1d1a"
              stroke="#ffffff"
              strokeWidth="3.5"
              paintOrder="stroke"
              fontWeight="500"
              pointerEvents="none"
            >
              {c.clientName}
            </text>
          );
        })}

        {/* Length ruler along the floor, so a restow can be read off in metres. */}
        {(() => {
          const a = to2d(0, 0, W + 0.22);
          const b = to2d(L, 0, W + 0.22);
          return (
            <g pointerEvents="none">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a9a69c" strokeWidth="1" />
              {Array.from({ length: Math.floor(L) + 1 }, (_, m) => {
                const t = to2d(m, 0, W + 0.22);
                const t2 = to2d(m, 0, W + 0.42);
                return (
                  <g key={m}>
                    <line x1={t.x} y1={t.y} x2={t2.x} y2={t2.y} stroke="#a9a69c" strokeWidth="1" />
                    {m % 2 === 0 && (
                      <text x={t2.x} y={t2.y + 11} textAnchor="middle" fontSize="9" fill="#8a877e">
                        {m}m
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })()}
      </svg>

      {/* Controls sit over the canvas so the drawing keeps the full width. */}
      <div className="absolute top-2 left-2 flex flex-wrap gap-1">
        {(
          [
            ["iso", "Corner"],
            ["doors", "Doors"],
            ["top", "Top"],
            ["side", "Side"],
            ["reverse", "Reverse"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => glideTo(PRESETS[key])}
            className="px-2 py-1 text-[11px] rounded bg-surface-1/90 border border-border text-text-secondary hover:text-text-primary hover:border-border-strong"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={() => setSpin((s) => !s)}
          title={spin ? "Stop rotating" : "Rotate slowly"}
          aria-label={spin ? "Stop rotating" : "Rotate slowly"}
          className="p-1.5 rounded bg-surface-1/90 border border-border text-text-secondary hover:text-text-primary"
        >
          {spin ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button
          onClick={() => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.2) }))}
          title="Zoom in"
          aria-label="Zoom in"
          className="p-1.5 rounded bg-surface-1/90 border border-border text-text-secondary hover:text-text-primary"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={() => setCam((c) => ({ ...c, zoom: clampZoom(c.zoom * 0.83) }))}
          title="Zoom out"
          aria-label="Zoom out"
          className="p-1.5 rounded bg-surface-1/90 border border-border text-text-secondary hover:text-text-primary"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={reset}
          title="Reset the view"
          aria-label="Reset the view"
          className="p-1.5 rounded bg-surface-1/90 border border-border text-text-secondary hover:text-text-primary"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[10.5px] text-text-muted">
        <span className="inline-flex items-center gap-1">
          <Move3d size={11} /> drag to orbit
        </span>
        <span className="inline-flex items-center gap-1">
          <Hand size={11} /> shift-drag to pan
        </span>
        <span className="inline-flex items-center gap-1">
          <Maximize2 size={11} /> scroll to zoom
        </span>
      </div>

      {refusal && (
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-bg-danger border border-border text-[11px] text-text-danger">
          {refusal}
        </div>
      )}
    </div>
  );
}
