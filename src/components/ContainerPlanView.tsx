import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Check, Undo2, AlignHorizontalJustifyStart, ChevronUp, ChevronDown } from "lucide-react";
import StatusPill from "./StatusPill";
import ContainerScene, { type DragMode } from "./ContainerScene";
import { compact, nudgeOrder, sequenceOf, type StowItem } from "../lib/scene3d";
import { getSlotPlan, restowSlot, type SlotPlan, type PlacedConsignment } from "../services/backend";

/**
 * Load plan modal: an interactive 3D stow plus the two flat views it is bad at.
 *
 * The 3D view answers "what is in there and where"; the top-down and side elevations
 * answer "how much floor is left" and "how high is it stacked", which a projected view
 * makes you estimate. Both read from the same working positions, so dragging a block in
 * 3D moves it in the flat views at the same time.
 *
 * Edits are held here rather than in the scene, because a restow is a change to the whole
 * container and has to be saved or discarded as one -- half a rearrangement is not a
 * loadable container.
 */

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

function FlatViews({
  plan,
  positions,
  selectedId,
  onSelect,
}: {
  plan: SlotPlan;
  positions: Record<string, number>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { container, consignments } = plan;
  const L = container.lengthM;
  const W = container.widthM;
  const H = container.heightM;
  const w = 760;
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
          const x = (positions[c.id] ?? c.xM) * scale;
          const isSel = selectedId === c.id;
          return (
            <g key={c.id} onPointerEnter={() => onSelect(c.id)} style={{ cursor: "pointer" }}>
              <rect
                x={x}
                y={depth * scale - e + 1}
                width={c.lengthM * scale}
                height={e}
                fill={top}
                stroke={isSel ? "#1c1d1a" : mid}
                strokeWidth={isSel ? 1.8 : 1}
                opacity={selectedId && !isSel ? 0.45 : 1}
                style={{ transition: "x 140ms ease-out, opacity 140ms ease-out" }}
              />
              {c.lengthM * scale > 54 && (
                <text
                  x={x + (c.lengthM * scale) / 2}
                  y={depth * scale - e / 2 + 5}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#1c1d1a"
                  pointerEvents="none"
                  style={{ transition: "x 140ms ease-out" }}
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
    <div onPointerLeave={() => onSelect(null)}>
      <Row label={`Top-down plan — floor use across ${W}m width`} depth={W} extent={(c) => c.piecesAcross * c.pieceWidthM} />
      <Row label={`Side elevation — stacking against ${H}m height`} depth={H} extent={(c) => c.piecesHigh * c.pieceHeightM} />
      <div className="flex justify-between text-[10px] text-text-muted">
        <span>0m — back wall</span>
        <span>{L}m — doors</span>
      </div>
    </div>
  );
}

export default function ContainerPlanView({ slotId, onClose }: { slotId: string; onClose: () => void }) {
  const [plan, setPlan] = useState<SlotPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  const [dragMode, setDragMode] = useState<DragMode>("reorder");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getSlotPlan(slotId).then(setPlan).catch((e) => setError(String(e)));
  }, [slotId]);

  const dirty = useMemo(() => {
    if (!plan) return false;
    return plan.consignments.some((c) => positions[c.id] !== undefined && Math.abs(positions[c.id] - c.xM) > 0.0005);
  }, [plan, positions]);

  const items = useMemo<StowItem[]>(
    () => (plan?.consignments ?? []).map((c) => ({ id: c.id, xM: positions[c.id] ?? c.xM, lengthM: c.lengthM })),
    [plan, positions]
  );

  /** The table lists the working loading order, not the order the server last sent. */
  const ordered = useMemo(() => {
    const seq = sequenceOf(items);
    return [...(plan?.consignments ?? [])].sort((a, b) => seq.indexOf(a.id) - seq.indexOf(b.id));
  }, [plan, items]);

  const applyAll = (next: Array<{ id: string; xM: number }>) => {
    const map: Record<string, number> = {};
    for (const i of next) map[i.id] = i.xM;
    setPositions(map);
    setSaveError(null);
  };

  /** Steps one consignment one place along the loading order. */
  const step = (id: string, direction: -1 | 1) => applyAll(nudgeOrder(items, id, direction));

  const discard = () => {
    setPositions({});
    setSaveError(null);
  };

  const closeUp = () => {
    // Pushing everything back against the wall is the move an operator makes constantly
    // after a cancellation, and doing it by dragging each block is tedious.
    applyAll(compact(items));
  };

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    setSaveError(null);
    try {
      await restowSlot(slotId, items.map((i) => ({ id: i.id, xM: i.xM })));
      const fresh = await getSlotPlan(slotId);
      setPlan(fresh);
      setPositions({});
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 2600);
    return () => clearTimeout(t);
  }, [savedAt]);

  // The scene owns the working positions but this drawer owns saving them, so the free
  // and stranded figures are recomputed here rather than read off the server's snapshot.
  // Bookable floor is measured from where the cargo ends, not from the sum of the
  // blocks: floor caught in a gap between two consignments cannot be sold to anyone.
  const live = useMemo(() => {
    if (!plan) return { free: 0, trapped: 0 };
    const frontier = items.reduce((m, i) => Math.max(m, i.xM + i.lengthM), 0);
    const footprint = items.reduce((s, i) => s + i.lengthM, 0);
    const r2 = (n: number) => Math.round(Math.max(0, n) * 100) / 100;
    return { free: r2(plan.container.lengthM - frontier), trapped: r2(frontier - footprint) };
  }, [plan, items]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6" onClick={onClose}>
      <div
        className="bg-surface-1 border border-border rounded-card w-full max-w-5xl max-h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-surface-1 border-b border-border px-5 py-4 flex items-start justify-between">
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
                  <ContainerScene
                    plan={plan}
                    positions={positions}
                    onMove={(id, xM) => setPositions((p) => ({ ...p, [id]: xM }))}
                    onRestow={applyAll}
                    dragMode={dragMode}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    explode={explode}
                  />

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 mb-4">
                    <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="What dragging a block does">
                      {(
                        [
                          ["reorder", "Reorder", "Drag a block to change its place in the loading order"],
                          ["nudge", "Nudge", "Drag a block within the room its neighbours leave it"],
                        ] as const
                      ).map(([key, label, title]) => (
                        <button
                          key={key}
                          onClick={() => setDragMode(key)}
                          title={title}
                          aria-pressed={dragMode === key}
                          className={`px-2.5 py-1 text-[11.5px] ${
                            dragMode === key
                              ? "bg-brand text-white"
                              : "bg-surface-1 text-text-secondary hover:text-text-primary"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <label className="flex items-center gap-2 text-[11.5px] text-text-secondary">
                      Separate blocks
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={explode}
                        onChange={(e) => setExplode(Number(e.target.value))}
                        className="w-28 accent-brand"
                        aria-label="Pull the consignments apart to see between them"
                      />
                    </label>

                    <button
                      onClick={closeUp}
                      disabled={live.trapped <= 0.01}
                      title={
                        live.trapped > 0.01
                          ? `Recovers ${live.trapped}m of floor stranded between blocks`
                          : "Nothing to recover — the stow is already packed tight"
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded border border-border text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-40 disabled:hover:text-text-secondary"
                    >
                      <AlignHorizontalJustifyStart size={12} /> Close up gaps
                    </button>

                    {live.trapped > 0.01 && (
                      <span className="text-[11.5px] text-text-warning">
                        {live.trapped}m stranded in gaps — not bookable until it's closed up
                      </span>
                    )}

                    {dirty && (
                      <>
                        <button
                          onClick={save}
                          disabled={saving}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded bg-brand text-white hover:bg-brand-dark disabled:opacity-60"
                        >
                          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                          Save stow
                        </button>
                        <button
                          onClick={discard}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded border border-border text-text-secondary hover:text-text-primary"
                        >
                          <Undo2 size={12} /> Discard
                        </button>
                        <span className="text-[11.5px] text-text-accent">
                          Unsaved — {live.free}m would be bookable
                        </span>
                      </>
                    )}

                    {savedAt !== null && (
                      <span className="text-[11.5px] text-text-success inline-flex items-center gap-1">
                        <Check size={12} /> Stow saved and the agent's availability refreshed
                      </span>
                    )}
                    {saveError && <span className="text-[11.5px] text-text-danger">Couldn't save: {saveError}</span>}
                  </div>

                  <FlatViews plan={plan} positions={positions} selectedId={selectedId} onSelect={setSelectedId} />
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

              <div className="flex items-baseline justify-between mb-2">
                <p className="text-sm font-medium text-text-primary">Loading order</p>
                <p className="text-[11px] text-text-muted">
                  Loaded back wall first, doors last — so the last one listed comes off first
                </p>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-secondary">
                    <th className="py-2 w-14">Order</th>
                    <th className="py-2">Client</th>
                    <th className="py-2 w-28">Reference</th>
                    <th className="py-2 w-28">Position</th>
                    <th className="py-2 w-32">Arrangement</th>
                    <th className="py-2 w-20">Weight</th>
                  </tr>
                </thead>
                <tbody onPointerLeave={() => setSelectedId(null)}>
                  {ordered.map((c, n) => {
                    const [top, mid] = paletteFor(c.colorIndex);
                    const x = positions[c.id] ?? c.xM;
                    const moved = Math.abs(x - c.xM) > 0.0005;
                    return (
                      <tr
                        key={c.id}
                        onPointerEnter={() => setSelectedId(c.id)}
                        className={`border-b border-border last:border-0 cursor-pointer ${
                          selectedId === c.id ? "bg-surface-2" : ""
                        }`}
                      >
                        <td className="py-2">
                          <span className="inline-flex items-center gap-1">
                            <span className="text-text-secondary tabular-nums w-3">{n + 1}</span>
                            <span className="inline-flex flex-col">
                              <button
                                onClick={() => step(c.id, -1)}
                                disabled={n === 0}
                                aria-label={`Load ${c.clientName} earlier`}
                                title="Load earlier — one place towards the back wall"
                                className="text-text-muted hover:text-text-primary disabled:opacity-25 disabled:hover:text-text-muted leading-none"
                              >
                                <ChevronUp size={13} />
                              </button>
                              <button
                                onClick={() => step(c.id, 1)}
                                disabled={n === ordered.length - 1}
                                aria-label={`Load ${c.clientName} later`}
                                title="Load later — one place towards the doors"
                                className="text-text-muted hover:text-text-primary disabled:opacity-25 disabled:hover:text-text-muted leading-none"
                              >
                                <ChevronDown size={13} />
                              </button>
                            </span>
                          </span>
                        </td>
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
                        <td className={`py-2 ${moved ? "text-text-accent" : "text-text-secondary"}`}>
                          <span className="tabular-nums">
                            {Math.round(x * 100) / 100}–{Math.round((x + c.lengthM) * 100) / 100}m
                          </span>
                          {moved && <span className="text-[10px] ml-1.5">moved</span>}
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
