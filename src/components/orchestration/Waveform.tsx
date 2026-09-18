import { useMemo } from "react";

/**
 * Voice-activity bars for a call in progress.
 *
 * ---------------------------------------------------------------------------
 * THESE BARS ARE NOT THE CALLER'S VOICE.
 *
 * SnapServe holds the audio and never hands it to us — there is no stream here to
 * analyse. The motion is generated, and it is honest to say so rather than let a viewer
 * believe they are watching someone speak. What it does convey truthfully is "a call is
 * open right now", which is the only claim the UI makes.
 *
 * Ported from the SnapServe claims dashboard, where it did the same job. That version
 * used framer-motion; this one is CSS keyframes, because v1 has no animation library and
 * adding one for thirty-four rectangles would be a poor trade.
 * ---------------------------------------------------------------------------
 */
export default function Waveform({
  bars = 34,
  active = true,
  height = 44,
  className = "",
}: {
  bars?: number;
  active?: boolean;
  height?: number;
  className?: string;
}) {
  /**
   * A fixed pseudo-random profile rather than `Math.random()`, so the shape is stable
   * across re-renders. Bars that reshuffle on every state change read as a glitch.
   */
  const seeds = useMemo(
    () => Array.from({ length: bars }, (_, i) => 0.28 + Math.abs(Math.sin(i * 1.7) * 0.62)),
    [bars],
  );

  return (
    <div
      className={`flex items-end gap-[3px] ${className}`}
      style={{ height }}
      role="img"
      aria-label={active ? "Call in progress" : "Call ended"}
    >
      {seeds.map((s, i) => {
        const base = height * (active ? s : 0.1);
        return (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full"
            style={{
              height: base,
              background: active ? "var(--wf-active, #1D9E75)" : "#D4D8DE",
              opacity: active ? 0.35 + s * 0.55 : 0.55,
              // Each bar runs the same keyframes at a different speed and offset, which is
              // what stops thirty-four bars pulsing in unison like a progress bar.
              animation: active
                ? `wf-pulse ${(1.05 + (i % 5) * 0.16).toFixed(2)}s ease-in-out ${((i % 7) * 0.05).toFixed(2)}s infinite alternate`
                : "none",
            }}
          />
        );
      })}

      <style>{`
        @keyframes wf-pulse {
          0%   { transform: scaleY(0.35); }
          50%  { transform: scaleY(1); }
          100% { transform: scaleY(0.55); }
        }
        /* Someone who has asked for less motion should not be given a dancing chart. The
           bars still render at their resting height, so the card does not collapse. */
        @media (prefers-reduced-motion: reduce) {
          [role="img"] > span { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
