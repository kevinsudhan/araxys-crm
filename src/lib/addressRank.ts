/**
 * Which addresses to suggest for what has been typed in To, Cc or Bcc.
 *
 * Pure, so it can be tested: the address book itself is loaded in
 * services/addressBook.ts.
 */
export type AddressKind = "customer" | "partner" | "desk" | "recent";

export interface AddressEntry {
  address: string;
  name: string;
  kind: AddressKind;
  /** The company, or what the person is to the desk. */
  detail?: string;
}

/** Customers first, then partners, then the desk; recent correspondents last. */
const KIND_ORDER: Record<AddressKind, number> = { customer: 0, partner: 1, desk: 2, recent: 3 };

/**
 * The best few matches for `typed`: an address or a word of a name or company
 * that starts with it ranks above one that merely contains it, and among
 * those, customers, then partners, then the desk, then recent strangers. Addresses
 * already on the line are left out, and each address appears once.
 */
export function rankAddresses(book: AddressEntry[], typed: string, exclude: string[] = [], limit = 8): AddressEntry[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(exclude.map((a) => a.trim().toLowerCase()));
  const best = new Map<string, { entry: AddressEntry; score: number }>();

  for (const entry of book) {
    const address = entry.address.trim().toLowerCase();
    if (!address || skip.has(address)) continue;
    const words = `${entry.name} ${entry.detail ?? ""}`.toLowerCase().split(/[\s,.()@-]+/).filter(Boolean);
    // An address or a word of the name that starts with what was typed is a
    // strong match either way; within that, a customer before a stranger.
    let score: number;
    if (address.startsWith(q) || words.some((w) => w.startsWith(q))) score = 0;
    else if (address.includes(q) || `${entry.name} ${entry.detail ?? ""}`.toLowerCase().includes(q)) score = 1;
    else continue;
    score = score * 10 + KIND_ORDER[entry.kind];
    const kept = best.get(address);
    // The same address known twice keeps its better match, and the name it
    // is best known by (a customer's rather than a mailbox's display name).
    if (!kept || score < kept.score) best.set(address, { entry, score });
  }

  return [...best.values()]
    .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((x) => x.entry);
}

/** The part of the line being typed: what follows the last comma or semicolon. */
export function currentToken(line: string): { before: string; token: string } {
  const cut = Math.max(line.lastIndexOf(","), line.lastIndexOf(";"));
  return cut < 0 ? { before: "", token: line } : { before: line.slice(0, cut + 1), token: line.slice(cut + 1) };
}
