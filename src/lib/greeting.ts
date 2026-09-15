/**
 * The opening line of a reply.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS PREFILLED
 *
 * Every reply this desk sends opens the same way — a salutation and a line of
 * courtesy — and typing it forty times a day is forty chances to send one
 * without it. Prefilled, it is there by default and deleted in one keystroke
 * when it is not wanted.
 *
 * WHY IT NEVER WRITES "Mr." OR "Ms."
 *
 * Because it would have to guess, and a name does not carry that. Getting it
 * wrong is worse than omitting it: "Dear Ms. Syed" to a man is a worse opening
 * than "Dear Syed", and the desk writes to agents across a dozen countries
 * whose naming conventions do not map onto English honorifics at all.
 *
 * The honorific is the one part of this a person should add, and the greeting
 * is sitting in an editable box when they do.
 *
 * WHY THE FIRST WORD
 *
 * "Syed Farmanullah A" is addressed as Syed. Using the whole display name
 * produces "Dear Syed Farmanullah A," which reads like a database record rather
 * than a letter. Where the first word is not usable, the whole thing is better
 * than a mangled part of it.
 * ---------------------------------------------------------------------------
 */

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Titles and suffixes that are not the person.
 *
 * A display name of "Mr. Wei Chen" would otherwise be addressed as "Mr." —
 * which is the one outcome worse than no salutation at all.
 */
const NOT_A_NAME = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "capt",
  "eng",
  "shri",
  "smt",
  "m/s",
  "messrs",
]);

/**
 * Who to address, from a display name and an address.
 *
 * Returns null when there is nothing usable, and the caller falls back to a
 * general salutation rather than inventing a name from the address — an
 * address is an identifier, and "Dear Intlsales," is not how anybody is
 * addressed.
 */
export function salutationName(name?: string | null, address?: string | null): string | null {
  const raw = name?.trim();

  // Some clients put the address in the display-name slot. That is not a name.
  if (!raw || ADDRESS.test(raw)) return null;

  // "Chen, Wei" — surname-first, which several corporate directories produce.
  // The part after the comma is the given name.
  const commaFirst = raw.includes(",") ? raw.split(",")[1]?.trim() : "";
  const source = commaFirst || raw;

  const words = source
    .split(/\s+/)
    .map((w) => w.replace(/[.,]+$/, ""))
    .filter(Boolean)
    .filter((w) => !NOT_A_NAME.has(w.toLowerCase()));

  if (!words.length) return null;

  const letters = (w: string) => w.replace(/[^\p{L}]/gu, "").length;

  /**
   * Skip past initials — all of them, not one.
   *
   * "A Syed" is Syed, and so is "A. B. Kumar" → Kumar. Looking only one word
   * ahead handled the first and returned nothing for the second, because the
   * second initial was taken as the answer and then rejected for being one
   * letter.
   */
  let at = 0;
  while (at < words.length && letters(words[at]) < 2) at++;
  if (at >= words.length) return null;

  /**
   * A lowercase particle belongs to the name that follows it.
   *
   * "van Dijk" addressed as "van" is not addressing anybody. These are written
   * lowercase and separate by convention in Dutch, German, Arabic and Iberian
   * names, and they are never the whole of what a person is called.
   */
  const PARTICLES = new Set([
    "van", "von", "de", "der", "den", "del", "della", "di", "da", "dos",
    "du", "la", "le", "bin", "ibn", "al", "el", "ter", "ten",
  ]);

  let usable = words[at];
  while (PARTICLES.has(usable.toLowerCase()) && words[at + 1]) {
    at++;
    usable = `${usable} ${words[at]}`;
  }

  if (letters(usable) < 2) return null;

  // ALL CAPS reads as shouting in a salutation. Title case anything that is
  // entirely upper, and leave mixed case alone — "McBride" and "van Dijk" are
  // already written the way their owner writes them.
  return usable === usable.toUpperCase() && /\p{L}/u.test(usable)
    ? usable[0].toUpperCase() + usable.slice(1).toLowerCase()
    : usable;
}

/**
 * The greeting block, as HTML for the compose editor.
 *
 * Two short lines and a blank one, so the cursor lands where the message goes
 * rather than in the middle of the courtesy.
 */
export function greetingHtml(name?: string | null, address?: string | null): string {
  const who = salutationName(name, address);
  return (
    `<div>Dear ${who ?? "Sir/Madam"},</div>` +
    `<div><br></div>` +
    `<div>Good day to you.</div>` +
    `<div><br></div>`
  );
}
