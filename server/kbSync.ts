/**
 * Pushes real customer records into the SnapServe knowledge base.
 *
 * This is the path that actually reaches the agent. Webhook tool RESULTS were verified
 * not to reach the model on the Gemini Live voice stack (the tool fires, returns correct
 * data, and the agent still invents) — but knowledge-base retrieval demonstrably works,
 * since the agent quotes pricing and container specs from it correctly. So facts the
 * agent must know live here, not behind a tool call.
 *
 * The write endpoints below are undocumented — the published API reference lists only
 * list/attach/search — but were verified by probing the live account:
 *   POST   /knowledge-sources                      -> 201 creates a source
 *   POST   /knowledge-sources/{id}/entries         -> 201 adds content
 *   DELETE /knowledge-sources/{id}/entries/{eid}   -> 204
 *   DELETE /knowledge-sources/{id}                 -> 204
 * There is no update-in-place, so a refresh is delete-then-recreate the entries.
 */
import { buildRealRecordsKb } from "./records";

const SOURCE_NAME = "Araxys real customer records";

interface Ctx {
  baseUrl: string;
  apiKey: string;
  agentIds: number[];
}

async function api(ctx: Ctx, path: string, init: RequestInit = {}) {
  const r = await fetch(`${ctx.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  return { ok: r.ok, status: r.status, body };
}

async function findSource(ctx: Ctx): Promise<{ id: number; status: string } | null> {
  const list = await api(ctx, "/knowledge-sources");
  if (!list.ok || !Array.isArray(list.body)) return null;
  const hit = (list.body as Array<{ id: number; name: string; status: string }>).find((s) => s.name === SOURCE_NAME);
  return hit ? { id: hit.id, status: hit.status } : null;
}

/**
 * Creates the source with its content inline.
 *
 * This matters: creating an empty source and adding entries afterwards leaves it stuck
 * at status "failed", and attach-agent only accepts a source that is "ready" — so the
 * content would embed but never reach the agent. Verified by probing both shapes.
 */
async function createSourceWithContent(ctx: Ctx, content: string): Promise<number | null> {
  const created = await api(ctx, "/knowledge-sources", {
    method: "POST",
    body: JSON.stringify({
      name: SOURCE_NAME,
      type: "text",
      entries: [{ title: "Real customer records", content }],
    }),
  });
  if (!created.ok) return null;
  return (created.body as { id: number }).id ?? null;
}

/**
 * Rewrites the whole source so it always mirrors current CRM state exactly. Diffing
 * individual records would be faster but risks the KB and CRM silently disagreeing —
 * and a stale shipment fact spoken to a customer is the failure mode we care most about.
 */
export async function syncRealRecordsToKb(ctx: Ctx) {
  if (!ctx.apiKey) return { ok: false, error: "no SnapServe key configured" };

  const content = await buildRealRecordsKb();

  // Delete and recreate rather than edit in place. There is no update endpoint, and a
  // source that is not "ready" cannot be attached to an agent — so recreating with the
  // content inline is the only route that reliably ends up reachable by the agent.
  const existing = await findSource(ctx);
  if (existing) {
    await api(ctx, `/knowledge-sources/${existing.id}`, { method: "DELETE" });
  }

  const sourceId = await createSourceWithContent(ctx, content);
  if (!sourceId) return { ok: false, error: "could not create knowledge source" };

  const check = await api(ctx, `/knowledge-sources/${sourceId}`);
  const status = (check.body as { status?: string })?.status;
  if (status !== "ready") {
    return { ok: false, error: `source created but status is "${status}" — agents can only attach a ready source`, sourceId };
  }

  // Attaching is idempotent, so it is safe to re-run on every sync.
  const attached: Record<string, boolean> = {};
  for (const agentId of ctx.agentIds) {
    const a = await api(ctx, `/knowledge-sources/${sourceId}/attach-agent/${agentId}`, { method: "POST" });
    attached[String(agentId)] = a.ok;
  }

  console.log(`[araxys] KB sync -> source ${sourceId}, ${content.length} chars, agents ${JSON.stringify(attached)}`);
  return { ok: true, sourceId, chars: content.length, attached };
}
