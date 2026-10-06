import { peek, put } from "./queryCache";
import { ACCOUNTS_DESK, MAIL_ONLY_CASE_FILE } from "./features";
import { appliesTo } from "./freeTime";
import type { DimensionLine } from "./dimensions";
import {
  correspondenceFor,
  eventsFor,
  getEnquiry,
  getShipment,
  listEnquiries,
  listPeople,
  listShipments,
  partiesFor,
  quotesFor,
  recentEvents,
  shipmentFor,
  type Party,
  type Quote,
  type Shipment,
} from "../services/enquiries";
import { listDimensions } from "../services/enquiryDimensions";
import { listQuotes, type PartnerQuote } from "../services/rfq";
import { shipmentBilling, shipmentMargin } from "../services/bills";
import { listShipmentContainers, type ShipmentContainer } from "../services/shipmentContainers";
import { checkpointsFor } from "../services/checkpoints";
import { routingsFor } from "../services/shipmentExtras";
import { enquiriesFor, getCustomer, getSummary, shipmentsFor } from "../services/customers";
import { countWaiting } from "../services/intake";

/**
 * A page's data, read before it is opened (7 Oct).
 *
 * ---------------------------------------------------------------------------
 * WHY
 *
 * The first time a case file, a job or a customer is opened in a tab there is
 * no snapshot of it (lib/queryCache), so it waited a round trip or two on a
 * skeleton — and every enquiry on the board is a first time. The pointer rests
 * on the link for a moment before the click; that moment is spent reading.
 *
 * HOW
 *
 * Each warm reads what the page reads on opening, with the page's own service
 * functions, and keeps it under the page's own snapshot keys (the
 * `useCachedState` keys in each page — change one, change both). The reads are
 * shared ones (`shared`), so a page opened while they are still on their way
 * joins them rather than asking again; one opened after finds its snapshot,
 * shows it at once and reads again behind it, as on any return visit.
 *
 * Quiet: a warm that fails leaves the page to read for itself. The same link
 * is warmed at most once every few seconds.
 * ---------------------------------------------------------------------------
 */

const AGAIN_MS = 15_000;
const lastWarm = new Map<string, number>();

/** False when `key` was warmed a moment ago. */
function due(key: string): boolean {
  const now = Date.now();
  if (now - (lastWarm.get(key) ?? 0) < AGAIN_MS) return false;
  lastWarm.set(key, now);
  return true;
}

/** The case file (pages/CaseFile.tsx): the enquiry, its panels' rows and its mail. */
export async function warmCaseFile(ref: string, mailbox: string): Promise<void> {
  const at = `case:${ref.toUpperCase()}`;
  if (!due(at)) return;
  const full = !MAIL_ONLY_CASE_FILE;
  try {
    const mail = correspondenceFor(ref, mailbox).catch(() => null);
    const [e, p, q, ev, sh, pq, d] = await Promise.all([
      getEnquiry(ref),
      full ? partiesFor(ref) : Promise.resolve<Party[]>([]),
      full ? quotesFor(ref) : Promise.resolve<Quote[]>([]),
      eventsFor(ref),
      full ? shipmentFor(ref) : Promise.resolve<Shipment | null>(null),
      full ? listQuotes(ref).catch(() => [] as PartnerQuote[]) : Promise.resolve<PartnerQuote[]>([]),
      full ? listDimensions(ref).catch(() => [] as DimensionLine[]) : Promise.resolve<DimensionLine[]>([]),
    ]);
    if (!e) return;
    put(`${at}:enquiry`, e);
    put(`${at}:parties`, p);
    put(`${at}:quotes`, q);
    put(`${at}:events`, ev);
    put(`${at}:shipment`, sh);
    put(`${at}:partnerQuotes`, pq);
    put(`${at}:dims`, d);
    const m = await mail;
    if (m) put(`${at}:mail`, m);
  } catch {
    // The page reads for itself.
  }
}

