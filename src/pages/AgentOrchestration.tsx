import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  PhoneCall, ScanText, Boxes, Users, Mail, Calculator, ShieldCheck,
  ArrowUpRight, Check, Loader2, MinusCircle, RefreshCw,
} from "lucide-react";
import Waveform from "../components/orchestration/Waveform";
import ContainerScene from "../components/ContainerScene";
import {
  getLiveCalls, getCallLogs, getRealRecords, getSpaceSlots, getSlotPlan,
  type LiveCall, type RecentCall, type CallLog, type RealRecord, type SlotPlan,
} from "../services/backend";
import { REQUEST_FIELDS } from "../data/requestFields";

/**
 * The desk, while the agent is working.
 *
 * A call is in progress on the left and the work it produces builds on the right, step by
 * step, as it happens. Modelled on the SnapServe claims desk, which got the shape right:
 * the call stays visible the whole time, and each step states its own result — including
 * when the result is nothing.
 *
 * ---------------------------------------------------------------------------
 * EVERY NUMBER ON THIS PAGE IS FETCHED.
 *
 * The call list is polled from the live-calls endpoint, the transcript is the real one,
 * the extracted fields are what the reader actually pulled out of this caller's record,
 * and the container is the live load plan rendered by the same component the Space page
 * uses. Nothing is scripted.
 *
 * Which means steps genuinely do sit at "waiting" for a while, and the page says so rather
 * than animating through them. A demo that invents progress teaches the room the wrong
 * thing about what the system does.
 * ---------------------------------------------------------------------------
 */

const POLL_MS = 5000;

type StepState = "done" | "running" | "waiting" | "skipped";

