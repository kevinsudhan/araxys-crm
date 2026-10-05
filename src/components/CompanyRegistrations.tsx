import { useCallback, useEffect, useState } from "react";
import { AlertCircle, BadgeCheck, Loader2, Pencil, Plus } from "lucide-react";
import { istDay } from "../lib/enquiryRegister";
import { failureText } from "../lib/errorText";
import {
  AUTHORITY_HINT,
  HAS_AMOUNT,
  KIND_HINT,
  KIND_LABEL,
  KINDS,
  regProblems,
  regState,
  stateText,
  type RegKind,
  WARN_DAYS,
  type Registration,
} from "../lib/registrations";
import { addRegistration, listRegistrations, removeRegistration, setRegistrationActive, updateRegistration } from "../services/registrations";

type Draft = Omit<Registration, "id" | "active" | "updated_at">;
const blank = (kind: RegKind): Draft => ({ kind, title: "", number: "", authority: "", issued_on: null, valid_until: null, amount_inr: null, notes: "" });

const TONE = {
  in_force: "text-text-success",
  running_out: "text-text-warning",
  run_out: "text-text-danger",
  no_end_date: "text-text-muted",
  retired: "text-text-muted",
} as const;

/**
 * The company's own registrations (132), on the administrator's page: the
 * MTO registration our house B/Ls are issued under, the consol agent
 * registration with Customs, the bond and the guarantee behind it, the eBL
 * platform — each with its number, who issued it, its dates and amount, and
 * whether it is in force. Renewed, the old one is retired and kept.
 */
