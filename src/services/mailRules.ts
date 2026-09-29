import * as graph from "./graphMail";
import { mailIsLive } from "./backend";
import type { MailRule, MailRuleInput } from "./graphMail";

export type { MailRule, MailRuleInput };
export { GraphForbiddenError } from "./graphMail";

/**
 * Outlook's inbox rules, through the CRM (graphMail.listRules and the rest).
 * Without Outlook (running the app locally) they are kept in memory, so the
 * screen can be used and checked.
 */
let memory: MailRule[] = [];

export async function listRules(mailbox: string): Promise<MailRule[]> {
  if (mailIsLive()) return graph.listRules(mailbox);
  return [...memory].sort((a, b) => a.sequence - b.sequence);
}

export async function createRule(mailbox: string, input: MailRuleInput): Promise<void> {
  if (mailIsLive()) {
    const existing = await graph.listRules(mailbox);
    return graph.createRule(mailbox, input, (existing[existing.length - 1]?.sequence ?? 0) + 1);
  }
  memory.push({ ...input, id: crypto.randomUUID(), sequence: (memory[memory.length - 1]?.sequence ?? 0) + 1 });
}

export async function setRuleEnabled(id: string, isEnabled: boolean): Promise<void> {
  if (mailIsLive()) return graph.setRuleEnabled(id, isEnabled);
  memory = memory.map((r) => (r.id === id ? { ...r, isEnabled } : r));
}

export async function deleteRule(id: string): Promise<void> {
  if (mailIsLive()) return graph.deleteRule(id);
  memory = memory.filter((r) => r.id !== id);
}
