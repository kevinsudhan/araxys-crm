import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { compactInr, inr } from "./PnlChart";

/**
 * The debit and credit page's charts (7 Oct): debit against credit, by month
 * and by shipment or party.
 *
 * ---------------------------------------------------------------------------
 * Two series, always the same two colours wherever they appear: debit (what we
 * billed — they owe us) in the blue the P&L uses for revenue, credit (what was
 * billed to us — we owe them) in its orange for cost. Validated as a pair
 * (dataviz validator, light surface): colour-blind separation ΔE 24.7, both
 * over 3:1 on white. One rupee axis — they are the same unit.
 *
 * Thin marks (10px bars, ≤24px columns), rounded at the data end and square at
 * the baseline, a 2px gap between the pair, a legend on every chart, values in
 * text colours never the series colour, a tooltip on every row or month — and
 * the full figures in the table under each chart, so nothing is hover-only.
 * ---------------------------------------------------------------------------
 */

export const DEBIT = "#2a78d6";
export const CREDIT = "#eb6834";
const GRID = "#e7e8e2";
const AXIS_TEXT = "#6d6e61";

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-[2px]" style={{ background: DEBIT }} /> Debit · we billed them
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-[2px]" style={{ background: CREDIT }} /> Credit · they billed us
      </span>
    </div>
  );
}

/** Round numbers for the axis: 1, 2 or 5 times a power of ten. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Debit and credit by month: paired columns on one rupee axis, a tooltip per month. */
export function MonthColumns({ rows }: { rows: Array<{ key: string; label: string; debit: number; credit: number }> }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const w = box.current?.getBoundingClientRect().width;
    if (w) setWidth(Math.max(240, Math.round(w)));
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 220;
  const pad = { top: 10, right: 8, bottom: 28, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const { ticks, y } = useMemo(() => {
    const values = rows.flatMap((r) => [r.debit, r.credit, 0]);
    const t = niceTicks(Math.min(...values), Math.max(...values));
    const lo = t[0],
      hi = t[t.length - 1];
    return { ticks: t, y: (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH };
  }, [rows, innerH, pad.top]);

  const band = innerW / Math.max(rows.length, 1);
  const barW = Math.max(1, Math.min(24, (band - 10) / 2));
  const gap = barW >= 4 ? 2 : 0;
  const zero = y(0);
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(innerW / 56))));
  const cx = (i: number) => pad.left + band * i + band / 2;
  const column = (x: number, v: number, w: number) => {
    const top = Math.min(y(v), zero);
    const h = Math.abs(y(v) - zero);
    if (h < 0.5) return "";
    const r = Math.min(4, w / 2, h);
    return v >= 0
      ? `M${x},${zero} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${zero} Z`
      : `M${x},${zero} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + w - r} Q${x + w},${top + h} ${x + w},${top + h - r} V${zero} Z`;
  };
  const h = hover != null ? rows[hover] : null;

  return (
    <div>
      <Legend />
      <div ref={box} className="relative mt-2" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={H} role="img" aria-label="Debit and credit by month" className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#b6b3a3" : GRID} strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={AXIS_TEXT}>
                {compactInr(t)}
              </text>
            </g>
          ))}
          {rows.map((r, i) => {
            const x0 = cx(i) - barW - gap / 2;
            return (
              <g key={r.key}>
                {hover === i && <rect x={pad.left + band * i} y={pad.top} width={band} height={innerH} fill="#14150f" opacity={0.04} />}
                <path d={column(x0, r.debit, barW)} fill={DEBIT} />
                <path d={column(x0 + barW + gap, r.credit, barW)} fill={CREDIT} />
                {i % every === 0 && (
                  <text x={cx(i)} y={H - 9} textAnchor="middle" fontSize={11} fill={AXIS_TEXT}>
                    {r.label}
                  </text>
                )}
              </g>
            );
          })}
          {rows.map((r, i) => (
            <rect
              key={r.key}
              x={pad.left + band * i}
              y={pad.top}
              width={band}
              height={innerH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${r.label}: debit ${inr(r.debit)}, credit ${inr(r.credit)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              style={{ outline: "none" }}
            />
          ))}
        </svg>
        {h && hover != null && (
          <Tip left={Math.min(Math.max(cx(hover) + 12, 0), width - 200)} title={h.label} debit={h.debit} credit={h.credit} />
        )}
      </div>
    </div>
  );
}

