import { supabase } from "../lib/supabase";
import type { Registration } from "../lib/registrations";

/**
 * The company's registrations (132): everybody reads them; an administrator
 * adds, changes, retires and removes them. The rules are lib/registrations.ts.
 */

const COLS = "id, kind, title, number, authority, issued_on, valid_until, amount_inr, notes, active, updated_at";

export async function listRegistrations(): Promise<Registration[]> {
  const { data, error } = await supabase.from("company_registrations").select(COLS).order("active", { ascending: false }).order("valid_until", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Registration[]).map((r) => ({ ...r, amount_inr: r.amount_inr === null ? null : Number(r.amount_inr) }));
}

type Draft = Omit<Registration, "id" | "active" | "updated_at">;

const clean = (r: Draft) => ({
  kind: r.kind,
  title: r.title.trim(),
  number: r.number.trim().toUpperCase(),
  authority: r.authority.trim(),
  issued_on: r.issued_on || null,
  valid_until: r.valid_until || null,
  amount_inr: r.amount_inr,
  notes: r.notes.trim(),
});

/** A write nobody but an administrator may make comes back empty, not as an error: said as one. */
const adminOnly = (rows: unknown[] | null) => {
  if (!rows?.length) throw new Error("Only an administrator can change the company's registrations.");
};

const friendly = (e: { code?: string; message: string }) =>
  new Error(e.code === "23505" ? "There is already one in force of that kind: retire it first (it is kept for the record), then add the new one." : e.message);

export async function addRegistration(r: Draft): Promise<void> {
  const { data, error } = await supabase.from("company_registrations").insert(clean(r)).select("id");
  if (error) throw friendly(error);
  adminOnly(data);
}

export async function updateRegistration(id: string, r: Draft): Promise<void> {
  const { data, error } = await supabase.from("company_registrations").update(clean(r)).eq("id", id).select("id");
  if (error) throw friendly(error);
  adminOnly(data);
}

/** Renewed or given up: kept for the record, no longer the one in force. */
export async function setRegistrationActive(id: string, active: boolean): Promise<void> {
  const { data, error } = await supabase.from("company_registrations").update({ active }).eq("id", id).select("id");
  if (error) throw friendly(error);
  adminOnly(data);
}

/** Entered by mistake. */
export async function removeRegistration(id: string): Promise<void> {
  const { data, error } = await supabase.from("company_registrations").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  adminOnly(data);
}
