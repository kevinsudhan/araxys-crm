import { useCallback, useEffect, useRef, useState } from "react";
import { parseFigure } from "../lib/figures";
import { AlertCircle, Eye, EyeOff, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import Select from "./Select";
import { CHARGE_HEADS, LINE_CURRENCIES, UNITS, money } from "../services/charges";
import { missingRate, rateInUse } from "../lib/quoteChecks";
import { GST_RATES, SECTIONS, asSection } from "../lib/pastedQuote";
import {
  addLine,
  addLines,
  linesFor,
  removeLine,
  summarise,
  updateLine,
  type QuoteLine,
} from "../services/quoteLines";
import type { PartnerQuote } from "../services/rfq";
import { bestPerCharge, laneLabel, ratesFor, type ResolvedRate } from "../services/rateMaster";

/**
 * What a quotation is made of.
 *
 * ---------------------------------------------------------------------------
 * THE SAME SHAPE AS THE INVOICE IT BECOMES
 *
 * A quotation used to be one number in a box. The customer asks what it is made
 * of and nobody can say; the charges get typed again at billing and the two
 * disagree; margin per charge head is unanswerable. Lines fix all three, and
 * the accepted quote's lines are what the invoice starts from.
 *
 * WHY THE PARTNER'S FIGURE GOES IN A COST COLUMN AND NOT THE RATE
 *
 * Because it is a buying price. Dropping an agent's number into the rate would
 * put their cost in front of the shipper, which is the one mistake on this
 * screen that cannot be undone once the mail has gone. "Use as cost" fills the
 * cost column and leaves the sell rate for a person to decide.
 * ---------------------------------------------------------------------------
 */

/**
 * One editable cell of the grid.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CELL HAS A VISIBLE BORDER
 *
 * It used to be `border-transparent bg-transparent`, drawing a box only on
 * hover. On a page with one or two fields that reads as clean; on a grid of
 * fourteen columns it reads as broken — a row of numbers floating in space,
 * with no way to tell what is editable, what is computed, and where one cell
 * ends and the next begins. Finding the cost column meant counting across.
 *
 * A rate sheet is a form, and a form shows its fields.
 * ---------------------------------------------------------------------------
 */
function Cell({
  value,
  onCommit,
  locked,
  align,
  mono,
  placeholder,
  field,
  label,
  invalid,
  figure,
}: {
  value: string;
  onCommit: (v: string) => void;
  /**
   * A figure: "1,150.50" is committed as 1150.5, and what is not a figure is
   * put back as it was — never saved as nothing.
   */
  figure?: boolean;
  locked?: boolean;
  /** What is missing, when something is: the cell is outlined and says so. */
  invalid?: string;
  align?: "right";
  mono?: boolean;
  placeholder?: string;
  /** Names the cell, so a charge just added can be put in front of the cursor. */
  field?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (locked) {
    return (
      <span
        className={`block truncate px-2 py-1.5 text-[12.5px] text-text-secondary ${
          align === "right" ? "text-right tabular-nums" : ""
        } ${mono ? "font-mono" : ""}`}
      >
        {value || "—"}
      </span>
    );
  }

  return (
    <input
      value={draft}
      placeholder={placeholder}
      data-field={field}
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      title={invalid}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === value) return;
        if (!figure || draft.trim() === "") return onCommit(draft);
        const n = parseFigure(draft);
        if (n === null) return setDraft(value);
        onCommit(String(n));
      }}
      onKeyDown={(e) => {
        // Enter keeps the figure, as moving off the cell does.
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`h-8 w-full rounded-lg border bg-surface-1 px-2.5 text-[12.5px] text-text-primary transition-colors placeholder:text-text-muted focus:border-text-accent focus:outline-none ${
        invalid ? "border-text-danger bg-bg-danger/40 placeholder:text-text-danger" : "border-border hover:border-border-strong"
      } ${
        align === "right" ? "text-right tabular-nums" : ""
      } ${mono ? "font-mono" : ""}`}
    />
  );
}

/**
 * A figure the database works out: an amount, or a cost.
 *
 * Shaped like the inputs beside it so the row keeps its rhythm, and filled
 * rather than bordered so it is obvious at a glance that typing here is not
 * how the number changes.
 */
