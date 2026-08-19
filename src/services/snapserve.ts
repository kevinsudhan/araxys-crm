/**
 * SnapServe integration boundary — STUBBED.
 *
 * Every function here mirrors a confirmed SnapServe MCP/REST endpoint
 * (see araxys-freight-voice-agent-brief.md §11 for the source docs read).
 * None of these make a real network call yet — they return typed dummy
 * data so the rest of the app can be built against a stable shape.
 *
 * To go live later: fill in SNAPSERVE_CONFIG, uncomment the fetch calls,
 * and remove the dummy return values. Nothing else in the app should
 * need to change — every page already calls through this module.
 */

export const SNAPSERVE_CONFIG = {
  baseUrl: "https://app.snapserve.ai/api",
  apiKey: "", // sk_live_... — intentionally empty, not wired yet
  connected: false,
};

async function notConnected<T>(dummy: T): Promise<T> {
  // Placeholder network delay so loading states can be built against this.
  await new Promise((r) => setTimeout(r, 120));
  return dummy;
}

// ---- Agents ----------------------------------------------------------

export function listAgents() {
  return notConnected({
    agents: [
      { id: "415", name: "Priya", status: "active" },
      { id: "416", name: "Ops squad member", status: "active" },
    ],
  });
}

export function getAgent(_id: string) {
  return notConnected({ id: _id, name: "Priya", status: "active", languages: ["ta", "en"] });
}

export function createAgent(_config: Record<string, unknown>) {
  return notConnected({ id: "new-agent", created: true });
}

export function toggleAgent(_id: string, _active: boolean) {
  return notConnected({ id: _id, active: _active });
}

// ---- Calls -------------------------------------------------------------

export function outboundCall(_agentId: string, _toNumber: string) {
  return notConnected({ callId: "call-stub-1", status: "queued" });
}

export function getCall(_callId: string) {
  return notConnected({ callId: _callId, status: "ended", durationSec: 120 });
}

export function getCallLogs(_callId: string) {
  return notConnected({ transcript: "(stub) transcript not connected", disposition: "unknown" });
}

export function endCall(_callId: string) {
  return notConnected({ callId: _callId, status: "ended" });
}

// ---- Campaigns & leads --------------------------------------------------

export function listCampaigns() {
  return notConnected({ campaigns: [] as unknown[] });
}

export function getCampaign(_id: string) {
  return notConnected({ id: _id, leads: 0 });
}

export function getWebsiteWebhook(_campaignId: string) {
  return notConnected({ webhookUrl: "https://app.snapserve.ai/api/webhooks/lead/STUB_TOKEN" });
}

// ---- Journeys ------------------------------------------------------------

export function listJourneys() {
  return notConnected({ journeys: [] as unknown[] });
}

export function activateJourney(_id: string) {
  return notConnected({ id: _id, active: true });
}

export function pauseJourney(_id: string) {
  return notConnected({ id: _id, active: false });
}

// ---- WhatsApp & email --------------------------------------------------

export function getWhatsappChannel() {
  return notConnected({ connected: false, provider: "none" });
}

export function getEmailChannel() {
  return notConnected({ connected: false, provider: "none" });
}

// ---- Numbers & squads ----------------------------------------------------

export function listPhoneNumbers() {
  return notConnected({ numbers: [] as unknown[] });
}

export function listSquads() {
  return notConnected({
    squads: [{ id: "sq-1", name: "Chennai desk squad", members: ["Priya", "Ops squad member"] }],
  });
}

export function listWebcallLinks() {
  return notConnected({ links: [] as unknown[] });
}

// ---- Analytics & wallet --------------------------------------------------

export function getAnalyticsDashboard() {
  return notConnected({ callsThisWeek: 0, conversionPct: 0 });
}

export function getAgentAnalytics(_agentId: string) {
  return notConnected({ agentId: _agentId, calls: 0 });
}

export function getWallet() {
  return notConnected({ balanceInr: 0 });
}

// ---- Caller memory (ground-truth sync, see brief §8.6) -------------------

export interface CallerMemoryFacts {
  note?: string;
  context?: Record<string, string | number>;
}

export function postCallerMemoryFacts(_agentId: string, _phone: string, _facts: CallerMemoryFacts) {
  return notConnected({ agentId: _agentId, phone: _phone, written: true });
}

export function getCallerMemory(_agentId: string, _phone: string) {
  return notConnected({ agentId: _agentId, phone: _phone, facts: {} as Record<string, unknown> });
}

// ---- Escape hatch ---------------------------------------------------------

export function snapserveApi(_method: string, _path: string, _body?: unknown) {
  return notConnected({ ok: false, note: "snapserve_api not wired yet" });
}