/** A job (pages/ShipmentDetail.tsx), with its workflow bar and its routings. */
export async function warmShipment(id: string): Promise<void> {
  const at = `ship:${id}`;
  if (!due(at)) return;
  try {
    // The enquiry is read with the job when its reference is already known.
    const known = peek<Shipment>(`${at}:shipment`)?.enquiry_ref ?? null;
    const early = known
      ? Promise.all([getEnquiry(known).catch(() => null), listDimensions(known).catch(() => [] as DimensionLine[])])
      : null;
    const [s, billing, margin, boxes, steps, routings] = await Promise.all([
      getShipment(id),
      ACCOUNTS_DESK ? shipmentBilling(id).catch(() => null) : Promise.resolve(null),
      ACCOUNTS_DESK ? shipmentMargin(id).catch(() => null) : Promise.resolve(null),
      listShipmentContainers(id).catch(() => [] as ShipmentContainer[]),
      checkpointsFor(id).catch(() => null),
      routingsFor(id).catch(() => null),
    ]);
    if (!s) return;
    const [e, d] =
      early && known === s.enquiry_ref
        ? await early
        : await Promise.all([
            getEnquiry(s.enquiry_ref).catch(() => null),
            listDimensions(s.enquiry_ref).catch(() => [] as DimensionLine[]),
          ]);
    put(`${at}:shipment`, s);
    put(`${at}:enquiry`, e);
    put(`${at}:lines`, d);
    put(`${at}:boxes`, appliesTo(s.transport_mode) ? boxes : []);
    put(`${at}:billing`, billing);
    put(`${at}:margin`, margin);
    if (steps) put(`${at}:steps`, steps);
    if (routings) put(`${at}:routings`, routings);
  } catch {
    // The page reads for itself.
  }
}

/** A customer's file (pages/CustomerFile.tsx). */
export async function warmCustomer(id: string): Promise<void> {
  const at = `customer:${id}`;
  if (!due(at)) return;
  try {
    const [c, s, sh, en] = await Promise.all([getCustomer(id), getSummary(id), shipmentsFor(id), enquiriesFor(id)]);
    if (!c) return;
    put(`${at}:customer`, c);
    put(`${at}:summary`, s);
    put(`${at}:shipments`, sh);
    put(`${at}:enquiries`, en);
  } catch {
    // The page reads for itself.
  }
}

/**
 * The boards most of the day is spent on — the overview, the enquiries, my
 * enquiries, completed jobs — from one reading of the enquiries and the jobs,
 * so the first visit to each in a tab opens on its rows too. In process is left
 * out: its cards sort by the steps read after the rows, and rows without them
 * would jump into order a moment later.
 */
export async function warmBoards(): Promise<void> {
  if (!due("boards")) return;
  try {
    const [list, ships, team, events, waiting] = await Promise.all([
      listEnquiries(),
      listShipments(),
      listPeople(),
      recentEvents(8),
      countWaiting().catch(() => null),
    ]);
    // As the pages keep a Map: its entries (lib/useCachedState, useCachedMap).
    const shipped = [...new Map(ships.map((s) => [s.enquiry_ref, s])).entries()];
    put("overview:enquiries", list);
    put("overview:shipments", ships);
    put("overview:events", events);
    if (waiting !== null) put("overview:waiting", waiting);
    put("enquiries:rows", list);
    put("enquiries:shipped", shipped);
    put("myenquiries:rows", list);
    put("myenquiries:shipped", shipped);
    put("completed:rows", ships.filter((s) => s.stage === "delivered"));
    put("people", team);
  } catch {
    // Each page reads for itself.
  }
}

const BOARDS = new Set(["/", "/enquiries", "/my-enquiries", "/shipments/completed"]);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Whatever a link leads to, read ahead of the click: called when the pointer
 * rests on a link, presses it, or the keyboard reaches it (layout/AppLayout).
 */
export function warmLink(href: string, mailbox: string): void {
  let path: string;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    path = url.pathname.replace(/\/+$/, "") || "/";
  } catch {
    return;
  }
  // The page's file as well, in case the idle prefetch (layout/AppLayout) has not reached it yet.
  const file = (load: () => Promise<unknown>) => void load().catch(() => {});
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/(?:my-)?enquiries\/([^/]+)$/))) {
    file(() => import("../pages/CaseFile"));
    void warmCaseFile(decodeURIComponent(m[1]), mailbox);
  } else if ((m = path.match(new RegExp(`^/shipments/(${UUID})(?:/[^/]*)?$`, "i")))) {
    file(() => import("../pages/ShipmentDetail"));
    file(() => import("../pages/shipment/ShipmentOverview"));
    void warmShipment(m[1]);
  } else if ((m = path.match(new RegExp(`^/customers/(${UUID})$`, "i")))) {
    file(() => import("../pages/CustomerFile"));
    void warmCustomer(m[1]);
  } else if (BOARDS.has(path)) {
    void warmBoards();
  }
}