function Computed({ value }: { value: string }) {
  return (
    <span className="flex h-8 items-center justify-end rounded-lg bg-surface-2 px-2.5 text-[12.5px] font-medium tabular-nums text-text-primary">
      {value}
    </span>
  );
}

export default function QuoteCharges({
  quoteId,
  locked,
  partnerQuotes,
  lane,
  quoteCurrency = "INR",
  quoteFxRate = 1,
  withGst: tableWithGst,
  reviseOnEdit,
  revisionName,
  onChanged,
}: {
  quoteId: string;
  /** An accepted quote is what the customer agreed to; its charges are fixed. */
  locked?: boolean;
  /** Replies that came back from partners, offered as a cost against a line. */
  partnerQuotes?: PartnerQuote[];
  /**
   * What this job is, so the rate master can be asked what applies to it.
   *
   * Absent means the button is not offered: filling a quotation from rates for
   * a lane nobody has recorded would produce the standing charges and no
   * freight, which looks like a complete quotation and is not.
   */
  lane?: {
    origin: string | null;
    destination: string | null;
    mode?: string | null;
    direction?: string | null;
  };
  /** What the customer is quoted in, and what it converts at. */
  quoteCurrency?: string;
  quoteFxRate?: number;
  /** The quotation goes out as the desk's rate table, which shows each charge's GST (services/pasteQuote `tableLayout`). */
  withGst?: boolean;
  /**
   * A sent quotation (118): its charges stay editable, and the first change
   * makes its next revision (services/quoteLines `reviseQuote`) — the change
   * lands on the copy, and the version the customer has keeps its figures.
   */
  reviseOnEdit?: () => Promise<{ quoteId: string; lines: Record<string, string> }>;
  /** The revision that change makes ("Rev 1"), for the line that says so. */
  revisionName?: string;
  onChanged?: () => void;
}) {
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState("");
  const addRef = useRef<HTMLDivElement>(null);
  /** The charge just added: brought into view with its rate ready to type. */
  const [fresh, setFresh] = useState<string | null>(null);
  /**
   * How wide the panel is. The grid used to be a fixed 74–86rem table in a
   * sideways scroller, so on a laptop it was a thin strip that scrolled both
   * ways — and the currency and unit menus opened inside that strip, clipped
   * to one option. The layout now follows the room: one row per charge where
   * it fits, and a card per charge where it does not. Nothing scrolls inside
   * the panel; it grows.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [filling, setFilling] = useState(false);
  /** What the rate master offered, and what was done with it. */
  const [filled, setFilled] = useState<{ used: ResolvedRate[]; skipped: string[] } | null>(null);
  /** The buy side, codes and minimums, shown on request; remembered on this browser. */
  const [showCosts, setShowCosts] = useState(() => {
    try {
      return localStorage.getItem("quoteCharges:costs") === "on";
    } catch {
      return false;
    }
  });
  const toggleCosts = () =>
    setShowCosts((v) => {
      try {
        localStorage.setItem("quoteCharges:costs", v ? "off" : "on");
      } catch {
        /* not kept: shown for this visit only */
      }
      return !v;
    });

  /**
   * Where an edit lands. On a sent quotation, the first edit makes the
   * revision (once: later edits, and a second one racing the first, wait on
   * the same promise) and every edit from then on goes to the copy of the
   * charge it was made on.
   */
  const revision = useRef<Promise<{ quoteId: string; lines: Record<string, string> }> | null>(null);
  const showing = useRef(quoteId);
  async function target(): Promise<{ quoteId: string; line: (l: QuoteLine) => string }> {
    if (!reviseOnEdit) return { quoteId, line: (l) => l.id };
    revision.current ??= reviseOnEdit().catch((e) => {
      revision.current = null;
      throw e;
    });
    const r = await revision.current;
    showing.current = r.quoteId;
    return { quoteId: r.quoteId, line: (l) => r.lines[l.id] ?? l.id };
  }
  const edit = (l: QuoteLine, patch: Parameters<typeof updateLine>[1]) =>
    run(async () => {
      const t = await target();
      await updateLine(t.line(l), patch);
    });
  const drop = (l: QuoteLine) =>
    run(async () => {
      const t = await target();
      await removeLine(t.line(l));
    });

  const load = useCallback(async () => {
    try {
      // The revision, once an edit has made one: the parent shows it next.
      setLines(await linesFor(showing.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the charges.");
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // The charge just added, in view and ready: its rate if it has a name, its
  // name if it is a blank "other" charge.
  useEffect(() => {
    if (!fresh) return;
    const row = gridRef.current?.querySelector<HTMLElement>(`[data-line="${fresh}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const name = row.querySelector<HTMLInputElement>('[data-field="name"]');
    const target = name && !name.value ? name : row.querySelector<HTMLInputElement>('[data-field="rate"]');
    target?.focus();
    target?.select();
    setFresh(null);
  }, [fresh, lines]);

  useEffect(() => {
    if (!adding) return;
    const away = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAdding(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [adding]);

  /** Adds a charge, and puts it in front of the person who added it. */
  async function addCharge(line: { description: string; sac_code?: string; unit?: string }) {
    setAdding(false);
    setPick("");
    setError(null);
    const before = new Set(lines.map((l) => l.id));
    try {
      // On a pasted quotation a new charge joins Other charges; on an air one, at GST 18 like the rest.
      await addLine((await target()).quoteId, { position: lines.length + 1, quantity: 1, rate: 0, unit: "W/M", ...(lines.some((l) => l.section) ? { section: "other" as const, ...((tableWithGst ?? lane?.mode === "air") ? { gst_rate: 18 } : {}) } : {}), ...line });
      const next = await linesFor(showing.current);
      setLines(next);
      setFresh(next.find((l) => !before.has(l.id))?.id ?? null);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  };

  /**
   * Fill the quotation from the rate master.
   *
   * ---------------------------------------------------------------------------
   * WHAT IT WILL AND WILL NOT DO
   *
   * It adds a line for every charge the rate master has a rate for on this lane
   * and does not already have a line here. It never touches a line that is
   * already on the quotation — including an empty one somebody added by hand a
   * moment ago, because a rate written over a figure being typed is the kind of
   * thing that goes out unnoticed.
   *
   * WHY THE COST COMES ACROSS AND THE MARGIN IS NOT INVENTED
   *
   * The rate master holds both, so both are used: the sell becomes the rate and
   * the cost becomes `cost_inr`, which is what makes the margin visible while
   * the quotation is being built. Where the master has no cost, the line is
   * added with none rather than a guess.
   *
   * WHY QUANTITY IS 1 AND NOT DERIVED
   *
   * A per-kilo air rate needs the chargeable weight, a per-CBM sea rate needs
   * the volume, and a per-container rate needs the count — three different
   * facts, not all of which are recorded at quoting time. Putting 1 in is
   * obviously a placeholder; putting a derived number in that happens to be
   * wrong is not.
   * ---------------------------------------------------------------------------
   */
  async function fillFromRates() {
    if (!lane) return;
    setFilling(true);
    setError(null);
    try {
      const applicable = bestPerCharge(
        await ratesFor({
          origin: lane.origin,
          destination: lane.destination,
          mode: lane.mode ?? null,
          direction: lane.direction ?? null,
        })
      );

      const already = new Set(lines.map((l) => l.description.trim().toLowerCase()));
      const used: ResolvedRate[] = [];
      const skipped: string[] = [];

      for (const r of applicable) {
        if (already.has(r.charge_head.trim().toLowerCase())) {
          skipped.push(r.charge_head);
          continue;
        }
        used.push(r);
      }

      // One request, positioned in the order the rates resolved.
      await addLines(
        (await target()).quoteId,
        used.map((r, i) => ({
          position: lines.length + i + 1,
          description: r.charge_head,
          sac_code: r.sac_code,
          unit: r.unit,
          quantity: 1,
          rate: r.sell_rate,
          currency: r.currency,
          cost_inr: r.cost_rate,
        }))
      );

      await load();
      onChanged?.();
      setFilled({ used, skipped });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the rate master.");
    } finally {
      setFilling(false);
    }
  }

  /** A pasted quotation (106, 115) files its charges under Freight, Ex works, Destination or Other charges. */
  const anySection = lines.some((l) => l.section);
  /** A pasted air quotation goes out as the desk's rate table, which shows each charge's GST (115). */
  const withGst = anySection && (tableWithGst ?? lane?.mode === "air");

  /** Every cell of one charge, for whichever arrangement the width allows. */
  function cells(l: QuoteLine) {
    return {
      name: <Cell field="name" label="Charge name" value={l.description} locked={locked} onCommit={(v) => void edit(l, { description: v })} />,
      // Its group on the PDF and in the mail.
      group: locked ? (
        <span className="text-text-secondary">{SECTIONS.find((x) => x.key === asSection(l.section))?.title}</span>
      ) : (
        <Select
          label="Group"
          className="w-full"
          value={asSection(l.section)}
          options={SECTIONS.map((x) => ({ value: x.key, label: x.title.replace(/ Charges$/, "") }))}
          onChange={(v) => void edit(l, { section: asSection(v) })}
        />
      ),
      // Its GST in the air table, and on the invoice made from it; "—" is not stated, invoiced at 18.
      gst: locked ? (
        <span className="block px-2 text-right tabular-nums text-text-secondary">{l.gst_rate == null ? "—" : Number(l.gst_rate) ? `${Number(l.gst_rate)}%` : "None"}</span>
      ) : (
        <Select
          label="GST"
          className="w-full"
          value={l.gst_rate == null ? "" : String(Number(l.gst_rate))}
          options={[...(l.gst_rate == null ? [{ value: "", label: "—" }] : []), ...GST_RATES.map((g) => ({ value: String(g), label: g ? `${g}%` : "None" }))]}
          onChange={(v) => void edit(l, { gst_rate: v === "" ? null : Number(v) })}
        />
      ),
      code: (
        <Cell
          label="Charge code"
          value={l.charge_code ?? ""}
          locked={locked}
          mono
          placeholder="—"
          onCommit={(v) => void edit(l, { charge_code: v || null })}
        />
      ),
      currency: locked ? (
        <span className="font-mono text-text-secondary">{l.currency}</span>
      ) : (
        <Select
          label="Currency"
          className="w-full"
          value={l.currency}
          options={[...new Set([...LINE_CURRENCIES, l.currency])].map((c) => ({ value: c, label: c }))}
          onChange={(v) => {
            // Rupees are always at 1. A foreign currency starts at the rate another
            // charge on this quotation already uses for it; with none, the rate of
            // exchange is left for the desk to give, and flagged until it is (109).
            const inUse = v === "INR" ? 1 : rateInUse(lines.filter((x) => x.id !== l.id), v);
            void edit(l, { currency: v, ...(inUse ? { fx_rate: inUse } : {}) });
          }}
        />
      ),
      roe: (
        <Cell
          label="Rate of exchange"
          figure
          // Left at 1 on a foreign line is not a rate; shown empty and flagged.
          value={missingRate(l) ? "" : String(l.fx_rate)}
          placeholder={missingRate(l) ? "Rate?" : undefined}
          invalid={missingRate(l) ? `Rupees for one ${l.currency} — needed before this quotation can go` : undefined}
          // A rupee line's rate is always 1 and is not editable, even while the
          // column is up for the sake of a foreign line beside it.
          locked={locked || l.currency === "INR"}
          align="right"
          onCommit={(v) => Number(v) > 0 && void edit(l, { fx_rate: Number(v) })}
        />
      ),
      unit: locked ? (
        <span className="text-text-secondary">{l.unit || "—"}</span>
      ) : (
        <Select
          label="Unit"
          className="w-full"
          value={l.unit}
          options={UNITS.map((u) => ({ value: u, label: u }))}
          onChange={(v) => void edit(l, { unit: v })}
        />
      ),
      units: (
        <Cell
          label="Units"
          figure
          value={String(l.quantity)}
          locked={locked}
          align="right"
          onCommit={(v) => void edit(l, { quantity: Number(v) || 0 })}
        />
      ),
      rate: (
        <Cell
          field="rate"
          label="Sell per unit"
          figure
          value={String(l.rate)}
          locked={locked}
          align="right"
          onCommit={(v) => void edit(l, { rate: Number(v) || 0 })}
        />
      ),
      amount: <Computed value={money(l.amount_inr)} />,
      min: (
        <Cell
          label="Minimum amount"
          figure
          value={l.min_amount == null ? "" : String(l.min_amount)}
          locked={locked}
          align="right"
          placeholder="—"
          onCommit={(v) => void edit(l, { min_amount: v.trim() === "" ? null : Number(v) || 0 })}
        />
      ),
      costCurrency: locked ? (
        <span className="font-mono text-text-secondary">{l.cost_currency}</span>
      ) : (
        <Select
          label="Cost currency"
          className="w-full"
          value={l.cost_currency}
          options={[...new Set([...LINE_CURRENCIES, l.cost_currency])].map((c) => ({ value: c, label: c }))}
          onChange={(v) => void edit(l, { cost_currency: v, ...(v === "INR" ? { cost_fx_rate: 1 } : {}) })}
        />
      ),
      costRoe: (
        <Cell
          label="Cost rate of exchange"
          figure
          value={String(l.cost_fx_rate)}
          locked={locked || l.cost_currency === "INR"}
          align="right"
          onCommit={(v) => Number(v) > 0 && void edit(l, { cost_fx_rate: Number(v) })}
        />
      ),
      costRate: (
        <Cell
          label="Cost per unit"
          figure
          value={l.cost_rate == null ? "" : String(l.cost_rate)}
          locked={locked}
          align="right"
          placeholder="—"
          onCommit={(v) => void edit(l, { cost_rate: v.trim() === "" ? null : Number(v) || 0 })}
        />
      ),
      // Derived by the database from the cells before it, so the margin cannot
      // drift from the figures it is a margin on. Never typed.
      costAmount: <Computed value={l.cost_inr === null ? "—" : money(l.cost_inr)} />,
      vendor: locked ? (
        <span className="text-text-secondary">{l.vendor || "—"}</span>
      ) : quoted.length > 0 && !l.vendor ? (
        <Select
          label="Vendor"
          className="w-full"
          value=""
          options={[
            { value: "", label: "—" },
            ...quoted.map((p) => ({ value: p.id, label: p.partner_label || p.partner_email, hint: money(Number(p.amount)) })),
          ]}
          onChange={(v) => {
            const pq = quoted.find((p) => p.id === v);
            if (!pq) return;
            /*
              Taking a partner reply fills the vendor AND the cost, in the
              currency they quoted. It never touches the sell rate: their figure
              is a buying price, and putting one in front of the shipper sends
              them the agent's own cost.
            */
            void edit(l, {
              vendor: pq.partner_label || pq.partner_email,
              cost_rate: Number(pq.amount),
              cost_currency: pq.currency || "INR",
              partner_quote_id: pq.id,
            });
          }}
        />
      ) : (
        <Cell label="Vendor" value={l.vendor ?? ""} locked={locked} placeholder="—" onCommit={(v) => void edit(l, { vendor: v || null })} />
      ),
      remove: locked ? null : (
        <button
          onClick={() => void drop(l)}
          aria-label={`Remove ${l.description || "this charge"}`}
          title="Remove this charge"
          className="grid size-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-bg-danger hover:text-text-danger"
        >
          <Trash2 size={13} />
        </button>
      ),
    };
  }

  const s = summarise(lines);
  const cur = quoteCurrency || "INR";
  // Guarded: a zero or missing rate would divide the totals into infinity.
  const fx = Number(quoteFxRate) > 0 ? Number(quoteFxRate) : 1;
  /*
    Whether the rate of exchange is worth a column.

    It means nothing on a line priced in rupees — it is always 1 — so the
    column is there only while a charge is in another currency, and only that
    charge shows one. Derived from the lines, so switching a currency to USD
    brings it back on the spot. The quote's own currency counts too — a
    quotation presented in USD needs its rate visible even before a line uses
    one. The buy side's rate sits with the costs, on the charge whose cost is
    foreign.
  */
  const anyFx = quoteCurrency !== "INR" || lines.some((l) => l.currency !== "INR");

  /** Replies carrying a figure, which are the only ones worth offering. */
  const quoted = (partnerQuotes ?? []).filter(
    (p) => p.status === "quoted" && p.amount !== null && p.amount !== undefined
  );

  return (
    <div>
      {reviseOnEdit && (
        <p className="mb-2 rounded-lg bg-bg-accent px-3 py-2 text-[12px] text-text-accent">
          Sent to the customer. Change any charge below and it becomes <strong className="font-medium">{revisionName ?? "the next revision"}</strong>: a new
          draft with these charges, to send as the revised quotation. The version the customer has keeps its figures.
        </p>
      )}
      {error && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          Charges
        </h3>
        <div className="flex items-center gap-2">
        {lines.length > 0 && (
          <button
            type="button"
            onClick={toggleCosts}
            aria-pressed={showCosts}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] transition-colors ${
              showCosts ? "border-text-accent bg-bg-accent text-text-accent" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
            }`}
          >
            {showCosts ? <EyeOff size={13} /> : <Eye size={13} />}
            Costs &amp; details
          </button>
        )}
        {!locked && (
          <div ref={addRef} className="relative">
            {lane && (
              <button
                type="button"
                onClick={() => void fillFromRates()}
                disabled={filling}
                title={`Rates for ${laneLabel({ origin: lane.origin, destination: lane.destination })}`}
                className="mr-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
              >
                {filling ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                Fill using rate master
              </button>
            )}
            <button
              onClick={() => setAdding((a) => !a)}
              aria-expanded={adding}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <Plus size={13} />
              Add a charge
            </button>
            {adding && (
              <div className="absolute right-0 z-30 mt-1 w-80 rounded-lg border border-border-strong bg-surface-1 shadow-lg">
                <div className="border-b border-border p-1.5">
                  <input
                    autoFocus
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setAdding(false);
                      if (e.key === "Enter") {
                        const first = CHARGE_HEADS.find((h) => h.label.toLowerCase().includes(pick.trim().toLowerCase()));
                        void addCharge(first ? { description: first.label, sac_code: first.sac, unit: first.unit } : { description: pick.trim() });
                      }
                    }}
                    placeholder="Find a charge, or type a new one"
                    aria-label="Find a charge"
                    className="h-8 w-full text-[12.5px]"
                  />
                </div>
                {/* Tall enough for the whole list: a charge head is one of fifteen, not a search result. */}
                <ul className="max-h-[min(30rem,65vh)] overflow-y-auto py-1">
                {CHARGE_HEADS.filter((h) => h.label.toLowerCase().includes(pick.trim().toLowerCase())).map((h) => (
                  <li key={h.label}>
                    <button
                      onClick={() => void addCharge({ description: h.label, sac_code: h.sac, unit: h.unit })}
                      className="flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-surface-2"
                    >
                      <span className="text-text-primary">{h.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-text-muted">{h.sac}</span>
                    </button>
                  </li>
                ))}
                  <li className="border-t border-border">
                    <button
                      onClick={() => void addCharge({ description: pick.trim() })}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text-accent hover:bg-surface-2"
                    >
                      <Plus size={12} /> {pick.trim() ? `Add "${pick.trim()}"` : "Another charge — name it in the grid"}
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {filled && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-border-strong px-3 py-2 text-[12px] text-text-secondary">
          <Wand2 size={13} className="mt-px shrink-0" />
          <div className="min-w-0 flex-1">
            {filled.used.length ? (
              <p>
                Added from the rate master:{" "}
                <strong className="text-text-primary">
                  {filled.used.map((r) => r.charge_head).join(", ")}
                </strong>
                . Quantities are placeholders &mdash; set them against the cargo.
              </p>
            ) : (
              <p>
                The rate master had nothing to add for this lane
                {filled.skipped.length ? " that is not already on the quotation" : ""}.
              </p>
            )}
            {filled.skipped.length > 0 && (
              <p className="mt-0.5 text-[11px] text-text-muted">
                Left alone, already on the quotation: {filled.skipped.join(", ")}.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFilled(null)}
            className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-primary"
            aria-label="Dismiss"
          >
            <Trash2 size={12} className="opacity-0" />
            <span aria-hidden>&times;</span>
          </button>
        </div>
      )}

      <div ref={gridRef}>
      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-text-muted">
          No charges yet. Add the heads this rate is made of — they become the invoice when the
          customer accepts.
        </p>
      ) : (
        (() => {
          /*
            One row per charge, read like the line on the quotation: the charge,
            its rate, what it is per and how many, and what that comes to in
            rupees. The rate of exchange and the GST take a column only when a
            charge needs one. What it costs us — the code, the minimum, the buy
            side and the vendor — sits on a line under it, shown on request
            ("Costs & details"), so the sell side reads on its own.

            On a pasted quotation the charges sit under their groups, as the
            customer reads them.
          */
          const cols = [
            "minmax(150px,2.6fr)",
            "76px",
            "minmax(76px,1fr)",
            "minmax(96px,1.1fr)",
            "minmax(60px,0.7fr)",
            anyFx ? "minmax(70px,0.8fr)" : "",
            withGst ? "84px" : "",
            "minmax(100px,1.1fr)",
            locked ? "" : "28px",
          ].filter(Boolean);
          const head = ["Charge", "Cur.", "Rate", "Per", "Qty", ...(anyFx ? ["ROE"] : []), ...(withGst ? ["GST"] : []), "Amount ₹", ...(locked ? [] : [""])];
          const right = new Set(["Rate", "Qty", "ROE", "Amount ₹"]);
          // Each column's least width and the gaps between them: below that, a card per charge.
          const least = cols.reduce((n, c) => n + Number(c.match(/(\d+)px/)?.[1] ?? 0), 0) + 8 * (cols.length - 1) + 16;
          const asRows = width >= least;

          const details = (l: QuoteLine, c: ReturnType<typeof cells>) =>
            showCosts && (
              <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded-md bg-surface-2 px-2 py-1.5">
                {anySection && <Mini label="Group" className="w-36">{c.group}</Mini>}
                <Mini label="Code" className="w-24">{c.code}</Mini>
                <Mini label="Min amt." className="w-24">{c.min}</Mini>
                <Mini label="Cost cur." className="w-24">{c.costCurrency}</Mini>
                {l.cost_currency !== "INR" && <Mini label="Cost ROE" className="w-20">{c.costRoe}</Mini>}
                <Mini label="Cost / unit" className="w-28">{c.costRate}</Mini>
                <Mini label="Cost ₹" className="w-28">{c.costAmount}</Mini>
                <Mini label="Vendor" className="min-w-[10rem] flex-1">{c.vendor}</Mini>
              </div>
            );

          const row = (l: QuoteLine) => {
            const c = cells(l);
            const foreign = l.currency !== "INR";
            if (!asRows) {
              return (
                <div key={l.id} data-line={l.id} className="border-b border-border py-2.5 last:border-b-0">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="min-w-0 flex-1">{c.name}</div>
                    {c.remove}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Mini label="Cur.">{c.currency}</Mini>
                    <Mini label="Rate">{c.rate}</Mini>
                    <Mini label="Per">{c.unit}</Mini>
                    <Mini label="Qty">{c.units}</Mini>
                    {foreign && <Mini label="ROE">{c.roe}</Mini>}
                    {withGst && <Mini label="GST">{c.gst}</Mini>}
                    <Mini label="Amount ₹">{c.amount}</Mini>
                  </div>
                  {details(l, c)}
                </div>
              );
            }
            return (
              <div key={l.id} data-line={l.id} className="border-b border-border px-1 py-1.5 last:border-b-0">
                <div className="grid items-center gap-2" style={{ gridTemplateColumns: cols.join(" ") }}>
                  {c.name}
                  {c.currency}
                  {c.rate}
                  {c.unit}
                  {c.units}
                  {/* A rupee charge has no rate of exchange to show. */}
                  {anyFx && (foreign ? c.roe : <span />)}
                  {withGst && c.gst}
                  {c.amount}
                  {!locked && c.remove}
                </div>
                {details(l, c)}
              </div>
            );
          };

          const groups = anySection
            ? SECTIONS.map((g) => ({ title: g.title, lines: lines.filter((l) => asSection(l.section) === g.key) })).filter((g) => g.lines.length)
            : [{ title: null as string | null, lines }];

          return (
            <div>
              {asRows && (
                <div className="grid gap-2 px-1 pb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-text-muted" style={{ gridTemplateColumns: cols.join(" ") }}>
                  {head.map((h, k) => (
                    <span key={k} className={`truncate ${right.has(h) ? "text-right" : ""}`}>
                      {h}
                    </span>
                  ))}
                </div>
              )}
              {groups.map((g) => (
                <div key={g.title ?? "all"} className={g.title ? "mt-2 first:mt-0" : ""}>
                  {g.title && (
                    <div className="flex items-baseline justify-between border-b border-border-strong px-1 pb-1 pt-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-primary">{g.title}</span>
                      <span className="text-[11.5px] tabular-nums text-text-muted">{money(g.lines.reduce((n, l) => n + Number(l.amount_inr || 0), 0))}</span>
                    </div>
                  )}
                  {g.lines.map(row)}
                </div>
              ))}
            </div>
          );
        })()
      )}
      </div>

      {lines.length > 0 && (
        <div className="mt-3 flex justify-end">
          {/*
            Billing, cost, profit — in the currency the customer is quoted in
            and in rupees beside it.

            Both, because they answer different questions. The quote currency is
            what goes on the document and what the customer will argue about;
            the rupee figure is what the desk is actually paid and what the
            margin means anything in. Showing one and making somebody multiply
            is how a quotation goes out at a margin nobody checked.
          */}
          <dl className="w-full max-w-md text-[12.5px] sm:w-[26rem]">
            <Total label="Billing" quote={s.sell / fx} inr={s.sell} cur={cur} strong />
            {s.costed > 0 && (
              <>
                <Total label="Cost" quote={s.cost / fx} inr={s.cost} cur={cur} />
                <div className="mt-1 border-t border-border pt-1">
                  <Total
                    label="Profit"
                    quote={s.margin / fx}
                    inr={s.margin}
                    cur={cur}
                    strong
                    danger={s.margin < 0}
                  />
                  {s.pct !== null && (
                    <div className="flex items-baseline justify-between gap-4 py-0.5">
                      <dt className="text-text-secondary">Profit %</dt>
                      <dd
                        className={`tabular-nums ${
                          s.margin < 0 ? "text-text-danger" : "text-text-primary"
                        }`}
                      >
                        {s.pct}%
                      </dd>
                    </div>
                  )}
                </div>
                {s.uncosted > 0 && (
                  <p className="pt-1.5 text-[11px] leading-relaxed text-text-muted">
                    {s.uncosted} charge{s.uncosted === 1 ? " has" : "s have"} no cost against{" "}
                    {s.uncosted === 1 ? "it" : "them"}, so the profit is the best case.
                  </p>
                )}
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

/** One labelled field: a charge on a phone, and the costs and details under a charge. */
function Mini({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-[10.5px] uppercase tracking-wide text-text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * One line of the totals, in the quote currency and in rupees.
 *
 * The rupee column is suppressed when the quotation is already in rupees —
 * printing the same figure twice reads as two facts.
 */
function Total({
  label,
  quote,
  inr,
  cur,
  strong,
  danger,
}: {
  label: string;
  quote: number;
  inr: number;
  cur: string;
  strong?: boolean;
  danger?: boolean;
}) {
  const tone = danger ? "text-text-danger" : strong ? "text-text-primary" : "text-text-secondary";
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className={strong ? "font-medium text-text-primary" : "text-text-secondary"}>{label}</dt>
      <dd className="flex items-baseline gap-4 tabular-nums">
        {cur !== "INR" && (
          <span className={`w-28 text-right ${tone}`}>
            <span className="mr-1 text-[10.5px] text-text-muted">{cur}</span>
            {quote.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </span>
        )}
        <span className={`w-28 text-right ${tone} ${strong ? "font-medium" : ""}`}>
          <span className="mr-1 text-[10.5px] text-text-muted">INR</span>
          {inr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
        </span>
      </dd>
    </div>
  );
}
