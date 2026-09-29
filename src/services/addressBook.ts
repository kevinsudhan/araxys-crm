import { supabase } from "../lib/supabase";
import type { AddressEntry } from "../lib/addressRank";
import { listCustomers, listPeople } from "./enquiries";
import { listPartners } from "./partners";

/**
 * Everyone the desk writes to, for the To, Cc and Bcc suggestions.
 *
 * Customers and partners from their records, the desk from its logins, and
 * the people this mailbox has written to lately (the Sent copy in `mail_log`,
 * and whatever the Mail page has on screen). Loaded once per visit, the first
 * time a recipient box is used, and never on the way to anything else — a box
 * that cannot load it still takes a typed address.
 */
let book: Promise<AddressEntry[]> | null = null;
const recent = new Map<string, AddressEntry>();

export function loadAddressBook(): Promise<AddressEntry[]> {
  book ??= (async () => {
    const [customers, partners, people, sent] = await Promise.all([
      listCustomers().catch(() => []),
      listPartners().catch(() => []),
      listPeople().catch(() => []),
      supabase
        .from("mail_log")
        .select("to_addrs, cc_addrs")
        .order("sent_at", { ascending: false })
        .limit(400)
        .then(({ data }) => (data ?? []) as Array<{ to_addrs: unknown; cc_addrs: unknown }>, () => []),
    ]);
    const out: AddressEntry[] = [];
    for (const c of customers) {
      for (const e of c.emails ?? []) out.push({ address: e, name: c.name || c.company || e, kind: "customer", detail: c.company || undefined });
    }
    for (const p of partners) {
      for (const e of p.emails ?? []) out.push({ address: e, name: p.name || p.organisation || e, kind: "partner", detail: p.organisation || undefined });
    }
    for (const p of people) {
      if (p.email) out.push({ address: p.email, name: p.full_name || p.email, kind: "desk", detail: "Desk" });
    }
    for (const row of sent) {
      for (const r of [...asList(row.to_addrs), ...asList(row.cc_addrs)]) remember(r.name, r.address);
    }
    return out;
  })().catch(() => {
    book = null;
    return [];
  });
  return book.then((b) => [...b, ...recent.values()]);
}

/** People seen in the mailbox on screen, so someone just written to is offered at once. */
export function rememberAddresses(list: Array<{ name?: string; address?: string } | undefined>) {
  for (const r of list) if (r?.address) remember(r.name, r.address);
}

function remember(name: string | undefined, address: string) {
  const key = address.trim().toLowerCase();
  if (!key.includes("@") || recent.has(key)) return;
  recent.set(key, { address: address.trim(), name: name?.trim() || address.trim(), kind: "recent" });
}

function asList(v: unknown): Array<{ name?: string; address: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? { address: x } : (x as { name?: string; address?: string })))
    .filter((x): x is { name?: string; address: string } => typeof x?.address === "string");
}
