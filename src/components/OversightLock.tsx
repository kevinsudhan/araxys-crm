import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Lock } from "lucide-react";
import { oversightLockIsSet, verifyOversightPassword } from "../services/enquiries";

/**
 * The password prompt in front of team oversight.
 *
 * ---------------------------------------------------------------------------
 * WHY THE UNLOCK IS PER-TAB AND NOT REMEMBERED
 *
 * It lives in sessionStorage, so it survives moving around the CRM and dies
 * when the tab closes. localStorage would make the lock pointless within a day:
 * the risk it answers is an unlocked laptop in a shared office, and a lock that
 * stays open on that laptop forever is not a lock.
 *
 * What is stored is a flag saying this tab got past the prompt. The password is
 * never stored, never held in state after the check, and never leaves the form.
 *
 * WHAT IT DOES NOT PROTECT
 *
 * The rows behind this page. Enquiries and their events are readable by any
 * signed-in employee, because a desk where one operator cannot see another's
 * work does not function. This is a second thing you must know to open a
 * particular view, not a boundary around the data in it — and it is worth being
 * clear about that rather than letting it feel like more than it is.
 * ---------------------------------------------------------------------------
 */

const FLAG = "araxys.oversight.unlocked";

/** Whether this tab has already been let through. */
export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    // Private browsing, or storage blocked. Ask again rather than assume.
    return false;
  }
}

export default function OversightLock({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockSet, setLockSet] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void oversightLockIsSet()
      .then(setLockSet)
      .catch(() => setLockSet(null));
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!password || busy) return;
      setBusy(true);
      setError(null);
      try {
        const ok = await verifyOversightPassword(password);
        // Cleared either way. There is no reason for it to sit in memory after
        // the answer comes back.
        setPassword("");
        if (!ok) {
          setError("That is not the password.");
          inputRef.current?.focus();
          return;
        }
        try {
          sessionStorage.setItem(FLAG, "1");
        } catch {
          // Unlocking still works for this render; it just will not survive a
          // page reload. Better than refusing to open at all.
        }
        onUnlocked();
      } catch {
        setError("Could not check that. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [password, busy, onUnlocked]
  );

  return (
    <div className="flex justify-center py-10">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-bg-warning text-text-warning">
            <Lock size={16} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[15px] font-medium text-text-primary">Team oversight is locked</h1>
            <p className="text-[12px] text-text-secondary">
              Being signed in as an administrator is not enough on its own.
            </p>
          </div>
        </div>

        {lockSet === false ? (
          <p className="mt-5 rounded-lg bg-bg-warning px-3 py-2.5 text-[12px] text-text-warning">
            No password has been set for this page yet, so there is nothing to unlock it with. One
            has to be set in the database before it can be opened.
          </p>
        ) : (
          <>
            <label
              htmlFor="oversight-password"
              className="mt-5 block text-[12px] font-medium text-text-secondary mb-1.5"
            >
              Password
            </label>
            <input
              id="oversight-password"
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="w-full"
              placeholder="••••••••"
            />

            {error && (
              <p className="mt-2 flex items-start gap-1.5 text-[12px] text-text-danger">
                <AlertCircle size={13} className="mt-px shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !password}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 h-9 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-50 text-white text-[13px] font-medium transition-colors"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              Unlock
            </button>

            <p className="mt-3 text-[11px] text-text-muted leading-relaxed">
              Checked against a hash held in the database. It stays unlocked in this tab until you
              close it.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
