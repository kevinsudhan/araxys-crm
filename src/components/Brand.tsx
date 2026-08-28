/**
 * Brand lockups.
 *
 * Aashish Logistics Global is the company and owns the primary mark. Araxys is
 * the platform underneath, credited quietly — a corner byline, never competing
 * with the customer's own name.
 *
 * The ARAXYS wordmark is set in type rather than shipped as an image: the mark
 * is a thin, wide-tracked geometric uppercase, which CSS reproduces faithfully
 * at the size it is used here, stays sharp on any display, and costs no request.
 * To use the original asset instead, drop it at `public/araxys-wordmark.svg`
 * and swap the <span> in AraxysWordmark for an <img> — nothing else changes.
 */

export function AraxysWordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-sans uppercase leading-none ${className}`}
      style={{ fontWeight: 300, letterSpacing: "0.16em" }}
    >
      Araxys
    </span>
  );
}

/** The byline. `tone` picks legible colours for light panels or dark imagery. */
export function PoweredByAraxys({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  const muted = tone === "dark" ? "text-white/40" : "text-text-muted";
  const mark = tone === "dark" ? "text-white/70" : "text-text-secondary";

  return (
    <span className={`inline-flex items-baseline gap-1.5 text-[10px] ${muted} ${className}`}>
      Powered by
      <AraxysWordmark className={`text-[11px] ${mark}`} />
    </span>
  );
}

/**
 * The company lockup: monogram plus name.
 *
 * `stacked` puts the descriptor under the name for the sidebar; inline keeps it
 * on one line for headers where vertical space is tight.
 */
export function CompanyBrand({
  size = "md",
  descriptor,
  tone = "light",
}: {
  size?: "sm" | "md" | "lg";
  descriptor?: string;
  tone?: "light" | "dark";
}) {
  const box = size === "lg" ? "w-9 h-9" : size === "sm" ? "w-7 h-7" : "w-8 h-8";
  const name = size === "lg" ? "text-[16px]" : size === "sm" ? "text-[13px]" : "text-[14px]";
  const nameColor = tone === "dark" ? "text-white" : "text-text-primary";
  const descColor = tone === "dark" ? "text-white/50" : "text-text-muted";
  const markBg = tone === "dark" ? "bg-white/15 backdrop-blur text-white" : "bg-brand text-white";

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${box} ${markBg} rounded-lg flex items-center justify-center shrink-0`}
        aria-hidden="true"
      >
        <GlobeMark />
      </div>
      <div className="min-w-0">
        <p className={`${name} ${nameColor} font-semibold tracking-tight leading-tight truncate`}>
          Aashish Logistics Global
        </p>
        {descriptor && <p className={`text-[11px] ${descColor} leading-tight`}>{descriptor}</p>}
      </div>
    </div>
  );
}

/** Globe and forwarding arrow — the company's mark, drawn rather than raster. */
function GlobeMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-[62%] h-[62%]" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.9 9.2h16.2M3.9 14.8h16.2" stroke="currentColor" strokeWidth="1.3" />
      {/* The arrow reads as movement through the network, not just a globe. */}
      <path
        d="M7.5 15.5 16 7"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M11.4 6.6H16.4V11.6"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
