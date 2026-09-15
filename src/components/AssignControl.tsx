import { useState } from "react";
import { Loader2, UserCheck, UserPlus, UserMinus, UsersRound } from "lucide-react";
import Select from "./Select";
import {
  assignEnquiry,
  claimEnquiry,
  mayAssignOthers,
  nameOf,
  releaseEnquiry,
  type Person,
} from "../services/enquiries";

/**
 * Take an enquiry on, or put it back.
 *
 * ---------------------------------------------------------------------------
 * THE BOARD STAYS SHARED
 *
 * Everyone sees every enquiry. What changes when somebody claims one is only
 * that the row now says whose it is, and that it appears on their own list.
 * Nothing is hidden from anybody, because a desk where one operator cannot see
 * another's work cannot cover for them.
 *
 * A claim somebody else already holds is refused by the database rather than
 * overwritten here, and the message names them. Two people pressing this a
 * second apart is the exact collision the feature exists to prevent, so the
 * second press has to say what happened instead of quietly moving the work.
 *
 * HANDING WORK TO SOMEBODY ELSE
 *
 * A separate act with a separate permission, granted to named people rather
 * than to a role. Claiming is taking responsibility for your own work; assigning
 * is putting it on a colleague's list, and most of the desk should not be able
 * to do the second. The control is hidden from anyone without the permission,
 * and refused by the database as well — hiding a button is presentation, not
 * a rule.
 * ---------------------------------------------------------------------------
 */
export default function AssignControl({
  enquiryRef,
  assignedTo,
  people,
  meId,
  isAdmin,
  onChanged,
  compact,
}: {
  enquiryRef: string;
  assignedTo: string | null;
  people: Person[];
  meId: string;
  isAdmin: boolean;
  onChanged: () => void;
  /** On a dense list row, drop to icons and shorter words. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handing, setHanding] = useState(false);

  // Whether this person may put work on somebody else's list. The database
  // enforces it too; hiding the control only saves a refusal.
  const canHandOver = mayAssignOthers(people, meId);

  const mine = assignedTo === meId;
  const holder = nameOf(people, assignedTo);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const stop = (e: React.MouseEvent) => {
    // These sit inside a row that is a link to the case file. Claiming is not
    // navigation, so the click must not travel up to it.
    e.preventDefault();
    e.stopPropagation();
  };

  const size = compact ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12px]";

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {!assignedTo && (
          <button
            onClick={(e) => {
              stop(e);
              void run(() => claimEnquiry(enquiryRef));
            }}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-60 font-medium text-white transition-colors ${size}`}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
            Take this on
          </button>
        )}

        {assignedTo && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
              mine
                ? "border-text-success/25 bg-bg-success text-text-success"
                : "border-border-strong bg-surface-2 text-text-secondary"
            }`}
          >
            <UserCheck size={11} />
            {mine ? "Yours" : (holder ?? "Taken")}
          </span>
        )}

        {/* Only the holder can hand it back, and an admin, who has to be able to
            move the work of somebody who is off. */}
        {assignedTo && (mine || isAdmin) && (
          <button
            onClick={(e) => {
              stop(e);
              void run(() => releaseEnquiry(enquiryRef));
            }}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong disabled:opacity-60 transition-colors ${size}`}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
            {compact ? "Release" : "Put it back"}
          </button>
        )}

        {canHandOver && !handing && (
          <button
            onClick={(e) => {
              stop(e);
              setHanding(true);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors ${size}`}
          >
            <UsersRound size={12} />
            {assignedTo ? "Hand over" : "Give to"}
          </button>
        )}
      </div>

      {/*
        The picker only appears once asked for. A dropdown of names sitting on
        every row would suggest reassigning is the ordinary thing to do, when
        the ordinary thing is taking your own work on.
      */}
      {canHandOver && handing && (
        <div
          className="flex flex-wrap items-center gap-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Select
            label="Hand this enquiry to"
            className="w-52"
            value={assignedTo ?? ""}
            onChange={(v) => {
              setHanding(false);
              void run(() => assignEnquiry(enquiryRef, v || null));
            }}
            options={[
              { value: "", label: "Nobody", hint: "Back on the shared board" },
              ...people.map((p) => ({
                value: p.id,
                label: p.full_name?.trim() || p.email,
                hint: p.id === meId ? "you" : p.role === "admin" ? "administrator" : undefined,
              })),
            ]}
          />
          <button
            onClick={(e) => {
              stop(e);
              setHanding(false);
            }}
            className="text-[11px] text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <span className="text-[11px] text-text-danger">{error}</span>}
    </div>
  );
}
