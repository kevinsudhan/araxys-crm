import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  PhoneCall, ScanText, Boxes, Users, Mail, Calculator, ShieldCheck,
  ArrowUpRight, Check, Loader2, MinusCircle, RefreshCw,
} from "lucide-react";
import Waveform from "../components/orchestration/Waveform";
import ContainerScene from "../components/ContainerScene";
import {
  getLiveCalls, getCallLogs, getRealRecords, getSlotPlan, checkSpace,
  type LiveCall, type RecentCall, type CallLog, type RealRecord, type SlotPlan,
  type CheckSpaceResponse,
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

/**
 * Three seconds, matching the claims desk this is modelled on.
 *
 * Fast enough that a live transcript visibly grows while someone is talking, slow enough
 * that a demo does not hammer SnapServe's rate limit through the Edge Function.
 */
const POLL_MS = 3000;

type StepState = "done" | "running" | "waiting" | "skipped";

export default function AgentOrchestration() {
  const [live, setLive] = useState<LiveCall[]>([]);
  const [recent, setRecent] = useState<RecentCall[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [logs, setLogs] = useState<CallLog[]>([]);
  const [records, setRecords] = useState<RealRecord[]>([]);
  const [plan, setPlan] = useState<SlotPlan | null>(null);
  /**
   * How many of this consignment's pieces have been drawn into the container so far.
   *
   * The engine answers instantly; a number appearing fully formed does not read as work
   * being done. Loading the blocks in one at a time shows the shape of the answer — how
   * the pieces sit, how far down the container they reach — which is the part a person
   * checks. It is a reveal of a computed result, not a simulation of one being computed.
   */
  const [loaded, setLoaded] = useState(0);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  /**
   * How far through the call we are, 0 to 1.
   *
   * SnapServe does not expose a partial transcript while a call is running — the text
   * lands when the call ends. So the turns are played out against the call's real duration
   * rather than invented: same words, same order, at the pace they were actually spoken.
   * While a call IS live this tracks the wall clock, so the page keeps up with the room.
   */
  const [playhead, setPlayhead] = useState(0);
  const playFrom = useRef<number>(Date.now());

  // ---------------------------------------------------------------- polling

  const poll = useCallback(async () => {
    try {
      const { live: l, recent: r, checkedAt: at } = await getLiveCalls();
      setLive(l);
      setRecent(r);
      setCheckedAt(at);
      setError(null);
      // A call that is actually ringing wins; otherwise the most recent one is what the
      // desk wants to look at. There is no list to pick from any more, so this is the
      // only thing choosing.
      const next = l[0]?.id ?? r[0]?.id ?? null;
      if (next !== null) setSelectedId((cur) => (cur === next ? cur : next));
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
    // `[tick === 0]` here fired on mount, again when tick first incremented, and never
    // after — so an enquiry written during a demo never appeared. The tick itself is the
    // dependency.
  }, [tick]);

  /**
   * Transcripts come from the logs endpoint, not from a per-call one.
   *
   * `/calls/:id` is declared in the client and does not exist on the deployed function —
   * it 404s on every poll. `/calls/logs` returns the same calls with their transcripts, so
   * the detail is matched out of that by id.
   */
  useEffect(() => {
    playFrom.current = Date.now();
    setPlayhead(0);
  }, [selectedId]);

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

  // ---------------------------------------------------------------- derived

  const activeCall = live[0] ?? null;
  const selected = useMemo(
    () => live.find((c) => c.id === selectedId) ?? recent.find((c) => c.id === selectedId) ?? null,
    [live, recent, selectedId],
  );

  /**
   * Which enquiry the right-hand side is about.
   *
   * By default the caller's own record, matched the way the CRM matches — last ten digits.
   * The override exists because the desk often wants to watch an enquiry that is not the
   * one currently ringing, and because a call that gave no dimensions genuinely cannot get
   * past the space check, which makes it a poor thing to be stuck on.
   */
  const [refOverride, setRefOverride] = useState<string | null>(null);

  const matched = useMemo(() => {
    const key = (selected?.fromNumber ?? "").replace(/\D/g, "").slice(-10);
    if (!key) return null;
    return records.find((r) => r.phone.replace(/\D/g, "").slice(-10) === key) ?? null;
  }, [records, selected]);

  const record = useMemo(
    () => (refOverride ? records.find((r) => r.ref === refOverride) ?? null : matched),
    [records, refOverride, matched],
  );

  // A new call takes the view back to its own record — otherwise the desk keeps staring at
  // whatever they last picked while a customer is on the line.
  useEffect(() => { setRefOverride(null); }, [selected?.id]);

  const fields = useMemo(() => {
    const d = record?.requestDetails ?? {};
    return REQUEST_FIELDS
      .map((f) => ({ key: f.key, label: f.label, value: (d as Record<string, unknown>)[f.key] }))
      .filter((f) => f.value !== undefined && f.value !== null && f.value !== "");
  }, [record]);

  const [fit, setFit] = useState<CheckSpaceResponse | null>(null);
  const [fitReason, setFitReason] = useState<string | null>(null);

  /**
   * Everything the space answer depends on, as a string. See the dependency note below.
   */
  const spaceKey = useMemo(() => {
    if (!record) return "";
    const d = (record.requestDetails ?? {}) as Record<string, unknown>;
    return [
      record.ref, record.origin, record.destination, record.sailingDate,
      d.piece_length_cm, d.piece_width_cm, d.piece_height_cm,
      d.piece_count, d.weight_per_piece_kg, d.stackable, d.upright_only,
    ].join("|");
  }, [record]);

  /**
   * The space check for THIS caller's cargo, on their route.
   *
   * It used to show the fullest container on the book, which was real geometry belonging
   * to somebody else's shipment — accurate, and the wrong answer to the question the page
   * is asking. A step in a pipeline about one call has to be about that call.
   *
   * Needs a route and the dimensions of one piece. Most calls do not produce those, and
   * when they do not the step says which ones are missing rather than substituting a
   * container that has nothing to do with the caller.
   */
  useEffect(() => {
    setFit(null);
    setFitReason(null);
    setPlan(null);
    if (!record) return;

    const d = (record.requestDetails ?? {}) as Record<string, unknown>;
    const num = (k: string) => {
      const v = Number(d[k]);
      return Number.isFinite(v) && v > 0 ? v : 0;
    };
    const missing: string[] = [];
    if (!record.origin || !record.destination) missing.push("the route");
    const L = num("piece_length_cm"), W = num("piece_width_cm"), H = num("piece_height_cm");
    if (!L || !W || !H) missing.push("piece dimensions");
    const qty = num("piece_count") || 1;
    const each = num("weight_per_piece_kg");

    if (missing.length) {
      setFitReason(`Cannot check space without ${missing.join(" and ")}.`);
      return;
    }

    let cancelled = false;
    checkSpace({
      route: `${record.origin} to ${record.destination}`,
      sailing_date: record.sailingDate || undefined,
      length_cm: L, width_cm: W, height_cm: H,
      quantity: qty,
      weight_kg_each: each || 1,
      stackable: d.stackable === undefined ? undefined : Boolean(d.stackable),
      upright_only: d.upright_only === undefined ? undefined : Boolean(d.upright_only),
    })
      .then(async (res) => {
        if (cancelled) return;
        setFit(res);
        setLoaded(0);
        // The container it would actually go into, so the drawing matches the answer.
        if (res.slot_id) {
          try { const p = await getSlotPlan(res.slot_id); if (!cancelled) setPlan(p); } catch { /* the card says */ }
        }
      })
      .catch((e) => { if (!cancelled) setFitReason(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  // Deliberately NOT [record]. `record` is records.find(...), so the poll that refreshes
  // the call list hands back a new object every few seconds even when nothing about this
  // enquiry changed — the check re-ran on a loop, and each run reset `fit`, which reset
  // the loading animation to row one forever. Keyed on the values the answer depends on.
  }, [spaceKey]);

  /**
   * This consignment, placed where the engine said it goes.
   *
   * Until now step 2 drew the sailing's existing cargo and nothing else, so the one
   * genuinely three-dimensional answer in the system — how these boxes sit in this
   * container — arrived as a sentence. The blocks below are the engine's own stow:
   * `across`, `high` and `rows` come back from checkFit, and `orientation` is how it
   * turned the piece to make it work. Nothing here is re-derived on the client, because
   * a second implementation of the packing arithmetic would eventually disagree with the
   * first and the drawing would quietly stop matching the answer.
   */
  const placement = useMemo(() => {
    if (!fit || !plan || !record) return null;
    const lp = fit.loading_plan;
    const o = fit.orientation;
    if (!lp || !o || !lp.rows) return null;
    const total = lp.per_row * lp.rows;
    return {
      id: "__this-consignment",
      slotId: plan.slot.id,
      clientName: record.company || record.customerName || "This consignment",
      reference: record.ref,
      // The frontier is where the plan says new cargo starts, not the end of used length:
      // cargo already aboard can leave gaps that are not bookable.
      xM: plan.frontier,
      lengthM: lp.floor_length_needed_m,
      piecesAcross: lp.across,
      piecesHigh: lp.high,
      rows: lp.rows,
      quantity: total,
      pieceLengthM: o.lengthM,
      pieceWidthM: o.widthM,
      pieceHeightM: o.heightM,
      weightKg: lp.total_weight_kg,
      colorIndex: 2,
      source: "voice_agent" as const,
    };
  }, [fit, plan, record]);

  /**
   * Loads the blocks in, one row at a time, once there is something to load.
   *
   * Keyed on a string rather than on `placement` itself. `placement` is a useMemo that
   * builds a new object whenever any of its inputs re-render, so depending on the object
   * restarted this interval on every pass and the count never got past one — the caption
   * read "Loading row 1 of 5" forever while the container stayed empty.
   */
  const placementKey = placement ? `${placement.reference}:${placement.slotId}:${placement.rows}` : "";
  const placementRows = placement?.rows ?? 0;
  useEffect(() => {
    if (!placementKey || placementRows < 1) return;
    setLoaded(0);
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      setLoaded(n);
      if (n >= placementRows) clearInterval(id);
    }, 260);
    return () => clearInterval(id);
  }, [placementKey, placementRows]);

  /**
   * The plan handed to the scene, with this consignment's rows added as they load.
   *
   * Partial rows rather than a partial block: a half-drawn block would imply the engine
   * proposed splitting a row, which it did not.
   */
  const scenePlan = useMemo(() => {
    if (!plan) return null;
    if (!placement || loaded <= 0) return plan;
    const rows = Math.min(loaded, placement.rows);
    const perRow = placement.quantity / placement.rows;
    return {
      ...plan,
      consignments: [
        ...plan.consignments,
        {
          ...placement,
          rows,
          quantity: Math.round(perRow * rows),
          lengthM: (placement.lengthM / placement.rows) * rows,
        },
      ],
    };
  }, [plan, placement, loaded]);

  const inProgress = live.some((c) => c.id === selectedId);

  /**
   * The live transcript wins over the stored one.
   *
   * While a call is running, the poll carries the transcript so far and it grows between
   * polls — so the turns appear as they are actually spoken. Once the call ends the stored
   * log takes over, and the playback clock below paces it instead.
   */
  const liveTranscript = selected?.transcript ?? null;
  const isLiveText = inProgress && Boolean(liveTranscript);
  const turns = useMemo(
    () => splitTurns(liveTranscript || detail?.transcript || ""),
    [liveTranscript, detail],
  );

  /**
   * The clock behind the reveal.
   *
   * A live call runs against the wall clock so the page stays level with the room. A
   * finished call is played out over its own recorded duration, capped so a nine-minute
   * call does not take nine minutes to watch.
   */
  useEffect(() => {
    // A call with no transcript has nothing to play, so the playhead goes straight to the
    // end. Returning early instead left it at zero forever, and because the stage gate
    // waits on it, every later stage stayed stuck at "waiting" — the whole pipeline frozen
    // by a silent call.
    if (turns.length === 0) { setPlayhead(1); return; }
    const secs = Math.min(detail?.duration_secs ?? 90, 150);
    const id = setInterval(() => {
      const elapsed = (Date.now() - playFrom.current) / 1000;
      setPlayhead(Math.min(1, elapsed / Math.max(secs, 20)));
    }, 250);
    return () => clearInterval(id);
  }, [turns.length, detail?.duration_secs]);

  // Live: show every turn there is, because each one is new. Finished: pace it out.
  const turnsShown = isLiveText ? turns.length : Math.max(1, Math.round(playhead * turns.length));

  /**
   * Fields appear as the turn that reveals them goes by.
   *
   * Spread evenly across the call rather than mapped to particular sentences: the reader
   * works on the whole transcript at the end, so claiming a given field was learned at a
   * given second would be a fiction. Spreading them is honest about the order without
   * inventing a timestamp.
   */
  const fieldsShown = isLiveText ? fields.length : Math.round(playhead * fields.length);

  /**
   * Step state, read off real data rather than a timer.
   *
   * `pipeline` would be the honest source for the later steps, but the deployed API does
   * not return that column yet, so these derive from what it does return. Where nothing
   * can be known, the step says "waiting" instead of inventing a tick.
   */
  /**
   * How far down the pipeline this enquiry has actually got.
   *
   * One index, so the stages read as a sequence rather than seven independent lights: every
   * stage before it is done, the one at it is running, everything after is waiting. Each
   * threshold is a real condition — the call being over, fields existing, a plan loading, a
   * price on the record — so the line only moves when something has genuinely happened.
   */
  const reached = (() => {
    if (!selected) return 0;
    if (inProgress) return 0;                     // the call is still happening
    if (turns.length > 0 && playhead < 1) return 0;// still playing out what was said
    if (fields.length > 0 && fieldsShown < fields.length) return 1;  // still reading it
    if (!fit && !fitReason) return 2;             // checking space
    if (!record?.quotedAmountInr) return 3;       // out to partners
    if (!record?.agreedAmountInr) return 6;       // priced, waiting on a human
    return 7;                                     // done
  })();

  const stateFor = (i: number): StepState =>
    i < reached ? "done" : i === reached ? "running" : "waiting";

  const steps: Array<{ key: string; n: number; title: string; icon: typeof PhoneCall; state: StepState }> = [
    { key: "call",     n: 1, title: "Call",              icon: PhoneCall,   state: stateFor(0) },
    { key: "intake",   n: 2, title: "Intake facts",      icon: ScanText,    state: stateFor(1) },
    { key: "space",    n: 3, title: "Space check",       icon: Boxes,       state: stateFor(2) },
    { key: "partners", n: 4, title: "Partner selection", icon: Users,       state: stateFor(3) },
    { key: "rfq",      n: 5, title: "Rate requests",     icon: Mail,        state: stateFor(4) },
    { key: "price",    n: 6, title: "Pricing",           icon: Calculator,  state: stateFor(5) },
    { key: "approve",  n: 7, title: "Approval",          icon: ShieldCheck, state: stateFor(6) },
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

      <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
        {/* ============================================================ left rail */}
        <div className="space-y-3">
          <CallCard call={activeCall ?? selected} live={Boolean(activeCall)} turnCount={turns.length} />

          {turns.length > 0 && (
            <section className="rounded-xl border border-border bg-surface-1 overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-border flex items-center gap-2">
                <ScanText size={14} className="text-text-muted" />
                <span className="text-[12.5px] font-medium text-text-primary">What was said</span>
                {isLiveText ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
                  </span>
                ) : playhead < 1 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-text-muted">
                    <Loader2 size={10} className="animate-spin" /> {turnsShown}/{turns.length}
                  </span>
                )}
              </div>
              <div className="max-h-[220px] overflow-y-auto px-3.5 py-2.5 space-y-1.5">
                {turns.slice(0, turnsShown).map((t, i) => (
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

        </div>

        {/* ============================================================ right column */}
        <div className="space-y-3 min-w-0">
          {/* the strip — what this call is, at a glance */}
          <section className="rounded-xl border border-border bg-surface-1 px-4 py-3">
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div className="min-w-[190px]">
                <label htmlFor="enq" className="text-[10px] uppercase tracking-wide text-text-muted">Enquiry</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <select
                    id="enq"
                    value={record?.ref ?? ""}
                    onChange={(e) => setRefOverride(e.target.value || null)}
                    className="text-[13px] font-medium text-text-primary bg-transparent border border-border rounded px-1.5 py-0.5 max-w-[180px]"
                  >
                    {!record && <option value="">not yet matched</option>}
                    {records.map((r) => (
                      <option key={r.ref} value={r.ref}>
                        {r.ref}{r.company ? ` · ${r.company}` : ""}
                      </option>
                    ))}
                  </select>
                  {refOverride && (
                    <button
                      onClick={() => setRefOverride(null)}
                      className="text-[10.5px] text-text-muted hover:text-text-primary underline"
                      title="Go back to the record this caller matched"
                    >
                      caller
                    </button>
                  )}
                </div>
              </div>
              <div className="min-w-[130px]"><Meta label="Customer" value={record?.company || record?.customerName || "—"} /></div>
              <div className="min-w-[110px]">
                <Meta label="Agent" value={selected?.agentName ?? "—"}
                  sub={selected?.direction ? `${selected.direction} · ${record?.sourceLanguage ?? "en"}` : undefined} />
              </div>
              <div className="ml-auto self-center">
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

          {/*
            The spine.
            A connected rail rather than seven separate pills: the stages are a sequence,
            and pills spaced evenly apart read as seven independent switches. The line
            between them is the thing being demonstrated.
          */}
          <nav className="rounded-xl border border-border bg-surface-1 px-4 py-3 min-w-0" aria-label="Pipeline">
            <ol className="flex items-start gap-0 overflow-x-auto">
              {steps.map((st, i) => {
                const Icon = st.icon;
                const last = i === steps.length - 1;
                return (
                  <li key={st.key} className="flex items-start shrink-0">
                    <div className="flex flex-col items-center gap-1.5 w-[78px]">
                      <span
                        className={`grid place-items-center w-7 h-7 rounded-full border-2 transition-colors duration-500 ${
                          st.state === "done" ? "border-brand bg-brand text-white"
                          : st.state === "running" ? "border-amber-400 bg-amber-50 text-amber-700"
                          : "border-border bg-surface-1 text-text-muted"
                        }`}
                        title={st.title}
                      >
                        {st.state === "done"
                          ? <Check size={14} />
                          : st.state === "running"
                            ? <Loader2 size={13} className="animate-spin" />
                            : <Icon size={13} />}
                      </span>
                      <span className={`text-[10.5px] text-center leading-tight ${
                        st.state === "waiting" ? "text-text-muted" : "text-text-primary font-medium"
                      }`}>
                        {st.title}
                      </span>
                    </div>
                    {!last && (
                      <span
                        aria-hidden
                        className={`h-[2px] w-5 mt-[13px] rounded transition-colors duration-500 ${
                          st.state === "done" ? "bg-brand" : "bg-border"
                        }`}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* ---------------------------------------------------------- step 1 */}
          <Step n={1} title="Intake facts" icon={ScanText}
            state={steps[1].state}
            badge={fields.length ? { text: `${Math.min(fieldsShown, fields.length)} of ${REQUEST_FIELDS.length} fields`, tone: fieldsShown >= fields.length ? "ok" : "warn" } : undefined}>
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
                {fields.slice(0, 12).map((f, i) => (
                  <div
                    key={f.key}
                    className={`transition-all duration-500 ${
                      i < fieldsShown ? "opacity-100 translate-y-0" : "opacity-25 translate-y-1"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-text-muted">{f.label}</div>
                    <div className="text-[12.5px] text-text-primary font-medium tabular-nums mt-0.5 break-words">
                      {i < fieldsShown ? String(f.value) : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Step>

          {/* ---------------------------------------------------------- step 2 */}
          <Step n={2} title="Space check" icon={Boxes} state={steps[2].state}
            badge={fit ? { text: fit.available ? "fits" : "will not fit", tone: fit.available ? "ok" : "warn" } : undefined}>
            {fitReason ? (
              <Empty>
                {fitReason} This is the ordinary outcome of a short call — the fit engine
                works in three dimensions and will not guess at a box it has not been given.
              </Empty>
            ) : !record ? (
              <Empty>Waiting for a record to check against.</Empty>
            ) : !fit ? (
              <Empty>Checking {record.origin} to {record.destination}…</Empty>
            ) : (
              <>
                {/* The engine's own words, which are what the agent said on the call. */}
                <p className={`text-[12.5px] leading-relaxed mb-3 ${fit.available ? "text-text-primary" : "text-amber-800"}`}>
                  {fit.spoken_answer}
                </p>

                <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3 text-[11.5px]">
                  {fit.carrier && <Fact k="Carrier" v={fit.carrier} />}
                  {fit.container && <Fact k="Container" v={fit.container} />}
                  {fit.sailing_date && <Fact k="Sailing" v={fit.sailing_date} />}
                  {fit.cutoff_date && <Fact k="Cut-off" v={fit.cutoff_date} />}
                  {fit.loading_plan && (
                    <Fact k="Stow" v={`${fit.loading_plan.across} across × ${fit.loading_plan.high} high, ${fit.loading_plan.rows} rows`} />
                  )}
                  {fit.loading_plan && (
                    <Fact k="Floor needed" v={`${fit.loading_plan.floor_length_needed_m.toFixed(2)}m`} />
                  )}
                  {fit.space_left_after && (
                    <Fact k="Left after" v={`${fit.space_left_after.lengthM.toFixed(2)}m · ${fit.space_left_after.payloadKg.toLocaleString("en-IN")}kg`} />
                  )}
                </div>

                {scenePlan && (scenePlan.consignments.length > 0 || placement) && (
                  <>
                    <ContainerScene
                      plan={scenePlan}
                      positions={positions}
                      onMove={(id, xM) => setPositions((p) => ({ ...p, [id]: xM }))}
                      onRestow={() => {}}
                      dragMode="reorder"
                      selectedId={placement && loaded > 0 ? placement.id : null}
                      onSelect={() => {}}
                      explode={0}
                    />
                    {placement ? (
                      <p className="text-[11.5px] text-text-muted mt-2">
                        {loaded < placement.rows ? (
                          <>
                            Loading row {Math.max(1, loaded)} of {placement.rows} —{" "}
                            {placement.piecesAcross} across × {placement.piecesHigh} high.
                          </>
                        ) : (
                          <>
                            <span className="text-text-primary font-medium">
                              {placement.quantity} pieces placed
                            </span>{" "}
                            at {placement.xM.toFixed(2)}m, taking{" "}
                            {placement.lengthM.toFixed(2)}m of floor — {placement.piecesAcross}{" "}
                            across × {placement.piecesHigh} high, {placement.rows} rows deep.
                            The paler blocks were already aboard. Drag to restow.
                          </>
                        )}
                      </p>
                    ) : (
                      <p className="text-[11.5px] text-text-muted mt-2">
                        What is already stowed on {scenePlan.slot.route}, the sailing this cargo
                        would join. Drag a block to restow it.
                      </p>
                    )}
                  </>
                )}
                {scenePlan && scenePlan.consignments.length === 0 && !placement && (
                  <Empty>That sailing is empty — the whole {scenePlan.container.lengthM}m is free.</Empty>
                )}
                {!fit.available && fit.max_pieces_that_fit !== undefined && (
                  <p className="text-[11.5px] text-amber-800 mt-2">
                    {fit.max_pieces_that_fit} of the pieces would fit on this sailing. The rest
                    need the next one, or a second container — the desk decides which, because
                    splitting a consignment is a commercial call and not an arithmetic one.
                  </p>
                )}
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

function CallCard({ call, live, turnCount }: { call: LiveCall | RecentCall | null; live: boolean; turnCount: number }) {
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
        {call.direction || "inbound"} · {call.agentName}
      </div>

      <div className="my-3" style={{ ["--wf-active" as string]: "#10b981" }}>
        <Waveform active={live} height={44} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          {live
            ? <><Loader2 size={11} className="animate-spin" /> listening</>
            : turnCount ? `${turnCount} turns` : "no transcript"}
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

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span className="inline-flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{k}</span>
      <span className="text-text-primary tabular-nums">{v}</span>
    </span>
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
 *
 * No word boundary before the alternation: it is unnecessary — the labels only appear at
 * the start of a turn — and writing one is how a literal backspace character got into this
 * regex, silently matching nothing and collapsing a 31-turn call into one block of text.
 */
function splitTurns(raw: string): Array<{ who: string; text: string }> {
  const parts = raw.split(/(?=(?:Agent|Caller)\s*:)/g).map((p) => p.trim()).filter(Boolean);
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