/**
 * Debit and credit side by side for each row — a shipment, a party — biggest
 * first, the value at the end of each bar, one scale for every row so lengths
 * compare. A row can be pressed to open it.
 */
export function PairedBars({
  rows,
  onPick,
  empty = "Nothing to show.",
}: {
  rows: Array<{ key: string; label: string; sub?: string; debit: number; credit: number }>;
  onPick?: (key: string) => void;
  empty?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...rows.flatMap((r) => [r.debit, r.credit]));
  if (!rows.length) return <p className="py-6 text-center text-[12px] text-text-muted">{empty}</p>;
  const pct = (v: number) => `${Math.max(0, (v / max) * 100)}%`;
  return (
    <div>
      <Legend />
      <ul className="mt-2 space-y-1">
        {rows.map((r) => {
          const Row = onPick ? "button" : "div";
          return (
            <li key={r.key} className="relative">
              <Row
                {...(onPick ? { type: "button" as const, onClick: () => onPick(r.key) } : {})}
                onMouseEnter={() => setHover(r.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(r.key)}
                onBlur={() => setHover(null)}
                aria-label={`${r.label}: debit ${inr(r.debit)}, credit ${inr(r.credit)}`}
                className={`grid w-full grid-cols-1 gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-left sm:grid-cols-[minmax(0,34%)_minmax(0,1fr)] ${
                  hover === r.key ? "bg-surface-2" : ""
                } ${onPick ? "cursor-pointer" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-text-primary">{r.label}</span>
                  {r.sub && <span className="block truncate text-[11px] text-text-muted">{r.sub}</span>}
                </span>
                <span className="flex min-w-0 flex-col justify-center gap-[2px]">
                  {(
                    [
                      [r.debit, DEBIT],
                      [r.credit, CREDIT],
                    ] as const
                  ).map(([v, c], i) => (
                    <span key={i} className="flex items-center gap-2">
                      <span className="h-[10px] min-w-0 flex-1">
                        {v > 0 && <span className="block h-full rounded-r-[4px]" style={{ width: pct(v), background: c, minWidth: 2 }} />}
                      </span>
                      <span className="w-[86px] shrink-0 text-right text-[11.5px] tabular-nums text-text-secondary">{v ? inr(v) : "—"}</span>
                    </span>
                  ))}
                </span>
              </Row>
              {hover === r.key && (
                <div className="pointer-events-none absolute right-2 top-full z-10 mt-1 hidden sm:block">
                  <Tip title={r.label} debit={r.debit} credit={r.credit} inline />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Tip({ title, debit, credit, left, inline }: { title: string; debit: number; credit: number; left?: number; inline?: boolean }) {
  const diff = debit - credit;
  return (
    <div
      className={`${inline ? "" : "pointer-events-none absolute top-2 z-10"} min-w-[200px] rounded-lg border border-border bg-surface-1 px-3 py-2 text-[12px] shadow-pop`}
      style={inline ? undefined : { left }}
    >
      <p className="mb-1.5 font-medium text-text-primary">{title}</p>
      {(
        [
          ["Debit · we billed", debit, DEBIT],
          ["Credit · billed to us", credit, CREDIT],
        ] as const
      ).map(([label, v, c]) => (
        <p key={label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-text-secondary">
            <span className="inline-block size-2 rounded-[2px]" style={{ background: c }} />
            {label}
          </span>
          <span className="font-semibold tabular-nums text-text-primary">{inr(v)}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t border-border pt-1 text-text-muted">
        <span>Difference</span>
        <span className="tabular-nums">{inr(diff)}</span>
      </p>
    </div>
  );
}
