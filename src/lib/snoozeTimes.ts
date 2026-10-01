/**
 * The times Outlook offers for Snooze, worked out from now in local time:
 * later today (three hours on, on the hour), tomorrow morning, the weekend
 * (Monday to Friday only) and next week — each at 8 in the morning.
 */
import { formatDate } from "./dates";

export interface SnoozeChoice {
  key: "later" | "tomorrow" | "weekend" | "nextWeek";
  label: string;
  at: Date;
}

const MORNING = 8;

function at(d: Date, day: number, hour: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + day);
  x.setHours(hour, 0, 0, 0);
  return x;
}

export function snoozeChoices(now: Date): SnoozeChoice[] {
  const out: SnoozeChoice[] = [];
  const later = new Date(now);
  later.setHours(later.getHours() + 3, 0, 0, 0);
  if (later.getDate() === now.getDate() && later.getHours() <= 21) out.push({ key: "later", label: "Later today", at: later });
  out.push({ key: "tomorrow", label: "Tomorrow", at: at(now, 1, MORNING) });
  const dow = now.getDay(); // 0 Sunday … 6 Saturday
  if (dow >= 1 && dow <= 5) out.push({ key: "weekend", label: "This weekend", at: at(now, 6 - dow, MORNING) });
  out.push({ key: "nextWeek", label: "Next week", at: at(now, ((8 - dow) % 7) || 7, MORNING) });
  return out;
}

/** "Tue 8:00 am", or "Today 5:00 pm" / "Tomorrow 8:00 am" when it is. Names from lib/dates, never the locale ("Sept"). */
export function snoozeLabel(when: Date, now = new Date()): string {
  const time = formatDate(when, { hour: "numeric", minute: "2-digit", hour12: true });
  const days = Math.round((at(when, 0, 0).getTime() - at(now, 0, 0).getTime()) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) return `${formatDate(when, { weekday: "short" })} ${time}`;
  return `${formatDate(when, { day: "numeric", month: "short" })} ${time}`;
}
