import { supabase } from "../lib/supabase";
import type { DraftSnapshot, HblApproval } from "../lib/hblApproval";

/**
 * The house B/L draft as the shipper sees it, without an account (123).
 *
 * As with the quotation (publicQuote.ts): the browser calls two
 * security-definer functions with a fixed shape and touches no table, and
 * reading the page records nothing — mail scanners open every link — only
 * a press does.
 */

export type DraftLinkState = HblApproval | "issued" | "withdrawn" | "unknown";

export interface PublicHblDraft {
  state: DraftLinkState;
  hbl_no?: string | null;
  draft?: DraftSnapshot | null;
  sent_at?: string | null;
  answered_at?: string | null;
  answered_by?: string | null;
  note?: string | null;
}

export async function hblDraftByToken(token: string): Promise<PublicHblDraft> {
  const { data, error } = await supabase.rpc("hbl_draft_by_token", { p_token: token });
  if (error) throw new Error(error.message);
  return data as PublicHblDraft;
}

/** Approve, or say what to correct. A refusal comes back as a reason to say plainly, not an error. */
export async function answerHblDraft(token: string, approve: boolean, name: string, note: string): Promise<{ ok: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("hbl_answer_by_token", { p_token: token, p_approve: approve, p_name: name || null, p_note: note || null });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; reason: string };
}

/** Where the shipper lands: the configured public address, as for a quotation (acceptUrl). */
export function hblDraftUrl(token: string): string {
  const base = (import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin).replace(/\/+$/, "");
  return `${base}/b/${encodeURIComponent(token)}`;
}
