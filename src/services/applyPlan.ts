import type { Intake } from "./intake";

/**
 * Deciding what a reading would change on a queued row.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 *
 * It is pure — a row in, a plan out, no network — and `intake.ts` is not: that
 * module constructs the Supabase client at import time, which needs Vite's
 * import.meta.env and therefore cannot be loaded by a plain Node test runner.
 * Keeping the decision here means it can be tested directly, which matters more
 * for this than for most things: the rule it encodes is invisible in the UI, and
 * getting it wrong would overwrite somebody's typing with a guess.
 *
 * The Intake type is imported as a TYPE only, which is erased at compile time —
 * so nothing here pulls the client back in through the side door.
 * ---------------------------------------------------------------------------
 */

/** The fields a reading and a queued row have in common, with their labels. */
const APPLIABLE = [
  ["contact_name", "Name"],
  ["company", "Company"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["origin", "Origin"],
  ["destination", "Destination"],
  ["cargo", "Cargo"],
] as const;

export interface ApplyPlan {
  /** Blank fields the reading can fill. Safe: nothing is being replaced. */
  fill: Partial<Record<(typeof APPLIABLE)[number][0], string>>;
  /** Labels of fields where the row and the reading disagree. Left alone. */
  conflicts: string[];
  /** How many fields would change. Zero means the button has nothing to do. */
  count: number;
}

/**
 * What applying a reading to a row would actually change.
 *
 * ---------------------------------------------------------------------------
 * IT FILLS BLANKS AND NOTHING ELSE
 *
 * A blank field is a field nobody has answered, so filling it costs nothing and
 * saves the typing — which is the whole reason to read a queued row.
 *
 * A field that already has a value is different. Somebody typed it, or it was
 * captured from the message, and replacing it with a model's reading would
 * quietly overwrite a person's work with a guess. So a disagreement is reported
 * and left alone: the operator can see it and decide in Edit, where changing
 * something is what the screen is for.
 *
 * Comparison ignores case and surrounding space, because "Chennai " and
 * "chennai" are not a disagreement and reporting them as one would make the
 * conflict list noise nobody reads.
 * ---------------------------------------------------------------------------
 */
export function planApply(
  row: Intake,
  reading: Partial<Record<(typeof APPLIABLE)[number][0], string | null>>
): ApplyPlan {
  const fill: ApplyPlan["fill"] = {};
  const conflicts: string[] = [];

  for (const [key, label] of APPLIABLE) {
    const proposed = (reading[key] ?? "").trim();
    if (!proposed) continue;

    const current = (row[key] ?? "").trim();
    if (!current) fill[key] = proposed;
    else if (current.toLowerCase() !== proposed.toLowerCase()) conflicts.push(label);
  }

  return { fill, conflicts, count: Object.keys(fill).length };
}
