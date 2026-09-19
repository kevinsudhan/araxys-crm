import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A scripted run of the orchestration page, for recording.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A REPLAY, NOT A LIVE RUN.
 *
 * Every number it shows comes from the enquiry already on screen — the real fields, the
 * real stow, the real quote. What the script supplies is only the TIMING: it decides
 * when each stage begins and when it is finished, so the page performs the sequence at a
 * pace a camera can follow instead of resolving in whatever order the API answers in.
 *
 * It exists because the honest version is unwatchable. The real pipeline finishes most
 * of its work before the page has finished mounting, so a recording of it is a static
 * screenshot with a spinner somewhere. Nothing here invents a fact; it paces facts that
 * are already true.
 * ---------------------------------------------------------------------------
 *
 * The stage gate is the point. A circle only goes green when its stage is FINISHED —
 * not when it starts, and not on a timer that runs underneath it. `reached` is the index
 * of the stage in hand; everything below it is done, everything above is waiting.
 */

/** Seconds between the play button being pressed and the first frame of the script. */
export const LEAD_IN_SECONDS = 5;

/**
 * The running order, in seconds from the start of the script.
 *
 * Each entry is the moment that stage BEGINS. A stage is finished when the next one
 * starts, which is what keeps the circles and the captions from disagreeing.
 */
const CUES = {
  call: 0,
  intake: 6.5,
  space: 15.5,
  partners: 25,
  rates: 29,
  pricing: 33.5,
  approval: 38.5,
  approved: 44.5,
  docs: 44.5,
  done: 50,
} as const;

export const SCRIPT_SECONDS = CUES.done;

/** Ease-in-out, so the box arrives and leaves a position rather than jumping. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Progress through a window, clamped to 0..1. */
function span(t: number, from: number, to: number): number {
  if (t <= from) return 0;
  if (t >= to) return 1;
  return (t - from) / (to - from);
}

/**
 * Where the consignment sits at time t while the stow is being worked out.
 *
 * The agent does not find the right slot first time, and showing it land perfectly is
 * the one thing that makes the whole page look pre-baked. So it searches: down the
 * container, back, past the answer, short of it, then settles. The waypoints are
 * expressed against the real frontier and the real container length, so a different
 * sailing gives a different search.
 */
function searchX(t: number, finalX: number, containerLength: number): number {
  const leg = (from: number, to: number, a: number, b: number) =>
    from + (to - from) * ease(span(t, a, b));

  const far = Math.min(containerLength * 0.62, finalX + 4.5);
  const near = Math.max(0.2, finalX - 2.6);

  if (t < 17.5) return leg(0.3, far, CUES.space, 17.5);
  if (t < 19.5) return leg(far, near, 17.5, 19.5);
  if (t < 21.5) return leg(near, finalX + 1.1, 19.5, 21.5);
  if (t < 23) return leg(finalX + 1.1, finalX - 0.5, 21.5, 23);
  return leg(finalX - 0.5, finalX, 23, CUES.space + 8.5);
}

export interface DemoRun {
  /** The button is on screen and has not been pressed. */
  idle: boolean;
  /** Pressed, counting down the lead-in. Nothing on screen has changed yet. */
  armed: boolean;
  /** The script is driving the page (still true once it has finished, so it holds its end state). */
  active: boolean;
  /** Seconds since the first frame. */
  t: number;
  /** The stage in hand. Everything below it is finished. */
  reached: number;
  /** True while the call is meant to be open. */
  callLive: boolean;
  /** Seconds to show on the call card. */
  callElapsed: number;
  /** 0..1 through the intake reveal. */
  intake: number;
  /** 0..1 through the stow. */
  stow: number;
  /** Metres along the container, or null when the script is not driving the box. */
  boxX: (finalX: number, containerLength: number) => number | null;
  /** True once the desk has "approved", so step 7 can finish. */
  approved: boolean;
  start: () => void;
  reset: () => void;
}

/**
 * Drives the page from a clock rather than from the API.
 *
 * requestAnimationFrame rather than an interval: the box is moving continuously and a
 * 60ms interval shows as a stutter on a 60fps capture, which is exactly what this is
 * for.
 */
export function useDemoScript(): DemoRun {
  const [phase, setPhase] = useState<"idle" | "armed" | "running">("idle");
  const [t, setT] = useState(0);
  const startedAt = useRef(0);
  const frame = useRef(0);

  const start = useCallback(() => {
    setPhase("armed");
    window.setTimeout(() => {
      startedAt.current = performance.now();
      setT(0);
      setPhase("running");
    }, LEAD_IN_SECONDS * 1000);
  }, []);

  const reset = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setPhase("idle");
    setT(0);
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const tick = () => {
      const secs = (performance.now() - startedAt.current) / 1000;
      // Stops at the end rather than running on: the page should hold its finished state
      // for as long as the camera is still on it.
      setT(Math.min(secs, SCRIPT_SECONDS));
      if (secs < SCRIPT_SECONDS) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [phase]);

  const active = phase === "running";

  const reached = !active
    ? 0
    : t < CUES.intake ? 0
    : t < CUES.space ? 1
    : t < CUES.partners ? 2
    : t < CUES.rates ? 3
    : t < CUES.pricing ? 4
    : t < CUES.approval ? 5
    : t < CUES.approved ? 6
    : t < CUES.done ? 7
    : 8;

  return {
    idle: phase === "idle",
    armed: phase === "armed",
    active,
    t,
    reached,
    callLive: active && t < CUES.intake,
    callElapsed: Math.floor(Math.min(t, CUES.intake)),
    intake: span(t, CUES.intake, CUES.space - 0.5),
    stow: span(t, CUES.space, CUES.partners - 0.5),
    approved: t >= CUES.approved,
    boxX: (finalX: number, containerLength: number) => {
      if (!active) return null;
      if (t < CUES.space) return 0.3;
      if (t >= CUES.partners) return finalX;
      return searchX(t, finalX, containerLength);
    },
    start,
    reset,
  };
}
