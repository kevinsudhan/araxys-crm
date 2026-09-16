import { money } from "../services/billing";
import { BUCKETS, BUCKET_LABEL, type AgedRow } from "../services/reports";

/**
 * Who owes what, and how long it has been owed.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUCKETS ARE 30/60/90 AND NOT SOMETHING CLEVERER
 *
 * Because it is what every statement of account a customer has ever received
 * uses. A report the other side cannot reconcile against their own ledger is a
 * report that starts an argument rather than settling one.
 *
 * WHY A BLANK DUE DATE IS "NOT YET DUE"
 *
 * An invoice with no due date is one where nobody agreed terms. Dropping it in
 * the 90-plus column would put a number in the worst place on the strength of
 * an empty field, and the first thing anybody does with a 90-plus figure is
 * telephone somebody about it.
 * ---------------------------------------------------------------------------
 */
export default function AgeingTable({
  rows,
  partyHeading,
}: {
  rows: AgedRow[];
  partyHeading: string;
}) {
  const totals = BUCKETS.map((b) => rows.reduce((t, r) => t + r.buckets[b], 0));
  const grand = rows.reduce((t, r) => t + r.total, 0);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[46rem] text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
            <th className="px-4 py-2 font-medium">{partyHeading}</th>
            {BUCKETS.map((b) => (
              <th key={b} className="px-4 py-2 text-right font-medium">
                {BUCKET_LABEL[b]}
              </th>
            ))}
            <th className="px-4 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.party_id}>
              <td className="px-4 py-2 text-text-primary">
                {r.label}
                {r.oldestDays > 90 && (
                  <span className="ml-2 text-[11px] text-text-danger">
                    oldest {r.oldestDays} days
                  </span>
                )}
              </td>
              {BUCKETS.map((b) => (
                <td
                  key={b}
                  className={`px-4 py-2 text-right tabular-nums ${
                    r.buckets[b] === 0
                      ? "text-text-muted"
                      : b === "d90plus"
                        ? "font-medium text-text-danger"
                        : b === "d90" || b === "d60"
                          ? "text-text-warning"
                          : "text-text-secondary"
                  }`}
                >
                  {r.buckets[b] === 0 ? "—" : money(r.buckets[b])}
                </td>
              ))}
              <td className="px-4 py-2 text-right font-medium tabular-nums text-text-primary">
                {money(r.total)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong">
            <td className="px-4 py-2 text-[11px] uppercase tracking-wide text-text-secondary">
              All
            </td>
            {totals.map((t, i) => (
              <td
                key={i}
                className="px-4 py-2 text-right font-medium tabular-nums text-text-secondary"
              >
                {t === 0 ? "—" : money(t)}
              </td>
            ))}
            <td className="px-4 py-2 text-right text-[14px] font-medium tabular-nums text-text-primary">
              {money(grand)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