export default function CompanyRegistrations() {
  const [regs, setRegs] = useState<Registration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const today = istDay(new Date().toISOString());

  const load = useCallback(async () => {
    try {
      setRegs(await listRegistrations());
    } catch (e) {
      setError(failureText(e, "Could not read the registrations.").message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      after?.();
      await load();
    } catch (e) {
      setError(failureText(e, "That did not save.").message);
    } finally {
      setBusy(null);
    }
  }

  const live = (regs ?? []).filter((r) => r.active);
  const retired = (regs ?? []).filter((r) => !r.active);
  const missing = (["mto", "consol_agent", "customs_bond"] as RegKind[]).filter((k) => !live.some((r) => r.kind === k));

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-text-primary">
            <BadgeCheck size={15} className="text-brand" /> Registrations and bond
          </h2>
          <p className="mt-1 max-w-prose text-[12.5px] text-text-secondary">
            What lets Aashish issue its own house B/Ls and work as consol agent, and when each runs out. Once our MTO registration is here, house B/Ls can be issued
            under it instead of a partner's. The console desk is told when one runs out within {WARN_DAYS} days.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ id: null, draft: blank(missing[0] ?? "other") })}
          disabled={busy !== null || editing !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-60"
        >
          <Plus size={13} /> Add one
        </button>
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" /> {error}
        </p>
      )}

      {editing && (
        <Editor
          draft={editing.draft}
          isNew={editing.id === null}
          busy={busy === "save"}
          onCancel={() => setEditing(null)}
          onSave={(d) =>
            void act("save", () => (editing.id ? updateRegistration(editing.id, d) : addRegistration(d)), () => setEditing(null))
          }
        />
      )}

      {!regs ? (
        !error && (
          <p className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
            <Loader2 size={12} className="animate-spin" /> Reading the registrations…
          </p>
        )
      ) : (
        <>
          {missing.length > 0 && (
            <p className="mt-3 text-[12px] text-text-muted">Not on file yet: {missing.map((k) => KIND_LABEL[k]).join(", ")}.</p>
          )}
          {live.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {live.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  today={today}
                  busy={busy}
                  onEdit={() => setEditing({ id: r.id, draft: { kind: r.kind, title: r.title, number: r.number, authority: r.authority, issued_on: r.issued_on, valid_until: r.valid_until, amount_inr: r.amount_inr, notes: r.notes } })}
                  onRetire={() =>
                    window.confirm(`Retire ${KIND_LABEL[r.kind]} ${r.number}? It is kept for the record, no longer the one in force. Then add the renewed one.`) &&
                    void act(`retire:${r.id}`, () => setRegistrationActive(r.id, false))
                  }
                  onRemove={() => window.confirm(`Remove ${KIND_LABEL[r.kind]} ${r.number}? Only for one entered by mistake.`) && void act(`rm:${r.id}`, () => removeRegistration(r.id))}
                />
              ))}
            </ul>
          )}
          {retired.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setShowRetired((s) => !s)} className="text-[12px] text-text-secondary hover:text-text-primary">
                {showRetired ? "Hide" : "Show"} {retired.length} retired
              </button>
              {showRetired && (
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border opacity-80">
                  {retired.map((r) => (
                    <Row
                      key={r.id}
                      r={r}
                      today={today}
                      busy={busy}
                      onRestore={() => void act(`restore:${r.id}`, () => setRegistrationActive(r.id, true))}
                      onRemove={() => window.confirm(`Remove ${KIND_LABEL[r.kind]} ${r.number} for good?`) && void act(`rm:${r.id}`, () => removeRegistration(r.id))}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Row({
  r,
  today,
  busy,
  onEdit,
  onRetire,
  onRestore,
  onRemove,
}: {
  r: Registration;
  today: string;
  busy: string | null;
  onEdit?: () => void;
  onRetire?: () => void;
  onRestore?: () => void;
  onRemove: () => void;
}) {
  const { state } = regState(r, today);
  const link = "text-[12px] text-text-muted hover:text-text-primary disabled:opacity-50";
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-text-primary">
          <span className="font-medium">{r.title.trim() || KIND_LABEL[r.kind]}</span>
          {r.number && <span className="ml-2 font-mono text-[12px]">{r.number}</span>}
          {r.title.trim() && r.title.trim() !== KIND_LABEL[r.kind] && <span className="ml-2 text-[11.5px] text-text-muted">{KIND_LABEL[r.kind]}</span>}
        </p>
        <p className="text-[11.5px] text-text-secondary">
          {[r.authority, r.issued_on ? `issued ${r.issued_on}` : "", r.amount_inr !== null ? `₹${r.amount_inr.toLocaleString("en-IN")}` : "", r.notes].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <span className={`text-[12px] ${TONE[state]}`}>{stateText(r, today)}</span>
      <span className="flex items-center gap-3">
        {onEdit && (
          <button type="button" onClick={onEdit} disabled={busy !== null} className={`${link} inline-flex items-center gap-1`}>
            <Pencil size={11} /> Edit
          </button>
        )}
        {onRetire && (
          <button type="button" onClick={onRetire} disabled={busy !== null} className={link}>
            Retire
          </button>
        )}
        {onRestore && (
          <button type="button" onClick={onRestore} disabled={busy !== null} className={link}>
            Back in force
          </button>
        )}
        <button type="button" onClick={onRemove} disabled={busy !== null} className={`${link} hover:text-text-danger`}>
          Remove
        </button>
      </span>
    </li>
  );
}

function Editor({ draft, isNew, busy, onCancel, onSave }: { draft: Draft; isNew: boolean; busy: boolean; onCancel: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [amount, setAmount] = useState(draft.amount_inr === null ? "" : String(draft.amount_inr));
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const field = "h-8 w-full text-[12.5px]";
  const label = "mb-0.5 block text-[11px] text-text-secondary";

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className={label}>What it is</span>
          <select value={d.kind} disabled={!isNew} onChange={(e) => set("kind", e.target.value as RegKind)} className={field}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>{d.kind === "ebl_platform" ? "Platform" : "Name on it (optional)"}</span>
          <input value={d.title} onChange={(e) => set("title", e.target.value)} placeholder={d.kind === "ebl_platform" ? "The platform's name" : KIND_LABEL[d.kind]} className={field} />
        </label>
        <label className="block">
          <span className={label}>{d.kind === "ebl_platform" ? "Our account there" : "Number"}</span>
          <input value={d.number} onChange={(e) => set("number", e.target.value)} className={`${field} font-mono`} />
        </label>
        <label className="block">
          <span className={label}>Issued by / held with</span>
          <input value={d.authority} onChange={(e) => set("authority", e.target.value)} placeholder={AUTHORITY_HINT[d.kind]} className={field} />
        </label>
        <label className="block">
          <span className={label}>Issued on</span>
          <input type="date" value={d.issued_on ?? ""} onChange={(e) => set("issued_on", e.target.value || null)} className={field} />
        </label>
        <label className="block">
          <span className={label}>In force until</span>
          <input type="date" value={d.valid_until ?? ""} onChange={(e) => set("valid_until", e.target.value || null)} className={field} />
        </label>
        {HAS_AMOUNT[d.kind] && (
          <label className="block">
            <span className={label}>Amount (₹)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${field} text-right tabular-nums`} />
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className={label}>Notes</span>
          <input value={d.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Conditions, where the certificate is kept…" className={field} />
        </label>
      </div>
      <p className="mt-2 text-[11.5px] text-text-muted">{KIND_HINT[d.kind]}</p>
      {problem && <p className="mt-2 text-[12px] text-text-danger">{problem}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const out: Draft = { ...d, amount_inr: HAS_AMOUNT[d.kind] && amount.trim() !== "" ? Number(amount.replace(/,/g, "")) : null };
            const p = regProblems(out);
            if (p.length) return setProblem(`Give ${p.join(", ")}.`);
            setProblem(null);
            onSave(out);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-[12px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy && <Loader2 size={13} className="animate-spin" />} {isNew ? "Add" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="h-8 px-2 text-[12px] text-text-muted hover:text-text-primary">
          Cancel
        </button>
      </div>
    </div>
  );
}
