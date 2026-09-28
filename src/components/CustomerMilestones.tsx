import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { AlertCircle, Check, ExternalLink, EyeOff, Flag, Loader2, Lock, Megaphone, Plus, Sparkles } from "lucide-react";
import { failureText } from "../lib/errorText";
import { todayIST } from "../lib/progress";
import {
  customerView,
  entryProblem,
  expectedFor,
  hhmm,
  milestoneWhen,
  placeFor,
  suggestionFor,
  type Evidence,
  type Suggestion,
} from "../lib/milestones";
import { addUpdate, deleteUpdate, saveMilestone, type ShipmentMilestone } from "../services/milestones";
import type { Shipment } from "../services/enquiries";

/**
 * The customer's milestones, recorded here and nowhere else (102).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CUSTOMER'S PAGE IS
 *
 * The booking's details and this list. A milestone reaches the customer when
 * somebody records it: the day, the time if known, where, and a note in words
 * the customer reads. Until then the page says it is still to come — whatever
 * the warehouse, the transporter or a carrier's feed already say.
 *
 * WHAT THE JOB ALREADY KNOWS IS OFFERED, NOT APPLIED
 *
 * A delivery with its POD, a warehouse receipt, the LEO date, a carrier's
 * "sailed": each shows beside its milestone as "Use this", which fills the
 * form. The person checks it and saves.
 *
 * THE STAGE FOLLOWS
 *
 * A flagged milestone marks the job's stage (sailed, arrived, delivered), so
 * recording it moves the header, the boards and the workflow bar with it —
 * the customer and the desk read the same fact.
 * ---------------------------------------------------------------------------
 */

type Draft = { on: string; time: string; location: string; note: string; label: string };

const blank = (today: string): Draft => ({ on: today, time: "", location: "", note: "", label: "" });

