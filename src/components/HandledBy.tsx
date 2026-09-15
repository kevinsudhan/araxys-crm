import { UserCheck, UserPlus } from "lucide-react";
import { nameOf, type Person } from "../services/enquiries";

/**
 * Who has this job, on the shared boards.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ON A BOARD EVERYBODY CAN SEE
 *
 * The inbound, in-process and completed boards are the whole desk's view — not
 * a personal list. What everybody needs from them is the same two facts: is
 * somebody on this, and is it me. A shipment nobody has taken up is the one
 * that gets missed, so it is drawn as the exception rather than as an absence.
 *
 * "Not taken up" rather than "Unassigned", because the desk claims work rather
 * than having it handed out.
 * ---------------------------------------------------------------------------
 */
export default function HandledBy({
  assignedTo,
  people,
  meId,
}: {
  assignedTo: string | null;
  people: Person[];
  /** The signed-in person, so their own jobs read as "You". */
  meId?: string | null;
}) {
  if (!assignedTo) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-text-warning/25 bg-bg-warning px-2 py-0.5 text-[11px] font-medium text-text-warning">
        <UserPlus size={10} />
        Not taken up
      </span>
    );
  }

  const mine = meId != null && assignedTo === meId;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        mine
          ? "border-text-accent/25 bg-bg-accent text-text-accent"
          : "border-border-strong bg-surface-2 text-text-secondary"
      }`}
    >
      <UserCheck size={10} />
      {mine ? "You" : (nameOf(people, assignedTo) ?? "A colleague")}
    </span>
  );
}

export type Ownership = "all" | "mine" | "free";

export const OWNERSHIP: { key: Ownership; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "mine", label: "Mine" },
  { key: "free", label: "Not taken up" },
];

/** Whether a row survives the ownership filter. */
export const ownedBy = (
  assignedTo: string | null,
  filter: Ownership,
  meId?: string | null
): boolean => {
  if (filter === "mine") return assignedTo != null && assignedTo === meId;
  if (filter === "free") return assignedTo == null;
  return true;
};
