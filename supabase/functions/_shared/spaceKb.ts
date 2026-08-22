/**
 * Container space as a knowledge-base document.
 *
 * Webhook tool results were verified not to reach the model on the Gemini Live voice
 * stack, so availability has to arrive the way everything else the agent actually knows
 * does — through retrieval.
 *
 * The hard part is that a text document cannot run the fit engine. A caller asking "will
 * my 2.6m crate fit?" needs a three-dimensional answer, and an agent reading raw CBM
 * figures would get it wrong in exactly the way volume math always does. So the numbers
 * the agent would otherwise have to derive are computed here, against the live engine,
 * and written out as plain facts: the largest piece each sailing can still take, and how
 * many of a few common carton sizes actually fit.
 */
import { listSlots, remainingFor, checkFit, type SlotRow } from "./space.ts";

/** Sizes chosen to span what customers actually ship, not to be exhaustive. */
const COMMON_PIECES = [
  { label: "standard carton 60×40×40cm", l: 60, w: 40, h: 40 },
  { label: "large carton 120×100×110cm", l: 120, w: 100, h: 110 },
  { label: "euro pallet 120×80×150cm", l: 120, w: 80, h: 150 },
  { label: "tall crate 120×100×200cm", l: 120, w: 100, h: 200 },
];

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

async function slotSection(slot: SlotRow): Promise<string> {
  const rem = await remainingFor(slot);
  if (!rem) return "";

  const L: string[] = [];
  L.push(`### Sailing ${slot.sailing_date} (${fmtDate(slot.sailing_date)}) — ${slot.container_code}, ${slot.carrier}`);
  L.push(`- Booking must be confirmed by: ${slot.cutoff_date} (${fmtDate(slot.cutoff_date)})`);
  L.push(`- Status: ${slot.status.replace("_", " ")}`);

  if (slot.status === "full" || rem.lengthM <= 0.05) {
    L.push(`- FULL. No space left on this sailing. Offer the next one on this route instead.`);
    return L.join("\n");
  }

  L.push(`- Space left: ${rem.lengthM}m of container floor (about ${rem.cbm} CBM)`);
  L.push(`- Weight left: ${Math.round(rem.payloadKg).toLocaleString("en-IN")} kg`);

  // The single most useful derived fact: what a caller's largest piece can measure and
  // still go on this sailing. Stops the agent reasoning from CBM, which ignores height.
  L.push(
    `- Largest single piece that still fits: ${Math.floor(rem.lengthM * 100)}cm long × ` +
      `${Math.floor(rem.dims.internalWidthM * 100)}cm wide × ${Math.floor(rem.dims.internalHeightM * 100)}cm high ` +
      `(a piece taller than ${Math.floor(rem.dims.internalHeightM * 100)}cm cannot go on this sailing at all unless it can be laid on its side)`
  );

  const fits: string[] = [];
  for (const p of COMMON_PIECES) {
    // Ask the real engine how many fit, rather than dividing volumes.
    let lo = 0;
    let hi = 2000;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi + 1) / 2);
      const r = checkFit(rem.dims, { lengthM: rem.lengthM, payloadKg: rem.payloadKg }, {
        lengthCm: p.l, widthCm: p.w, heightCm: p.h, quantity: mid, weightKgEach: 0,
      });
      if (r.fits) lo = mid;
      else hi = mid - 1;
    }
    if (lo > 0) fits.push(`${lo} × ${p.label}`);
    else fits.push(`0 × ${p.label} (does not fit)`);
  }
  L.push(`- Roughly fits: ${fits.join("; ")}`);

  if (rem.placements.length) {
    L.push(`- Already carrying ${rem.placements.length} consignment${rem.placements.length === 1 ? "" : "s"} from other customers (LCL groupage)`);
  }
  return L.join("\n");
}

export async function buildSpaceKb(): Promise<string> {
  const slots = await listSlots();

  const byRoute = new Map<string, SlotRow[]>();
  for (const s of slots) byRoute.set(s.route, [...(byRoute.get(s.route) ?? []), s]);

  const out: string[] = [];
  out.push("# Container space availability — live");
  out.push("");
  out.push(
    `Current as of ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. These are the sailings we have ` +
      `space on right now. Use this to answer any question about availability, dates, or whether a customer's cargo fits.`
  );
  out.push("");
  out.push("## How to answer an availability question");
  out.push(
    "1. Find the customer's route below. If we do not sail that route, say so plainly and offer to check with the desk — do not improvise a sailing."
  );
  out.push(
    "2. If they name a date, look for a sailing on that exact date. If there is none, offer the nearest sailing AFTER it and say clearly that the exact date is not available."
  );
  out.push(
    "3. If they give a date range or say something vague like 'next week' or 'end of the month', list the sailings that fall in that window and let them choose."
  );
  out.push(
    "4. If they tell you their cargo dimensions, compare against 'Largest single piece that still fits'. HEIGHT is the one that catches people out — a piece taller than the container's internal height cannot go, no matter how small its volume is."
  );
  out.push(
    "5. Always give the booking cutoff date, not just the sailing date. Customers miss cutoffs because nobody mentioned them."
  );
  out.push(
    "6. If the cargo is close to the limits, or they need more than the 'roughly fits' figures suggest, say you will confirm the exact loading with the desk and call back. Do not compute a tight fit in your head — being wrong here means cargo turned away at the port."
  );
  out.push(
    "7. Never quote space on a sailing marked FULL, and never invent a sailing date that is not listed here."
  );
  out.push("");

  for (const [route, list] of [...byRoute.entries()].sort()) {
    out.push(`## ${route}`);
    out.push("");
    const sorted = [...list].sort((a, b) => a.sailing_date.localeCompare(b.sailing_date));
    for (const s of sorted) {
      const section = await slotSection(s);
      if (section) {
        out.push(section);
        out.push("");
      }
    }
  }

  const open = slots.filter((s) => s.status !== "full").length;
  out.push(`---`);
  out.push(`${open} of ${slots.length} sailings currently have space.`);
  return out.join("\n");
}