export default function CustomerMilestones({
  shipment: s,
  milestones,
  evidence,
  open,
  onOpened,
  pageUrl,
  onChanged,
}: {
  shipment: Shipment;
  milestones: ShipmentMilestone[];
  evidence: Evidence;
  /** A stage or code to open for recording — from "Mark sailed" in the header or a flagged step. */
  open: string | null;
  onOpened: () => void;
  /** The customer's page, when a link has been made. */
  pageUrl: string | null;
  onChanged: () => Promise<void>;
}) {
  const today = todayIST();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blank(today));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement | null>());

  const locked = s.signed_off_at
    ? "Signed off: an admin reopens the job before its tracking can change."
    : s.stage === "cancelled"
      ? "Cancelled: reopen the job before recording its tracking."
      : null;

  const view = customerView(milestones);
  const pending = [...view.ahead, ...view.passed].sort((a, b) => a.position - b.position);
  const hidden = milestones.filter((m) => m.hidden);
  const passed = new Set(view.passed.map((m) => m.id));

  function start(m: ShipmentMilestone, from?: Suggestion) {
    setError(null);
    setSaved(null);
    setEditing(m.id);
    setDraft({
      on: from?.on ?? m.reached_on ?? today,
      time: from ? (from.time ?? "") : (hhmm(m.reached_time) ?? ""),
      location: from?.location || m.location || placeFor(m.code, s),
      note: from?.note || m.note,
      label: m.label,
    });
  }

  // Opened from elsewhere on the job: the milestone for that stage, ready to record.
  useEffect(() => {
    if (!open || !milestones.length) return;
    const m = milestones.find((x) => x.stage === open) ?? milestones.find((x) => x.code === open);
    if (m && !locked) {
      start(m);
      window.setTimeout(() => rowRefs.current.get(m.id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
    onOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestones.length]);

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setError(null);
    setSaved(null);
    try {
      await fn();
      setEditing(null);
      setSaved(done);
      await onChanged();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  function save(m: ShipmentMilestone) {
    if (m.added && draft.label.trim().length < 2) return setError("Say what happened, in a few words the customer reads.");
    const problem = entryProblem(draft, today);
    if (problem) return setError(problem);
    const label = m.added ? draft.label.trim() : m.label;
    void run(
      m.id,
      () => saveMilestone(m.id, { on: draft.on, time: draft.time || null, location: draft.location, note: draft.note, hidden: m.hidden }, m.added ? label : undefined),
      `“${label}” is on the customer's page.`
    );
  }

  function addNew() {
    if (draft.label.trim().length < 2) return setError("Say what happened, in a few words the customer reads.");
    const problem = entryProblem(draft, today);
    if (problem) return setError(problem);
    void run("new", () => addUpdate(s.id, draft.label.trim(), { on: draft.on, time: draft.time || null, location: draft.location, note: draft.note }), `“${draft.label.trim()}” is on the customer's page.`);
  }

  const setHidden = (m: ShipmentMilestone, hide: boolean) =>
    run(
      `h${m.id}`,
      () => saveMilestone(m.id, { on: m.reached_on, time: hhmm(m.reached_time), location: m.location, note: m.note, hidden: hide }),
      hide ? `“${m.label}” is off the customer's page.` : `“${m.label}” is back on the customer's page.`
    );

  const row = (m: ShipmentMilestone) => {
    const reached = Boolean(m.reached_on);
    const isPassed = passed.has(m.id);
    const expected = expectedFor(m, { etd: s.etd ?? s.sailing_date, eta: s.eta });
    const offer = !reached && !locked ? suggestionFor(m.code, evidence) : null;
    const latest = view.latest?.id === m.id;
    return (
      <li key={m.id} ref={(el) => void rowRefs.current.set(m.id, el)} className="border-b border-border py-2.5 last:border-b-0">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
              reached ? "border-text-success bg-text-success text-white" : isPassed ? "border-dashed border-border-strong bg-surface-1" : "border-border-strong bg-surface-1"
            }`}
          >
            {reached && <Check size={11} strokeWidth={3} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`flex flex-wrap items-center gap-x-1.5 text-[13px] ${reached ? "text-text-primary" : "text-text-secondary"} ${latest ? "font-semibold" : reached ? "font-medium" : ""}`}>
              {m.label}
              {m.stage && (
                <span title="Recording it moves the job's stage" className="inline-flex">
                  <Flag size={10} className="text-text-accent" />
                </span>
              )}
              {m.added && <span className="rounded bg-surface-2 px-1.5 text-[10.5px] font-normal text-text-muted">your update</span>}
              {latest && <span className="rounded bg-bg-success px-1.5 text-[10.5px] font-medium text-text-success">the customer sees this now</span>}
            </p>
            {reached ? (
              <p className="text-[11.5px] text-text-secondary">{[milestoneWhen(m.reached_on, m.reached_time), m.location].filter(Boolean).join(" · ")}</p>
            ) : isPassed ? (
              <p className="text-[11.5px] text-text-muted">Not recorded. A later milestone is, so the customer does not see this one.</p>
            ) : expected ? (
              <p className="text-[11.5px] text-text-muted">Shown as expected {milestoneWhen(expected)} (the booking's {m.stage === "sailed" ? "ETD" : "ETA"})</p>
            ) : null}
            {m.note && <p className="mt-0.5 whitespace-pre-line text-[12px] text-text-primary">“{m.note}”</p>}
            {offer && editing !== m.id && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-text-accent">
                <Sparkles size={11} className="shrink-0" />
                <span>
                  {offer.from}: {milestoneWhen(offer.on, offer.time)}
                  {offer.location ? ` · ${offer.location}` : ""}
                </span>
                <button type="button" onClick={() => start(m, offer)} className="font-medium underline-offset-2 hover:underline">
                  Use this
                </button>
              </p>
            )}
          </div>
          {!locked && editing !== m.id && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => start(m)}
              className={`h-7 shrink-0 rounded-lg px-2.5 text-[11.5px] font-medium disabled:opacity-60 ${
                reached ? "border border-border text-text-secondary hover:text-text-primary" : "bg-brand text-white hover:bg-brand-dark"
              }`}
            >
              {reached ? "Edit" : "Record"}
            </button>
          )}
        </div>
        {editing === m.id && (
          <Form
            draft={draft}
            setDraft={setDraft}
            busy={busy === m.id}
            onSave={() => save(m)}
            onCancel={() => setEditing(null)}
            error={error}
            withLabel={m.added}
            extra={
              <>
                {m.reached_on && !m.added && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(m.id, () => saveMilestone(m.id, { on: null, time: null, location: m.location, note: m.note, hidden: m.hidden }), `“${m.label}” is back to still to come.`)
                    }
                    className="h-7 rounded-lg px-2.5 text-[11.5px] text-text-secondary hover:text-text-danger disabled:opacity-60"
                  >
                    Not reached after all
                  </button>
                )}
                {m.added ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(`Delete “${m.label}”? It comes off the customer's page.`)) void run(m.id, () => deleteUpdate(m.id), `“${m.label}” is deleted.`);
                    }}
                    className="h-7 rounded-lg px-2.5 text-[11.5px] text-text-secondary hover:text-text-danger disabled:opacity-60"
                  >
                    Delete
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void setHidden(m, true)}
                    title="Not part of this job — delivery on an FOB export, say"
                    className="flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11.5px] text-text-secondary hover:text-text-primary disabled:opacity-60"
                  >
                    <EyeOff size={12} /> Not part of this job
                  </button>
                )}
              </>
            }
          />
        )}
      </li>
    );
  };

  return (
    <section className="card p-5" aria-labelledby="customer-milestones">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="customer-milestones" className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <Megaphone size={12} /> Customer milestones
        </h2>
        {pageUrl && (
          <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] text-text-accent hover:underline">
            <ExternalLink size={12} /> See the customer's page
          </a>
        )}
      </div>
      <p className="mb-3 max-w-prose text-[12px] text-text-secondary">
        The customer's tracking page shows these and the booking's details, nothing else. Record each one as it happens. Times are the local time
        where it happened.
      </p>

      {locked && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-text-secondary">
          <Lock size={13} className="mt-px shrink-0" /> {locked}
        </p>
      )}
      {error && editing === null && <Problem text={error} className="mb-3" />}
      {saved && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-bg-success px-3 py-2 text-[12px] text-text-success">
          <Check size={13} className="mt-px shrink-0" /> {saved}
        </p>
      )}

      {!milestones.length ? (
        <p className="text-[12px] text-text-muted">This job has no milestones yet.</p>
      ) : (
        <ol>
          {view.done.map(row)}
          {pending.map(row)}
        </ol>
      )}

      {!locked &&
        (editing === "new" ? (
          <div className="mt-3">
            <p className="mb-1 text-[12px] font-medium text-text-primary">An update for the customer</p>
            <Form draft={draft} setDraft={setDraft} busy={busy === "new"} onSave={addNew} onCancel={() => setEditing(null)} error={error} withLabel />
          </div>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setSaved(null);
              setDraft(blank(today));
              setEditing("new");
            }}
            className="mt-3 flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-60"
          >
            <Plus size={13} /> Add an update
          </button>
        ))}

      {hidden.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <button type="button" onClick={() => setShowHidden((x) => !x)} className="text-[11.5px] text-text-secondary hover:text-text-primary">
            {showHidden ? "Hide" : "Show"} what is not part of this job ({hidden.length})
          </button>
          {showHidden && (
            <ul className="mt-2 space-y-1.5">
              {hidden.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-[12.5px] text-text-muted">
                  <span className="flex items-center gap-1.5">
                    <EyeOff size={12} /> {m.label}
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void setHidden(m, false)}
                      className="h-7 rounded-lg border border-border px-2.5 text-[11.5px] text-text-secondary hover:text-text-primary disabled:opacity-60"
                    >
                      {busy === `h${m.id}` ? <Loader2 size={12} className="animate-spin" /> : "Show to the customer"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Form({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
  error,
  withLabel,
  extra,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
  withLabel?: boolean;
  extra?: ReactNode;
}) {
  const set = (k: keyof Draft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-2 p-3">
      {withLabel && (
        <label className="mb-2 block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">What happened</span>
          <input value={draft.label} onChange={set("label")} maxLength={120} placeholder="Transhipped at Colombo" className="h-8 w-full" autoFocus />
        </label>
      )}
      <div className="grid gap-2 sm:grid-cols-[150px_110px_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Date</span>
          <input type="date" value={draft.on} onChange={set("on")} className="h-8 w-full" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Time, if known</span>
          <input type="time" value={draft.time} onChange={set("time")} className="h-8 w-full" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-text-secondary">Where</span>
          <input value={draft.location} onChange={set("location")} maxLength={120} placeholder="Chennai" className="h-8 w-full" />
        </label>
      </div>
      <label className="mt-2 block">
        <span className="mb-0.5 flex justify-between text-[11px] text-text-secondary">
          <span>Note for the customer (optional)</span>
          <span className="tabular-nums text-text-muted">{draft.note.length}/500</span>
        </span>
        <textarea value={draft.note} onChange={set("note")} rows={2} maxLength={500} placeholder="Anything the customer should know, in a sentence" className="w-full text-[12.5px]" />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-brand px-3 text-[11.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Save to the customer's page
        </button>
        <button type="button" onClick={onCancel} className="h-7 rounded-lg border border-border px-3 text-[11.5px] text-text-secondary hover:text-text-primary">
          Cancel
        </button>
        {extra}
      </div>
      {error && <Problem text={error} className="mt-2" />}
    </div>
  );
}

function Problem({ text, className }: { text: string; className: string }) {
  return (
    <p role="alert" className={`flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger ${className}`}>
      <AlertCircle size={13} className="mt-px shrink-0" /> {text}
    </p>
  );
}
