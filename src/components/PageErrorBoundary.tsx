import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * A page that fails to draw, kept to that page (7 Oct).
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * The app had no error boundary anywhere. One value a component did not
 * expect — a charge line without a rate, found by the end-to-end check —
 * threw while drawing, and React took the whole tree down with it: the
 * sidebar, the top bar, every page, a blank window until a reload. Now the
 * page says it could not be shown and offers to try again; the rest of the
 * app stays usable, so the desk can go on to the next job.
 *
 * Keyed by the address in layout/AppLayout, so going to another page starts
 * clean. The error is still logged for whoever looks at the console.
 * ---------------------------------------------------------------------------
 */
export default class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("This page could not be drawn:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-10 max-w-md rounded-card border border-border bg-surface-1 p-6 text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-xl bg-bg-warning text-text-warning">
          <AlertTriangle size={18} />
        </span>
        <h2 className="mt-3 text-[15px] font-semibold text-text-primary">This page could not be shown</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
          Something on it was not as the page expected. The rest of the CRM still works — try again, or go on to another page.
        </p>
        <p className="mt-2 break-words font-mono text-[11px] text-text-muted">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2"
        >
          <RotateCcw size={14} />
          Try again
        </button>
      </div>
    );
  }
}
