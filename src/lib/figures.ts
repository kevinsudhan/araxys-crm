/**
 * A figure as the desk types it: "1,150.50", "2,06,600", " 83.25 ", "-500".
 *
 * Null for anything that is not a whole figure yet — "", "-", "." — so a box
 * that reads its figure as it is typed does not take a half-typed one for a
 * different number: "1150." is 1150 while the decimals are still coming, and
 * the box keeps showing "1150." (components/FigureInput).
 */
export function parseFigure(text: string): number | null {
  const t = text.replace(/[,\s ]/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
