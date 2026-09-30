/**
 * Dates on a job that cannot all be true (30 Sep).
 *
 * ARX-SHP-0006 was booked on a sailing of 30 Sep with the cargo ready on
 * 1 Oct: it cannot make that vessel, and nothing said so — its pickup step was
 * due the day after the ship left. These are the clashes a desk would catch
 * reading the job by eye, said on the job so nobody has to.
 *
 * Before departure only, for the cargo-side ones: once it has sailed, when the
 * cargo was ready no longer decides anything.
 */

export interface JobDates {
  ready: string | null;
  cutoff: string | null;
  siCutoff: string | null;
  etd: string | null;
  eta: string | null;
  /** The job's stage; the cargo-side clashes stop mattering once it has left. */
  stage?: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : iso;
};
const d10 = (v: string | null) => (v ? v.slice(0, 10) : null);
const LEFT = new Set(["sailed", "arrived", "delivered", "cancelled"]);

export function dateClashes(input: JobDates): string[] {
  const ready = d10(input.ready);
  const cutoff = d10(input.cutoff);
  const si = d10(input.siCutoff);
  const etd = d10(input.etd);
  const eta = d10(input.eta);
  const out: string[] = [];
  if (etd && eta && eta < etd) out.push(`The ETA (${day(eta)}) is before the ETD (${day(etd)}).`);
  if (input.stage && LEFT.has(input.stage)) return out;
  if (ready && etd && ready > etd) out.push(`The cargo is ready on ${day(ready)}, after the ETD (${day(etd)}): it cannot make this departure.`);
  else if (ready && cutoff && ready > cutoff) out.push(`The cargo is ready on ${day(ready)}, after the cargo cut-off (${day(cutoff)}).`);
  if (cutoff && etd && cutoff > etd) out.push(`The cargo cut-off (${day(cutoff)}) is after the ETD (${day(etd)}).`);
  if (si && etd && si > etd) out.push(`The SI cut-off (${day(si)}) is after the ETD (${day(etd)}).`);
  return out;
}
