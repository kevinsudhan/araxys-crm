/**
 * What the app has already read, kept so a page opens on it (6 Oct).
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * Every page kept its data in its own state, so leaving it threw the data
 * away: going from the board to a case file and back, or from one shipment
 * tab to another, read everything again and showed the skeleton while it did
 * — two or three round trips of 120–240 ms each from Chennai to the database
 * in Mumbai, for data that had not changed. The database answers in
 * milliseconds; the waiting was the trips.
 *
 * TWO THINGS
 *
 *   snapshots   `peek(key)` / `put(key, value)`: the last thing a page showed,
 *               so it opens on that at once and reads again behind it. A
 *               snapshot is never the only read: the page always refreshes.
 *               Kept for the browser tab's life (sessionStorage), not past it.
 *
 *   one trip    `shared(key, fn, ttlMs)`: the same read asked for by several
 *               panels at once — ten console panels each wanting the partner
 *               list — goes once and serves them all; a list that rarely
 *               changes is kept a while too. A write clears what it touched
 *               (`invalidate`), and so does a change heard from the database
 *               (useTableChanges).
 * ---------------------------------------------------------------------------
 */

type Entry = { value: unknown; at: number };

const memory = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
const STORE = "araxys:snap:";
/** A snapshot larger than this stays in memory only: sessionStorage is small. */
const MAX_STORED = 400_000;

function readStored(key: string): Entry | undefined {
  try {
    const raw = sessionStorage.getItem(STORE + key);
    return raw ? (JSON.parse(raw) as Entry) : undefined;
  } catch {
    return undefined;
  }
}

/** The last value kept under `key`, or undefined. */
export function peek<T>(key: string): T | undefined {
  const hit = memory.get(key) ?? readStored(key);
  if (hit && !memory.has(key)) memory.set(key, hit);
  return hit?.value as T | undefined;
}

/** Keep `value` under `key`, for the next time the page opens. */
export function put<T>(key: string, value: T): T {
  const entry = { value, at: Date.now() };
  memory.set(key, entry);
  try {
    const raw = JSON.stringify(entry);
    if (raw.length <= MAX_STORED) sessionStorage.setItem(STORE + key, raw);
    else sessionStorage.removeItem(STORE + key);
  } catch {
    // Full or blocked: memory still has it.
  }
  return value;
}

/**
 * One trip for the same read made by several callers at once. With `ttlMs`,
 * its answer is reused for that long too — for lists that rarely change and
 * whose writes call `invalidate` (the partners, the registrations). Without,
 * only callers that ask while it is on its way share it, so a read made after
 * a write always goes again. A failure is not kept.
 */
export function shared<T>(key: string, fn: () => Promise<T>, ttlMs = 0): Promise<T> {
  // Each caller gets its own list, so one that sorts or splices it in place cannot change another's.
  const own = (v: unknown) => (Array.isArray(v) ? [...v] : v) as T;
  const hit = memory.get(`q:${key}`);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(own(hit.value));
  const going = inFlight.get(key);
  if (going) return going.then(own);
  const p = fn()
    .then((v) => {
      if (ttlMs > 0) memory.set(`q:${key}`, { value: v, at: Date.now() });
      return v;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p.then(own);
}

/**
 * Forget every shared read whose key starts with one of `prefixes` — after a
 * write, or a change heard from the database — so the next read goes again.
 * Snapshots are kept: a page still opens on its last view and refreshes.
 */
export function invalidate(...prefixes: string[]): void {
  for (const k of [...memory.keys()]) {
    if (k.startsWith("q:") && prefixes.some((p) => k.slice(2).startsWith(p))) memory.delete(k);
  }
}

/** Every shared read on a table, by the convention that keys start with the table's name. */
export function invalidateTables(tables: Iterable<string>): void {
  invalidate(...[...tables].map((t) => `${t}:`));
}

/** On sign-out: nothing of one person's is shown to the next. */
export function clearCache(): void {
  memory.clear();
  inFlight.clear();
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(STORE)) sessionStorage.removeItem(k);
  } catch {
    // Nothing kept.
  }
}
