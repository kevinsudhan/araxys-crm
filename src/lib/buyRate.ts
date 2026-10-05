import { chargeKey, type BuyLine } from "./jobProfit";

/**
 * The partner's original rate as it builds up over several pastes (128, 129).
 *
 * ---------------------------------------------------------------------------
 * A partner revises their ocean freight on Tuesday; sends the destination
 * charges a day after the freight; another partner quotes the trucking. Each
 * paste is added to the one original rate for the job:
 *
 *   a charge already there (the same charge, however it is written — the key
 *   of lib/jobProfit.ts — in the same group: origin THC and destination THC
 *   are two charges) is updated to the new figure, and keeps what it was;
 *   a charge not there is added;
 *   a charge not in this paste stays as it was.
 *
 * Unless the paste is said to replace the whole rate, when it does exactly
 * that. Every paste is kept in the history: when, from whom, what was pasted,
 * and what it changed.
 * ---------------------------------------------------------------------------
 */

export interface StoredBuyLine extends BuyLine {
  gst?: number | null;
  /** Whose rate this charge is. */
  from?: string;
  /** When it was last pasted. */
  at?: string;
  /** What it was before the last paste changed it. */
  was?: { currency: string; rate: number; unit: string } | null;
}

export interface PasteEntry {
  at: string;
  from: string;
  pasted_text: string;
  replaced: boolean;
  added: string[];
  updated: Array<{ name: string; from: string; to: string }>;
  unchanged: number;
}

const money = (l: { currency: string; rate: number; unit: string }) =>
  `${l.currency} ${l.rate.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${l.unit && l.unit !== "Lumpsum" ? ` / ${l.unit}` : ""}`;

const same = (a: BuyLine, b: BuyLine) => a.currency === b.currency && a.rate === b.rate && a.unit === b.unit && a.quantity === b.quantity && (a.note ?? null) === (b.note ?? null);

export function mergeBuyLines(
  existing: StoredBuyLine[],
  incoming: BuyLine[],
  meta: { from: string; at: string; pastedText: string },
  replaceAll = false
): { lines: StoredBuyLine[]; entry: PasteEntry } {
  const stamp = (l: BuyLine): StoredBuyLine => ({ ...l, from: meta.from, at: meta.at, was: null });
  if (replaceAll) {
    return {
      lines: incoming.map(stamp),
      entry: { at: meta.at, from: meta.from, pasted_text: meta.pastedText, replaced: true, added: incoming.map((l) => l.description), updated: [], unchanged: 0 },
    };
  }
  const lines = existing.map((l) => ({ ...l }));
  const taken = new Set<number>();
  const added: string[] = [];
  const updated: PasteEntry["updated"] = [];
  let unchanged = 0;
  for (const n of incoming) {
    const key = chargeKey(n.description);
    const i = lines.findIndex((l, k) => !taken.has(k) && !!key && chargeKey(l.description) === key && (l.section ?? null) === (n.section ?? null));
    if (i < 0) {
      lines.push(stamp(n));
      taken.add(lines.length - 1);
      added.push(n.description);
      continue;
    }
    taken.add(i);
    const old = lines[i];
    if (same(old, n)) {
      unchanged++;
      continue;
    }
    lines[i] = { ...n, from: meta.from, at: meta.at, was: { currency: old.currency, rate: old.rate, unit: old.unit } };
    updated.push({ name: old.description, from: money(old), to: money(n) });
  }
  return { lines, entry: { at: meta.at, from: meta.from, pasted_text: meta.pastedText, replaced: false, added, updated, unchanged } };
}

/** What a paste will do, in one line: "2 charges updated, 1 added". */
export function pasteSummary(e: Pick<PasteEntry, "replaced" | "added" | "updated" | "unchanged">): string {
  if (e.replaced) return `Replaced the original rate: ${e.added.length} charge${e.added.length === 1 ? "" : "s"}`;
  const parts = [
    e.updated.length ? `${e.updated.length} charge${e.updated.length === 1 ? "" : "s"} updated` : "",
    e.added.length ? `${e.added.length} added` : "",
    e.unchanged ? `${e.unchanged} as before` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing new";
}
