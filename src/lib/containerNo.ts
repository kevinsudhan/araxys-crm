/**
 * Container numbers, sizes and the codes that follow from them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN services/shipmentContainers.ts
 *
 * Because that module builds the Supabase client at import time, which needs
 * Vite's `import.meta.env` and therefore cannot be loaded by a test running
 * under plain Node. This is the same split that put `applyPlan.ts` next to
 * `intake.ts`: the logic worth testing goes where a test can reach it.
 *
 * Everything here is a pure function of its arguments. No network, no clock,
 * no environment.
 * ---------------------------------------------------------------------------
 */

/**
 * The sizes this desk books, with the ISO 6346 size-type code for each.
 *
 * The code is derived rather than asked for. It is a pure function of the size
 * and type — a forty-foot high cube is 45G1 on every container in the world —
 * so asking an operator to type it is asking them to look up a constant, and a
 * blank `ISO Code*` box is how one arrives as 2210 and the next as 22G1 for the
 * same kind of box.
 */
export const SIZE_TYPES: { value: string; iso: string; label: string }[] = [
  { value: "20' GP", iso: "22G1", label: "20ft general purpose" },
  { value: "40' GP", iso: "42G1", label: "40ft general purpose" },
  { value: "40' HC", iso: "45G1", label: "40ft high cube" },
  { value: "45' HC", iso: "L5G1", label: "45ft high cube" },
  { value: "20' RF", iso: "22R1", label: "20ft reefer" },
  { value: "40' RF", iso: "45R1", label: "40ft reefer" },
  { value: "20' OT", iso: "22U1", label: "20ft open top" },
  { value: "40' OT", iso: "42U1", label: "40ft open top" },
  { value: "20' FR", iso: "22P1", label: "20ft flat rack" },
  { value: "40' FR", iso: "42P1", label: "40ft flat rack" },
  { value: "20' TK", iso: "22T1", label: "20ft tank" },
];

/** Empty rather than a guess when the size is one this list does not carry. */
export const isoFor = (sizeType: string) =>
  SIZE_TYPES.find((s) => s.value === sizeType)?.iso ?? "";

/** Who put the seal on. What the seal itself is called varies by carrier. */
export const SEAL_TYPES = ["Carrier seal", "Shipper seal", "Customs seal", "Bottle seal"];

export const PACKAGE_TYPES = [
  "Packages",
  "Cartons",
  "Pallets",
  "Bags",
  "Drums",
  "Bales",
  "Crates",
  "Rolls",
  "Loose",
];

export type ContainerNoCheck = "ok" | "malformed" | "bad-check-digit";

/**
 * ISO 6346 container numbers are four letters then seven digits, the last of
 * which is a check digit over the other ten.
 *
 * Returned as a warning, never as a refusal. A number that arrives from a
 * carrier mistyped is still the number printed on the paperwork the consignee
 * is holding, and a form that will not save it leaves the desk with nowhere to
 * record what is actually true. So it says "this does not check out" and the
 * caller saves it anyway.
 */
export function checkContainerNo(raw: string): ContainerNoCheck {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{4}\d{7}$/.test(s)) return "malformed";

  // Letters map to 10-38 with every multiple of 11 skipped: A is 10, B is 12
  // because 11 is passed over, L is 23 because 22 is, V is 34 because 33 is.
  // Counting the skips is what `floor((n - 1) / 10)` does — one more each time
  // the plain A=10..Z=35 sequence crosses another multiple of 11.
  const valueOf = (ch: string) => {
    const n = ch.charCodeAt(0) - 55; // A = 10 … Z = 35
    return n + Math.floor((n - 1) / 10);
  };

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i];
    const v = /[A-Z]/.test(ch) ? valueOf(ch) : Number(ch);
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10 === Number(s[10]) ? "ok" : "bad-check-digit";
}
