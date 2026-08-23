import { useEffect, useMemo, useState } from "react";
import { Box, AlertTriangle } from "lucide-react";
import ContainerScene from "./ContainerScene";
import { findStow, BASIS_LABEL, type StowMatch, type StowQuery } from "../lib/findStow";

/**
 * The container this shipment is travelling in, with its own block lit up.
 *
 * Read-only on purpose. The same scene is editable on the Space & containers page,
 * where rearranging a stow is the job; here it is a customer's shipment, and letting
 * someone drag their cargo down the container from a detail page would silently
 * restow a real sailing.
 *
 * It opens rotating so all four sides are visible without anyone needing to discover
 * that the scene can be dragged, and the existing Pause control stops it.
 */
export default function StowPanel({ query, title = "In the container" }: { query: StowQuery; title?: string }) {
  const [match, setMatch] = useState<StowMatch | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  const key = JSON.stringify(query);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Only the first load blanks the panel. A refresh after a restow swaps the plan
    // underneath, which is far less jarring than the container vanishing and reappearing.
    setState((s) => (s === "ready" ? s : "loading"));
    findStow(query)
      .then((m) => {
        if (cancelled) return;
        setMatch(m);
        setState(m ? "ready" : "empty");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  /**
   * Re-read the plan when this page comes back into view.
   *
   * A stow is rearranged on Space & containers, not here, and that write is already
   * persisted server-side — but this page fetched its copy on mount and would otherwise
   * keep showing the old arrangement until a reload. Refetching on focus means going and
   * restowing a container, then coming back to the shipment, shows the new layout.
   */
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNonce((n) => n + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // The scene owns dragging; positions here are simply where the cargo actually sits.
  const positions = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of match?.plan.consignments ?? []) out[c.id] = c.xM;
    return out;
  }, [match]);

  if (state === "loading") {
    return (
      <Section title={title}>
        <p className="text-[13px] text-text-muted py-6">Locating the container…</p>
      </Section>
    );
  }

  if (state === "error") {
    return (
      <Section title={title}>
        <p className="text-[13px] text-text-muted py-6">
          Could not reach the space engine. The load plan is unavailable right now.
        </p>
      </Section>
    );
  }

  if (state === "empty" || !match) {
    return (
      <Section title={title}>
        <p className="text-[13px] text-text-muted py-6">
          This shipment is not loaded into a container yet — no sailing on this route has
          space booked against it.
        </p>
      </Section>
    );
  }

  const { plan, consignmentId, basis } = match;
  const mine = plan.consignments.find((c) => c.id === consignmentId);
  const uncertain = basis !== "reference";

  return (
    <Section title={title}>
      <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-text-secondary">
        <span className="font-mono text-text-primary">{plan.container.code}</span>
        <span>{plan.slot.route}</span>
        <span>Sailing {plan.slot.sailingDate}</span>
        <span>Cut-off {plan.slot.cutoffDate}</span>
        <span>
          {plan.used.lengthM.toFixed(1)}m of {plan.container.lengthM.toFixed(1)}m floor used
        </span>
      </div>

      {mine ? (
        <p className="mb-2 text-[13px] text-text-primary">
          <Box size={12} className="inline mr-1 -mt-0.5 text-text-accent" />
          Highlighted: <span className="font-medium">{mine.clientName}</span> — {mine.quantity} pieces,{" "}
          {mine.lengthM.toFixed(1)}m of floor at {mine.xM.toFixed(1)}m from the door,{" "}
          {mine.piecesAcross} across × {mine.piecesHigh} high.
        </p>
      ) : (
        <p className="mb-2 text-[13px] text-text-muted">
          Nothing in this container is matched to this shipment yet.
        </p>
      )}

      {uncertain && (
        <p className="mb-2 flex items-start gap-1.5 text-[11px] text-text-warning">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          {BASIS_LABEL[basis]}
        </p>
      )}

      <ContainerScene
        plan={plan}
        positions={positions}
        onMove={() => {}}
        onRestow={() => {}}
        dragMode="nudge"
        selectedId={consignmentId}
        onSelect={() => {}}
        explode={0}
        editable={false}
        autoSpin
      />

      <p className="mt-2 text-[11px] text-text-muted">
        Rotating automatically — press pause in the scene to hold an angle, or drag to look
        around. Read-only here; rearranging a stow is done on Space &amp; containers.
      </p>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-secondary mb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}