export default function AgentOrchestration() {
  const [live, setLive] = useState<LiveCall[]>([]);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [records, setRecords] = useState<RealRecord[]>([]);
  const [plan, setPlan] = useState<SlotPlan | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /** Set once the operator clicks a call, so polling stops yanking them elsewhere. */
  const pinned = useRef(false);

  // ---------------------------------------------------------------- polling

  const poll = useCallback(async () => {
    try {
      const { live: l, recent: r, checkedAt: at } = await getLiveCalls();
      setLive(l);
      setRecent(r);
      setCheckedAt(at);
      setError(null);
      // A call that is actually ringing wins over whatever was on screen — that is the
      // whole point of the page. Once someone picks a call by hand, leave them on it.
      if (!pinned.current) {
        const next = l[0]?.id ?? r[0]?.id ?? null;
        if (next !== null) setSelectedId((cur) => (cur === next ? cur : next));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(() => { poll(); setTick((t) => t + 1); }, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    getRealRecords().then(({ records }) => setRecords(records)).catch(() => {});
  }, [tick === 0]);

  /**
   * Transcripts come from the logs endpoint, not from a per-call one.
   *
   * `/calls/:id` is declared in the client and does not exist on the deployed function —
   * it 404s on every poll. `/calls/logs` returns the same calls with their transcripts, so
   * the detail is matched out of that by id.
   */
  useEffect(() => {
    let cancelled = false;
    getCallLogs()
      .then(({ logs }) => { if (!cancelled) setLogs(logs); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tick]);

  const detail = useMemo(
    () => logs.find((l) => String(l.call_id) === String(selectedId)) ?? null,
    [logs, selectedId],
  );

  /** The fullest container on the book — an empty one demonstrates nothing. */
  useEffect(() => {
    (async () => {
      try {
        const { slots } = await getSpaceSlots();
        const best = [...slots].sort((a, b) => b.consignmentCount - a.consignmentCount)[0];
        if (best) setPlan(await getSlotPlan(best.id));
      } catch { /* the step says so */ }
    })();
  }, []);

  // ---------------------------------------------------------------- derived

  const activeCall = live[0] ?? null;
  const selected = useMemo(
    () => live.find((c) => c.id === selectedId) ?? recent.find((c) => c.id === selectedId) ?? null,
    [live, recent, selectedId],
  );

  /** The caller's record, matched the way the CRM matches — last ten digits. */
  const record = useMemo(() => {
    const key = (selected?.fromNumber ?? "").replace(/\D/g, "").slice(-10);
    if (!key) return null;
    return records.find((r) => r.phone.replace(/\D/g, "").slice(-10) === key) ?? null;
  }, [records, selected]);

  const fields = useMemo(() => {
    const d = record?.requestDetails ?? {};
    return REQUEST_FIELDS
      .map((f) => ({ key: f.key, label: f.label, value: (d as Record<string, unknown>)[f.key] }))
      .filter((f) => f.value !== undefined && f.value !== null && f.value !== "");
  }, [record]);

  const inProgress = live.some((c) => c.id === selectedId);

  /**
   * Step state, read off real data rather than a timer.
   *
   * `pipeline` would be the honest source for the later steps, but the deployed API does
   * not return that column yet, so these derive from what it does return. Where nothing
   * can be known, the step says "waiting" instead of inventing a tick.
   */
  const steps: Array<{ key: string; n: number; title: string; icon: typeof PhoneCall; state: StepState }> = [
    { key: "call", n: 1, title: "Call", icon: PhoneCall, state: inProgress ? "running" : selected ? "done" : "waiting" },
    { key: "intake", n: 2, title: "Intake facts", icon: ScanText, state: fields.length ? "done" : selected ? "running" : "waiting" },
    { key: "space", n: 3, title: "Space check", icon: Boxes, state: plan ? "done" : "waiting" },
    { key: "partners", n: 4, title: "Partner selection", icon: Users, state: record?.quotedAmountInr ? "done" : record ? "running" : "waiting" },
    { key: "rfq", n: 5, title: "Rate requests", icon: Mail, state: record?.quotedAmountInr ? "done" : "waiting" },
    { key: "price", n: 6, title: "Pricing", icon: Calculator, state: record?.quotedAmountInr ? "done" : "waiting" },
    { key: "approve", n: 7, title: "Approval", icon: ShieldCheck, state: record?.agreedAmountInr ? "done" : record?.quotedAmountInr ? "running" : "waiting" },
  ];

  const [positions, setPositions] = useState<Record<string, number>>({});

  return (
    <div className="p-5 max-w-[1500px] mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-[21px] font-semibold text-text-primary">Agent orchestration</h1>
          <p className="text-[12.5px] text-text-muted mt-0.5">
            Calls in flight, and the work each one sets off.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-text-muted">
          {error ? (
            <span className="text-red-600">desk unreachable — {error}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${activeCall ? "bg-emerald-500 animate-pulse" : "bg-text-muted/50"}`} />
              {activeCall ? "call in progress" : "waiting for calls"}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <RefreshCw size={11} className="opacity-60" />
            {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "—"}
          </span>
        </div>
      </header>

      <div className="grid lg:grid-cols-[340px_1fr] gap-4 items-start">
        {/* ============================================================ left rail */}
        <div className="space-y-3">
          <CallCard call={activeCall ?? selected} live={Boolean(activeCall)} detail={detail} />

          {detail?.transcript && (
            <section className="rounded-xl border border-border bg-surface-1 overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-border flex items-center gap-2">
                <ScanText size={14} className="text-text-muted" />
                <span className="text-[12.5px] font-medium text-text-primary">What was said</span>
              </div>
              <div className="max-h-[220px] overflow-y-auto px-3.5 py-2.5 space-y-1.5">
                {splitTurns(detail.transcript).map((t, i) => (
                  <p key={i} className="text-[11.5px] leading-snug">
                    <span className={t.who === "Agent" ? "text-brand font-medium" : "text-text-secondary font-medium"}>
                      {t.who}:
                    </span>{" "}
                    <span className="text-text-primary">{t.text}</span>
                  </p>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-border bg-surface-1 overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <PhoneCall size={14} className="text-text-muted" />
                <span className="text-[12.5px] font-medium text-text-primary">Recent calls</span>
              </div>
              <span className="text-[11px] tabular-nums text-text-muted bg-surface-2 rounded-full px-1.5 py-0.5">
                {recent.length}
              </span>
            </div>
            <ul className="max-h-[520px] overflow-y-auto divide-y divide-border/60">
              {recent.length === 0 && (
                <li className="px-3.5 py-6 text-[12px] text-text-muted text-center">No calls yet today.</li>
              )}
              {recent.map((c) => {
                const isLive = live.some((l) => l.id === c.id);
                const on = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => { pinned.current = true; setSelectedId(c.id); }}
                      className={`w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 transition-colors ${
                        on ? "bg-brand/5 border-l-2 border-brand" : "border-l-2 border-transparent hover:bg-surface-2"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLive ? "bg-emerald-500 animate-pulse" : "bg-text-muted/40"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] text-text-primary tabular-nums truncate">
                          {prettyPhone(c.fromNumber)}
                        </span>
                        <span className="block text-[10.5px] text-text-muted truncate">
                          {c.agentName} · {ago(c.startedAt)}
                        </span>
                      </span>
                      <span className="text-[10.5px] tabular-nums text-text-muted shrink-0">
                        {isLive ? "live" : mmss(c.durationSeconds)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* ============================================================ right column */}
        <div className="space-y-3">
          {/* the strip — what this call is, at a glance */}
          <section className="rounded-xl border border-border bg-surface-1 px-4 py-3">
            <div className="grid sm:grid-cols-4 gap-4 items-start">
              <Meta label="Enquiry" value={record?.ref ?? "not yet matched"}
                pill={record ? { text: record.stage, tone: "ok" } : undefined} />
              <Meta label="Customer" value={record?.company || record?.customerName || "—"} />
              <Meta label="Agent" value={selected?.agentName ?? "—"}
                sub={detail?.direction ? `${detail.direction} · ${record?.sourceLanguage ?? "en"}` : undefined} />
              <div className="sm:text-right">
                {record && (
                  <Link
                    to={`/records/${record.ref}`}
                    className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline"
                  >
                    Open full record <ArrowUpRight size={13} />
                  </Link>
                )}
              </div>
            </div>
          </section>

          {/* the spine */}
          <ol className="flex flex-wrap gap-1.5">
            {steps.map((s) => (
              <li key={s.key}>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] ${
                    s.state === "done" ? "border-brand/30 bg-brand/5 text-text-primary"
                    : s.state === "running" ? "border-amber-300 bg-amber-50 text-amber-800"
                    : "border-border bg-surface-1 text-text-muted"
                  }`}
                >
                  <StateDot state={s.state} />
                  {s.n}. {s.title}
                </span>
              </li>
            ))}
          </ol>

          {/* ---------------------------------------------------------- step 1 */}
          <Step n={1} title="Intake facts" icon={ScanText}
            state={steps[1].state}
            badge={fields.length ? { text: `${fields.length} of ${REQUEST_FIELDS.length} fields`, tone: "ok" } : undefined}>
            {!record ? (
              <Empty>
                No CRM record for {selected ? prettyPhone(selected.fromNumber) : "this caller"} yet.
                A record is written when the call ends and the reader has been through it.
              </Empty>
            ) : fields.length === 0 ? (
              <Empty>
                The record exists but no fields were captured. That is a real outcome — a short
                call where nobody said anything the reader could use.
              </Empty>
            ) : (
              <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-3">
                {fields.slice(0, 12).map((f) => (
                  <div key={f.key}>
                    <div className="text-[10px] uppercase tracking-wide text-text-muted">{f.label}</div>
                    <div className="text-[12.5px] text-text-primary font-medium tabular-nums mt-0.5 break-words">
                      {String(f.value)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Step>

          {/* ---------------------------------------------------------- step 2 */}
          <Step n={2} title="Space check" icon={Boxes} state={steps[2].state}
            badge={plan ? { text: plan.container.code, tone: "neutral" } : undefined}>
            {!plan ? (
              <Empty>Loading the live load plan…</Empty>
            ) : plan.consignments.length === 0 ? (
              <Empty>
                {plan.slot.route} is empty — the whole {plan.container.lengthM}m is available.
              </Empty>
            ) : (
              <>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-text-muted mb-2">
                  <span>{plan.slot.route}</span>
                  <span className="tabular-nums">{plan.consignments.length} consignments</span>
                  <span className="tabular-nums">{plan.remaining.lengthM.toFixed(2)}m floor left</span>
                  {plan.trappedM > 0 && (
                    <span className="tabular-nums text-amber-700">{plan.trappedM.toFixed(2)}m trapped in gaps</span>
                  )}
                </div>
                <ContainerScene
                  plan={plan}
                  positions={positions}
                  onMove={(id, xM) => setPositions((p) => ({ ...p, [id]: xM }))}
                  onRestow={() => {}}
                  dragMode="reorder"
                  selectedId={null}
                  onSelect={() => {}}
                  explode={0}
                />
                <p className="text-[11.5px] text-text-muted mt-2">
                  Checked in three dimensions, not by volume — a 2.6m crate is refused by a
                  2.39m-high 20GP that volume maths would have accepted. Drag a block to restow.
                </p>
              </>
            )}
          </Step>

          {/* ---------------------------------------------------------- steps 3-5 */}
          <div className="grid lg:grid-cols-2 gap-3">
            <Step n={3} title="Partner selection" icon={Users} state={steps[3].state} compact>
              {record?.quotedAmountInr ? (
                <Empty tone="ok">
                  Partners were asked and a rate came back. The round is on the enquiry record.
                </Empty>
              ) : (
                <Empty>
                  Nothing asked yet. Selection ranks on lane tags, then on what memory says each
                  partner actually does, then gates on role — a haulier scoring well on the lane
                  still cannot sell ocean freight.
                </Empty>
              )}
            </Step>

            <Step n={4} title="Rate requests" icon={Mail} state={steps[4].state} compact>
              <Empty>
                Each request becomes a commitment owned by that partner, so whoever goes quiet
                gets chased by the cut-off sentinel rather than by a person remembering.
              </Empty>
            </Step>
          </div>

          {/* ---------------------------------------------------------- step 6 */}
          <Step n={6} title="Pricing" icon={Calculator} state={steps[5].state}
            badge={record?.quotedAmountInr ? { text: "quoted", tone: "ok" } : undefined}>
            {record?.quotedAmountInr ? (
              <div className="flex flex-wrap items-end gap-8">
                <Figure label="Quoted" value={`₹${record.quotedAmountInr.toLocaleString("en-IN")}`} strong />
                {record.agreedAmountInr && (
                  <Figure label="Agreed" value={`₹${record.agreedAmountInr.toLocaleString("en-IN")}`} />
                )}
                <p className="text-[11.5px] text-text-muted max-w-sm">
                  Margin is taken on the sell, not marked up on cost. A partner rate read ten
                  times too small or too large falls outside the policy band and is held before
                  anyone sees it.
                </p>
              </div>
            ) : (
              <Empty>
                No price yet. Pricing waits for at least two comparable partner quotes — one
                quote is not a comparison, it is the only number somebody happened to send.
              </Empty>
            )}
          </Step>

          {/* ---------------------------------------------------------- step 7 */}
          <Step n={7} title="Approval" icon={ShieldCheck} state={steps[6].state}>
            {record?.agreedAmountInr ? (
              <Empty tone="ok">Approved and agreed at ₹{record.agreedAmountInr.toLocaleString("en-IN")}.</Empty>
            ) : record?.quotedAmountInr ? (
              <Empty tone="warn">
                Waiting on a human. Nothing goes to the customer until someone here says so —
                that is the brake, and it is deliberate.
              </Empty>
            ) : (
              <Empty>Nothing to approve yet.</Empty>
            )}
          </Step>
        </div>
      </div>
    </div>
  );
}

/* ================================================================= pieces */

function CallCard({ call, live, detail }: { call: LiveCall | RecentCall | null; live: boolean; detail: CallLog | null }) {
  const [elapsed, setElapsed] = useState(0);
  const started = call?.startedAt;

  useEffect(() => {
    if (!live || !started) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - new Date(started).getTime()) / 1000)), 1000);
    return () => clearInterval(id);
  }, [live, started]);

  if (!call) {
    return (
      <section className="rounded-xl border border-border bg-surface-1 p-5 text-center">
        <Waveform active={false} height={40} className="justify-center mb-3" />
        <p className="text-[12.5px] text-text-muted">
          No call in progress. Ring the desk and this fills in.
        </p>
      </section>
    );
  }

  return (
    <section className={`rounded-xl border p-4 ${live ? "border-emerald-300 bg-emerald-50/40" : "border-border bg-surface-1"}`}>
      <div className="flex items-center justify-between mb-2.5">
        <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border ${
          live ? "border-emerald-300 bg-white text-emerald-700" : "border-border bg-surface-2 text-text-muted"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-text-muted/40"}`} />
          {live ? "In progress" : call.status}
        </span>
        <span className="text-[13px] tabular-nums text-text-primary">
          {live ? mmss(elapsed) : mmss(call.durationSeconds)}
        </span>
      </div>

      <div className="text-[19px] font-semibold text-text-primary tabular-nums tracking-tight">
        {prettyPhone(call.fromNumber)}
      </div>
      <div className="text-[11.5px] text-text-muted mt-0.5">
        {call.direction || detail?.direction || "inbound"} · {call.agentName}
      </div>

      <div className="my-3" style={{ ["--wf-active" as string]: "#10b981" }}>
        <Waveform active={live} height={44} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          {live
            ? <><Loader2 size={11} className="animate-spin" /> listening</>
            : detail?.transcript ? "transcript ready" : "no transcript"}
        </span>
        <span className="tabular-nums opacity-70">call {call.id}</span>
      </div>
    </section>
  );
}

function Step({
  n, title, icon: Icon, state, badge, compact, children,
}: {
  n: number; title: string; icon: typeof PhoneCall; state: StepState;
  badge?: { text: string; tone: "ok" | "warn" | "neutral" }; compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border bg-surface-1 ${state === "running" ? "border-amber-300" : "border-border"}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/70">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`grid place-items-center w-6 h-6 rounded-lg shrink-0 ${
            state === "done" ? "bg-brand/10 text-brand"
            : state === "running" ? "bg-amber-100 text-amber-700"
            : "bg-surface-2 text-text-muted"
          }`}>
            <Icon size={13} />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-text-muted">Step {n}</div>
            <div className="text-[13px] font-medium text-text-primary truncate">{title}</div>
          </div>
        </div>
        {badge && (
          <span className={`text-[10.5px] px-2 py-0.5 rounded-full border shrink-0 ${
            badge.tone === "ok" ? "border-brand/30 bg-brand/5 text-brand"
            : badge.tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-700"
            : "border-border bg-surface-2 text-text-secondary"
          }`}>
            {badge.text}
          </span>
        )}
      </div>
      <div className={compact ? "p-3.5" : "p-4"}>{children}</div>
    </section>
  );
}

function StateDot({ state }: { state: StepState }) {
  if (state === "done") return <Check size={11} className="text-brand" />;
  if (state === "running") return <Loader2 size={11} className="animate-spin" />;
  if (state === "skipped") return <MinusCircle size={11} className="opacity-60" />;
  return <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />;
}

/**
 * The honest empty state.
 *
 * Borrowed wholesale from the claims desk, which put it best: absence of a result is not
 * the same as a negative result, and a step that says nothing leaves the reader to assume
 * the worse of the two.
 */
function Empty({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "ok" | "warn" }) {
  return (
    <p className={`text-[12px] leading-relaxed ${
      tone === "ok" ? "text-text-secondary" : tone === "warn" ? "text-amber-800" : "text-text-muted"
    }`}>
      {children}
    </p>
  );
}

function Meta({ label, value, sub, pill }: {
  label: string; value: string; sub?: string; pill?: { text: string; tone: "ok" };
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[13px] text-text-primary font-medium tabular-nums whitespace-nowrap">{value}</span>
        {pill && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-brand/30 bg-brand/5 text-brand shrink-0">
            {pill.text}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] text-text-muted truncate">{sub}</div>}
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`tabular-nums ${strong ? "text-[22px] font-semibold text-text-primary" : "text-[16px] text-text-secondary"}`}>
        {value}
      </div>
    </div>
  );
}

/* ================================================================= format */

/**
 * Splits a transcript into turns.
 *
 * The ASR writes "Agent:" and "Caller:" inline rather than on separate lines, so a naive
 * split on newline gives one enormous paragraph. Splitting on the speaker labels is what
 * makes it readable, and anything before the first label is kept rather than dropped.
 */
function splitTurns(raw: string): Array<{ who: string; text: string }> {
  const parts = raw.split(/(?=(?:Agent|Caller)\s*:)/g).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => {
    const m = p.match(/^(Agent|Caller)\s*:\s*([\s\S]*)$/);
    return m ? { who: m[1], text: m[2].trim() } : { who: "", text: p };
  }).filter((t) => t.text);
}

function mmss(secs: number | null | undefined): string {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** +91 98400 11223 — grouped the way an Indian desk reads a number aloud. */
function prettyPhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return raw ?? "—";
  const last10 = d.slice(-10);
  const cc = d.slice(0, -10);
  return `${cc ? `+${cc} ` : ""}${last10.slice(0, 5)} ${last10.slice(5)}`;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
