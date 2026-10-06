import { supabase } from "../lib/supabase";
import type { ActionLike } from "../lib/oversight";
import { all } from "./paging";

/**
 * Everything the desk recorded doing in a period, by whom (137, `team_actions`):
 * the timeline, the steps ticked, files filed, consoles and CSNs, warehouse
 * receipts, the queue, rates and sailings, accounts, tracking decisions. The
 * mail sent is read from the mail log (services/mailLog.ts).
 *
 * Administrators only — the database refuses anybody else. Paged, so a busy
 * month does not stop at the thousandth row.
 */
export async function teamActions(fromIso: string, toIso: string | null): Promise<ActionLike[]> {
  const rows = await all((from, to) =>
    supabase
      .rpc("team_actions", { p_from: fromIso, p_to: toIso })
      .order("at", { ascending: false })
      .order("id")
      .range(from, to)
  );
  return rows as unknown as ActionLike[];
}
