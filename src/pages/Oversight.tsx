import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import EnquiryLink from "../components/EnquiryLink";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Boxes,
  Briefcase,
  ChevronDown,
  FileText,
  Inbox,
  Layers,
  Mail,
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import OversightLock, { isUnlocked } from "../components/OversightLock";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/dates";
import { initialsFor } from "../lib/initials";
import { recipientsText } from "../lib/mailLog";
import {
  buildFeed,
  CATEGORIES,
  labelCounts,
  PERIOD_LABEL,
  periodRange,
  personOfMail,
  sectionsOf,
  statsFor,
  type ActionLike,
  type ActivityItem,
  type Category,
  type Period,
} from "../lib/oversight";
import { useTablesChanges } from "../lib/useTableChanges";
import {
  arrivedAt,
  listEnquiries,
  listPeople,
  listShipments,
  nameOf,
  stageLabel,
  STATUS_LABEL,
  type Customer,
  type Enquiry,
  type Person,
  type ShipmentRow,
} from "../services/enquiries";
import { listMailLog, mailboxesSeen, syncAllMailboxes, syncSentMail, type MailboxSeen, type MailLogRow } from "../services/mailLog";
import { teamActions } from "../services/teamActions";
import { ListSkeleton } from "../components/Loading";
import { useCachedState } from "../lib/useCachedState";

/**
 * Who on the desk did what — one person at a time (7 Oct).
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SHOWS
 *
 * Everybody on the desk down the side, each with how much they did in the
 * period, when they last did anything, and what they are holding now. Picking
 * a name shows their work in sections, in the order a job runs:
 *
 *   Mail sent           everything their mailbox sent, CRM or Outlook (086)
 *   Enquiries & queue   opened, taken on (and how long after it came in),
 *                       updated, mail filed, set aside from the queue
 *   Quotes & rates      quotes entered and sent, approvals, partner rates,
 *                       original rates, rate cards, sailings
 *   Bookings & jobs     booked, steps done, pre-alerts, tracking, warehouse,
 *                       DG, sign-off
 *   Documents & B/L     files filed, house bills, releases, DOs
 *   Consoles            opened, jobs put on and off, master B/L, CSN
 *   Accounts            invoices and notes, receipts, payments, vendor bills,
 *                       agent statements
 *
 * each with the kinds inside it to narrow by, and the same as one timeline.
 * With nobody picked, the desk as a whole: the period's figures, the
 * enquiries nobody has taken on, and whose mailbox is being copied in.
 *
 * Where it comes from: the mail log, and `team_actions` (137) — the timeline
 * and every table that records who did something. Live (084): anything the
 * desk does shows as it happens. The period and the search narrow everything.
 *
 * WHY IT ASKS FOR A PASSWORD, AND WHAT IT DOES NOT DO
 *
 * Being the administrator is enough to reach the page and not enough to open
 * it: the risk is an unlocked laptop in an office where everybody knows
 * everybody. And it does not score anybody — no targets, no ranking, no red
 * badge for being slow. It says what happened and who did it; the numbers are
 * counts, people in name order.
 * ---------------------------------------------------------------------------
 */

type Row = Enquiry & { customer: Customer | null };

const PERIODS: Period[] = ["today", "yesterday", "7d", "30d", "month"];

const CATEGORY_ICON: Record<Category, LucideIcon> = {
  mail: Mail,
  enquiries: Inbox,
  quotes: Tag,
  jobs: Truck,
  documents: FileText,
  consoles: Boxes,
  accounts: Banknote,
  other: MoreHorizontal,
};

const KIND_TONE: Partial<Record<string, string>> = {
  Quoted: "bg-bg-warning text-text-warning border-text-warning/25",
  "Quote entered": "bg-bg-warning text-text-warning border-text-warning/25",
  Accepted: "bg-bg-success text-text-success border-text-success/25",
  Booked: "bg-bg-success text-text-success border-text-success/25",
  Declined: "bg-bg-danger text-text-danger border-text-danger/25",
  Lost: "bg-bg-danger text-text-danger border-text-danger/25",
  "Taken on": "bg-bg-success text-text-success border-text-success/25",
  "Step done": "bg-bg-success text-text-success border-text-success/25",
};
const MAIL_TONE = "bg-bg-accent text-text-accent border-text-accent/25";
const PLAIN_TONE = "bg-surface-2 text-text-secondary border-border-strong";

/** How many rows a section shows before "Show all". */
const FIRST = 8;

const clock = (iso: string) => formatDate(iso, { hour: "2-digit", minute: "2-digit", hour12: true });
const dayShort = (iso: string) => formatDate(iso, { weekday: "short", day: "numeric", month: "short" });
const dayHead = (iso: string) => formatDate(iso, { weekday: "long", day: "numeric", month: "long" });

/** "today", "in the last 7 days": the period as it reads after "Nothing recorded". */
const PERIOD_PHRASE: Record<Period, string> = {
  today: "today",
  yesterday: "yesterday",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  month: "this month",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The wait between two moments, said the way a person would say it. */
function gap(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const mins = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 60) return `${mins} min`;
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(hrs < 10 ? 1 : 0)} hr`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

const nameOfPerson = (p: Person) => p.full_name?.trim() || p.email;

export default function Oversight() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();

  const [period, setPeriod] = useState<Period>("today");
  const [rows, setRows] = useCachedState<Row[]>("oversight:rows", []);
  const [people, setPeople, peopleKnown] = useCachedState<Person[]>("people", []);
  const [ships, setShips] = useCachedState<ShipmentRow[]>("oversight:ships", []);
  // Per period, so going back to one shows it at once. The mail stays in memory only.
  const [actions, setActions] = useCachedState<ActionLike[]>(`oversight:actions:${period}`, []);
  const [mails, setMails] = useState<MailLogRow[]>([]);
  const [seen, setSeen] = useState<MailboxSeen[]>([]);

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Whether this tab has been past the password prompt. */
  const [unlocked, setUnlocked] = useState(isUnlocked);

  const range = useMemo(() => periodRange(period), [period]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = periodRange(period);
      const from = r.from.toISOString();
      const to = r.to?.toISOString() ?? null;
      const [list, team, acts, ml, sh, sn] = await Promise.all([
        listEnquiries(),
        listPeople(),
        teamActions(from, to),
        listMailLog(from, to).catch(() => [] as MailLogRow[]),
        listShipments().catch(() => [] as ShipmentRow[]),
        mailboxesSeen().catch(() => [] as MailboxSeen[]),
      ]);
      setRows(list);
      setPeople(team);
      setActions(acts);
      setMails(ml);
      setShips(sh);
      setSeen(sn);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the desk.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (unlocked) void load();
  }, [load, unlocked]);

  // Live: anything the desk records, by anybody (084, 086, 137).
  useTablesChanges(
    [
      ["mail_log", null],
      ["mail_log_mailboxes", null],
      ["enquiry_events", null],
      ["shipment_checkpoints", null],
      ["enquiries", null],
      ["shipments", null],
      ["enquiry_files", null],
      ["consoles", null],
      ["invoices", null],
      ["bills", null],
      ["intake", null],
      ["warehouse_receipts", null],
      ["tracking_events", null],
    ],
    (tables) => {
      // A mailbox checked with nothing new moves only its "last checked": every
      // open session does that every few minutes, so it does not reload the lot.
      if (tables.size === 1 && tables.has("mail_log_mailboxes")) void mailboxesSeen().then(setSeen, () => {});
      else void load();
    },
    unlocked && session?.role === "admin"
  );

  const feed = useMemo(() => buildFeed({ actions, mails, people, range }), [actions, mails, people, range]);
  const sorted = useMemo(() => [...people].sort((a, b) => nameOfPerson(a).localeCompare(nameOfPerson(b))), [people]);
  const booked = useMemo(() => new Set(ships.map((s) => s.enquiry_ref)), [ships]);
  const enquiryOf = useMemo(() => new Map(rows.map((r) => [r.ref, r])), [rows]);

  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (i: ActivityItem) =>
      !needle ||
      [i.text, i.ref, i.label, i.mail?.mailbox, ...(i.mail ? [...i.mail.to_addrs, ...i.mail.cc_addrs].map((r) => `${r.name} ${r.address}`) : [])].some((p) =>
        (p ?? "").toLowerCase().includes(needle)
      ),
    [needle]
  );

  const picked = params.get("person");
  const person = picked ? people.find((p) => p.id === picked) ?? null : null;
  const pick = (id: string | null) =>
    setParams((p) => {
      if (id) p.set("person", id);
      else p.delete("person");
      return p;
    });

  // A person's page opens at its top, not wherever the list was scrolled to.
  useEffect(() => {
    if (picked && window.matchMedia("(max-width: 1023px)").matches) window.scrollTo({ top: 0 });
  }, [picked]);

  if (session?.role !== "admin") {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Administrators only"
        hint="This page shows what everyone on the desk has been doing. Your account is signed in as an employee."
      />
    );
  }

  // Two locks, in order. The role decides who may ask; the password decides
  // whether this particular sitting at this particular laptop gets in.
  if (!unlocked) {
    return <OversightLock onUnlocked={() => setUnlocked(true)} />;
  }

  const holding = (id: string) => ({
    enquiries: rows.filter((r) => r.assigned_to === id && !booked.has(r.ref) && r.status !== "declined" && r.status !== "lost"),
    jobs: ships.filter((j) => j.assigned_to === id && j.stage !== "delivered" && j.stage !== "cancelled"),
  });

  return (
    <div>
      <PageHeader
        title="Team oversight"
        subtitle="Everyone on the desk and what they did. Pick a name to see their work in sections: mail, enquiries, quotes, jobs, documents, consoles and accounts."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-text-success">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-text-success opacity-40" />
                <span className="relative inline-flex size-2 rounded-full bg-text-success" />
              </span>
              Live
            </span>
            <button
              type="button"
              onClick={() => {
                setSyncing(true);
                // The server for every mailbox, and this session for its own.
                void Promise.all([syncAllMailboxes(), syncSentMail()])
                  .then(() => load())
                  .finally(() => setSyncing(false));
              }}
              disabled={syncing}
              title="Copy every mailbox's sent mail now, rather than wait for the next five-minute run"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:opacity-60"
            >
              <Mail size={13} className={syncing ? "animate-pulse" : ""} />
              {syncing ? "Copying…" : "Copy sent mail now"}
            </button>
            <button
              onClick={() => void load()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 text-[12px] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-bg-danger px-3 py-2.5 text-[12px] text-text-danger">
          <AlertCircle size={13} className="mt-px shrink-0" />
          {error}
        </div>
      )}

      {/* ---- the period and the search ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <Chip key={p} active={period === p} onClick={() => setPeriod(p)}>
              {PERIOD_LABEL[p]}
            </Chip>
          ))}
        </div>
        <label className="relative min-w-[200px] flex-1 sm:max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Job, subject, recipient, company…" className="h-8 w-full pl-8" aria-label="Search" />
        </label>
      </div>

      {loading && !peopleKnown ? (
        <ListSkeleton />
      ) : !people.length ? (
        <EmptyState icon={Users} title="Nobody on the desk yet" hint="People appear here once they have an account." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
          {/* The list: beside the page from lg; on a phone, the page itself until a name is picked. */}
          <div className={person ? "hidden lg:block" : ""}>
            <PeopleList
              people={sorted}
              feed={feed}
              holding={holding}
              picked={person?.id ?? null}
              onPick={pick}
              phrase={PERIOD_PHRASE[period]}
            />
          </div>

          <div className="min-w-0">
            {person ? (
              <PersonView
                key={person.id}
                person={person}
                items={feed.filter((i) => i.who === person.id && matches(i))}
                allMine={feed.filter((i) => i.who === person.id)}
                held={holding(person.id)}
                mailboxes={seen.filter((s) => personOfMail({ mailbox: s.mailbox, synced_by: s.synced_by }, people) === person.id)}
                enquiryOf={enquiryOf}
                periodLabel={PERIOD_LABEL[period]}
                phrase={PERIOD_PHRASE[period]}
                searching={Boolean(needle)}
                onBack={() => pick(null)}
              />
            ) : (
              <DeskSummary
                feed={feed}
                rows={rows}
                booked={booked}
                seen={seen}
                personName={(id) => nameOf(people, id) ?? (id ? "someone" : "the server")}
                periodLabel={PERIOD_LABEL[period]}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The people
// ---------------------------------------------------------------------------

function PeopleList({
  people,
  feed,
  holding,
  picked,
  onPick,
  phrase,
}: {
  people: Person[];
  feed: ActivityItem[];
  holding: (id: string) => { enquiries: Row[]; jobs: ShipmentRow[] };
  picked: string | null;
  onPick: (id: string | null) => void;
  phrase: string;
}) {
  return (
    <nav aria-label="People" className="card overflow-hidden p-0 lg:sticky lg:top-[72px]">
      <button
        type="button"
        onClick={() => onPick(null)}
        aria-current={picked === null ? "page" : undefined}
        className={`relative flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors ${
          picked === null ? "bg-surface-2" : "hover:bg-surface-2/70"
        }`}
      >
        {picked === null && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-brand" />}
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-text-secondary">
          <Layers size={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-text-primary">The whole desk</span>
          <span className="block text-[11.5px] text-text-muted">Figures, unclaimed enquiries, mailboxes</span>
        </span>
      </button>
      <ul className="divide-y divide-border">
        {people.map((p) => {
          const mine = feed.filter((i) => i.who === p.id);
          const last = mine[0]?.at ?? null;
          const h = holding(p.id);
          const active = picked === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p.id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors ${active ? "bg-surface-2" : "hover:bg-surface-2/70"}`}
              >
                {active && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-brand" />}
                <span
                  aria-hidden
                  className={`grid size-9 shrink-0 place-items-center rounded-lg border text-[11.5px] font-semibold tracking-wide ${
                    active ? "border-brand/25 bg-bg-success text-text-success" : "border-border bg-surface-2 text-text-secondary"
                  }`}
                >
                  {initialsFor(p.full_name, p.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-text-primary">{nameOfPerson(p)}</span>
                    <span className="shrink-0 tabular-nums text-[12px] font-medium text-text-primary">{mine.length || ""}</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-text-muted">
                    {mine.length ? `${mine.length} action${mine.length === 1 ? "" : "s"} · last ${ago(last)}` : `Nothing recorded ${phrase}`}
                  </span>
                  {(h.enquiries.length > 0 || h.jobs.length > 0) && (
                    <span className="block truncate text-[11.5px] text-text-secondary">
                      Holding {h.enquiries.length} enquir{h.enquiries.length === 1 ? "y" : "ies"} · {h.jobs.length} job{h.jobs.length === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------

function PersonView({
  person,
  items,
  allMine,
  held,
  mailboxes,
  enquiryOf,
  periodLabel,
  phrase,
  searching,
  onBack,
}: {
  person: Person;
  /** Theirs, narrowed by the search. */
  items: ActivityItem[];
  /** Theirs, all of it: the figures do not move with the search. */
  allMine: ActivityItem[];
  held: { enquiries: Row[]; jobs: ShipmentRow[] };
  mailboxes: MailboxSeen[];
  enquiryOf: Map<string, Row>;
  periodLabel: string;
  phrase: string;
  searching: boolean;
  onBack: () => void;
}) {
  const [view, setView] = useState<"sections" | "timeline">("sections");
  const sections = useMemo(() => sectionsOf(items), [items]);
  const counts = useMemo(() => new Map(sectionsOf(allMine).map((s) => [s.key, s.items.length])), [allMine]);
  const stats = statsFor(person.id, allMine);
  const name = nameOfPerson(person);

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary lg:hidden">
        <ArrowLeft size={13} />
        Everyone
      </button>

      {/* ---- who ---- */}
      <section className="card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl border border-brand/25 bg-bg-success text-[13px] font-semibold tracking-wide text-text-success">
            {initialsFor(person.full_name, person.email)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-semibold text-text-primary">{name}</h2>
            <p className="truncate text-[12px] text-text-muted">
              {person.email} · <span className="capitalize">{person.role}</span>
            </p>
          </div>
          <p className="text-[12px] text-text-secondary sm:text-right">
            {stats.lastAt ? (
              <>
                Last activity <span className="font-medium text-text-primary">{ago(stats.lastAt)}</span>
              </>
            ) : (
              `Nothing recorded ${phrase}`
            )}
          </p>
        </div>

        {mailboxes.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[11.5px]">
            {mailboxes.map((s) => {
              const stale = !s.synced_at || Date.now() - Date.parse(s.synced_at) > 86_400_000;
              return (
                <li key={s.mailbox} className={stale ? "text-text-warning" : "text-text-muted"}>
                  <Mail size={11} className="mr-1 inline" />
                  {s.mailbox}: sent mail {s.synced_at ? `copied in ${ago(s.synced_at)}` : "never copied in"}
                  {s.server_error && <span> · last server copy failed: {s.server_error}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {stats.domains.length > 0 && (
          <p className="mt-1 truncate text-[11.5px] text-text-secondary">
            Wrote most to{" "}
            {stats.domains
              .slice(0, 4)
              .map(([d, n]) => `${d} (${n})`)
              .join(", ")}
          </p>
        )}

        {/* ---- the sections, in figures: a press goes to the section ---- */}
        <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{periodLabel}</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7">
          {CATEGORIES.filter((c) => c.key !== "other" || counts.get("other")).map((c) => {
            const n = counts.get(c.key) ?? 0;
            const Icon = CATEGORY_ICON[c.key];
            return (
              <button
                key={c.key}
                type="button"
                disabled={!n}
                onClick={() => {
                  setView("sections");
                  window.setTimeout(() => document.getElementById(`section-${c.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                }}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-left transition-colors enabled:hover:border-border-strong enabled:hover:bg-surface-1 disabled:opacity-55"
              >
                <span className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
                  <Icon size={11} />
                  <span className="truncate">{c.label}</span>
                </span>
                <span className="mt-0.5 block text-[17px] font-medium leading-tight tabular-nums text-text-primary">{n}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- what they hold now, whatever the period ---- */}
      <Holding held={held} />

      {/* ---- their work ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <h3 className="text-[13px] font-semibold text-text-primary">
          What {name.split(/\s+/)[0]} did <span className="font-normal text-text-muted">· {periodLabel.toLowerCase()}</span>
        </h3>
        <div className="inline-flex rounded-lg border border-border bg-surface-1 p-0.5" role="group" aria-label="Show as">
          {(
            [
              ["sections", "In sections"],
              ["timeline", "As a timeline"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`h-7 rounded-md px-2.5 text-[12px] transition-colors ${view === v ? "bg-brand text-white" : "text-text-secondary hover:text-text-primary"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!items.length ? (
        <EmptyState
          icon={Inbox}
          title={searching ? "Nothing matches the search" : `Nothing recorded ${phrase}`}
          hint={
            searching
              ? `None of ${name}'s work in this period mentions that.`
              : `${name} sent no mail and recorded nothing in the CRM ${phrase} — or their sent mail has not been copied in yet.`
          }
        />
      ) : view === "timeline" ? (
        <Timeline items={items} enquiryOf={enquiryOf} />
      ) : (
        sections.map((s) => <SectionCard key={s.key} section={s} enquiryOf={enquiryOf} />)
      )}
    </div>
  );
}

/** The enquiries a person holds and the jobs they have in process — now, not in the period. */
function Holding({ held }: { held: { enquiries: Row[]; jobs: ShipmentRow[] } }) {
  const [open, setOpen] = useState(false);
  const n = held.enquiries.length + held.jobs.length;
  return (
    <section className="card overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!n}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors enabled:hover:bg-surface-2"
      >
        <Briefcase size={15} className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-text-primary">Holding now</span>
          <span className="block text-[11.5px] text-text-muted">
            {n
              ? `${held.enquiries.length} enquir${held.enquiries.length === 1 ? "y" : "ies"} not yet booked · ${held.jobs.length} job${held.jobs.length === 1 ? "" : "s"} in process`
              : "No open enquiries or jobs in their name"}
          </span>
        </span>
        {n > 0 && <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && n > 0 && (
        <div className="grid gap-3 border-t border-border bg-surface-2/60 px-4 py-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Enquiries</p>
            {!held.enquiries.length ? (
              <p className="text-[12px] text-text-muted">None.</p>
            ) : (
              <ul className="space-y-1">
                {held.enquiries.map((r) => (
                  <li key={r.ref} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                    <EnquiryLink to={`/enquiries/${r.ref}`} className="shrink-0 font-mono text-[11.5px] text-text-accent hover:underline">
                      {r.ref}
                    </EnquiryLink>
                    <span className="min-w-0 truncate text-text-primary">{r.customer?.company || r.customer?.name || "—"}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-text-muted">{STATUS_LABEL[r.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Jobs in process</p>
            {!held.jobs.length ? (
              <p className="text-[12px] text-text-muted">None.</p>
            ) : (
              <ul className="space-y-1">
                {held.jobs.map((j) => (
                  <li key={j.id} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                    <Link to={`/shipments/${j.id}`} className="shrink-0 font-mono text-[11.5px] text-text-accent hover:underline">
                      {j.enquiry_ref}
                    </Link>
                    <span className="min-w-0 truncate text-text-primary">{j.customer?.company || j.customer?.name || "—"}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-text-muted">{stageLabel(j.stage, j.transport_mode)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** One section of a person's work: its kinds to narrow by, and the first few with the rest a press away. */
function SectionCard({
  section,
  enquiryOf,
}: {
  section: { key: Category; label: string; hint: string; items: ActivityItem[] };
  enquiryOf: Map<string, Row>;
}) {
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const kinds = labelCounts(section.items);
  const shown = kind ? section.items.filter((i) => i.label === kind) : section.items;
  const list = all ? shown : shown.slice(0, FIRST);
  const Icon = CATEGORY_ICON[section.key];

  return (
    <section id={`section-${section.key}`} className="card scroll-mt-20 overflow-hidden p-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 text-text-secondary">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-semibold text-text-primary">{section.label}</span>
            <span className="tabular-nums text-[12px] text-text-muted">{section.items.length}</span>
          </span>
          <span className="block truncate text-[11.5px] text-text-muted">{section.hint}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border">
          {kinds.length > 1 && (
            <div className="flex flex-wrap gap-1.5 px-4 py-2.5" role="group" aria-label={`${section.label}: kind`}>
              <Chip
                active={kind === null}
                onClick={() => {
                  setKind(null);
                  setAll(false);
                }}
              >
                All <span className="opacity-60">{section.items.length}</span>
              </Chip>
              {kinds.map(([label, n]) => (
                <Chip
                  key={label}
                  active={kind === label}
                  onClick={() => {
                    setKind(kind === label ? null : label);
                    setAll(false);
                  }}
                >
                  {label} <span className="opacity-60">{n}</span>
                </Chip>
              ))}
            </div>
          )}
          <ol className={`divide-y divide-border ${kinds.length > 1 ? "border-t border-border" : ""}`}>
            {list.map((i) => (
              <ActionRow key={i.id} item={i} enquiryOf={enquiryOf} withDay />
            ))}
          </ol>
          {shown.length > FIRST && (
            <button
              type="button"
              onClick={() => setAll((a) => !a)}
              className="w-full border-t border-border py-2 text-[12px] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              {all ? "Show fewer" : `Show all ${shown.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The same work as one list, newest first, a heading per day. */
function Timeline({ items, enquiryOf }: { items: ActivityItem[]; enquiryOf: Map<string, Row> }) {
  const [shown, setShown] = useState(150);
  const days: Array<[string, ActivityItem[]]> = [];
  for (const i of items.slice(0, shown)) {
    const d = dayHead(i.at);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(i);
    else days.push([d, [i]]);
  }
  return (
    <div className="space-y-4">
      {days.map(([d, list]) => (
        <section key={d}>
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">{d}</h3>
          <ol className="card divide-y divide-border overflow-hidden p-0">
            {list.map((i) => (
              <ActionRow key={i.id} item={i} enquiryOf={enquiryOf} withSection />
            ))}
          </ol>
        </section>
      ))}
      {items.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 150)} className="w-full rounded-lg border border-border bg-surface-1 py-2 text-[12px] text-text-secondary hover:text-text-primary">
          Show more ({items.length - shown} further)
        </button>
      )}
    </div>
  );
}

/** One thing a person did: when, what kind, what, and on which job. A mail opens to its recipients and first lines. */
function ActionRow({ item: i, enquiryOf, withDay, withSection }: { item: ActivityItem; enquiryOf: Map<string, Row>; withDay?: boolean; withSection?: boolean }) {
  const [open, setOpen] = useState(false);
  const section = withSection ? CATEGORIES.find((c) => c.key === i.category)?.label : null;
  // Taken on: how long after it came in.
  const enquiry = i.kind === "assigned" && i.ref ? enquiryOf.get(i.ref) : undefined;
  const wait = enquiry ? gap(arrivedAt(enquiry), i.at) : null;
  const tone = i.source === "mail" ? MAIL_TONE : (KIND_TONE[i.label] ?? PLAIN_TONE);

  return (
    <li>
      <button
        type="button"
        onClick={() => i.mail && setOpen((o) => !o)}
        aria-expanded={i.mail ? open : undefined}
        className={`grid w-full grid-cols-[72px_minmax(0,1fr)] items-start gap-x-3 px-4 py-2.5 text-left sm:grid-cols-[88px_minmax(0,1fr)] ${i.mail ? "hover:bg-surface-2" : "cursor-default"}`}
      >
        <span className="pt-px text-[11px] leading-snug tabular-nums text-text-muted">
          {withDay && <span className="block">{dayShort(i.at)}</span>}
          {clock(i.at)}
        </span>
        <span className="min-w-0 text-[12.5px] text-text-primary">
          <span className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-px text-[10.5px] font-medium ${tone}`}>{i.label}</span>
            {section && <span className="text-[10.5px] text-text-muted">{section}</span>}
          </span>
          <span className="break-words">{i.mail ? i.mail.subject || "(no subject)" : i.text}</span>
          {wait && <span className="text-text-muted"> · {wait} after it came in</span>}
          {i.ref && (
            <EnquiryLink to={`/enquiries/${i.ref}`} className="ml-2 font-mono text-[11px] text-text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
              {i.ref}
            </EnquiryLink>
          )}
          {!i.ref && i.shipmentId && (
            <Link to={`/shipments/${i.shipmentId}`} className="ml-2 text-[11px] text-text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
              Open the job
            </Link>
          )}
          {!i.ref && !i.shipmentId && i.consoleId && (
            <Link to="/consoles" className="ml-2 text-[11px] text-text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
              Consoles
            </Link>
          )}
          {i.mail?.has_attachments && <Paperclip size={11} className="ml-1.5 inline text-text-muted" aria-label="With attachments" />}
          {i.mail && (
            <span className="mt-0.5 block truncate text-[11.5px] text-text-secondary">
              <span className="text-text-muted">to </span>
              {recipientsText(i.mail.to_addrs, 3) || "—"}
              {i.mail.cc_addrs.length > 0 && <span className="text-text-muted"> · cc {recipientsText(i.mail.cc_addrs, 2)}</span>}
              <span className="text-text-muted"> · from {i.mail.mailbox}</span>
            </span>
          )}
        </span>
      </button>
      {open && i.mail && <MailDetail m={i.mail} />}
    </li>
  );
}

function MailDetail({ m }: { m: Pick<MailLogRow, "to_addrs" | "cc_addrs" | "preview" | "mailbox" | "sent_at"> }) {
  const list = (xs: Array<{ name: string; address: string }>) => xs.map((r) => (r.name && r.name !== r.address ? `${r.name} <${r.address}>` : r.address)).join(", ");
  return (
    <div className="border-t border-border bg-surface-2 px-4 py-2.5 text-[12px] leading-relaxed">
      <p>
        <span className="text-text-muted">From </span>
        {m.mailbox}
        <span className="text-text-muted"> · {formatDate(m.sent_at, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</span>
      </p>
      <p className="break-words">
        <span className="text-text-muted">To </span>
        {list(m.to_addrs) || "—"}
      </p>
      {m.cc_addrs.length > 0 && (
        <p className="break-words">
          <span className="text-text-muted">Cc </span>
          {list(m.cc_addrs)}
        </p>
      )}
      {m.preview && <p className="mt-1.5 whitespace-pre-line text-text-secondary">{m.preview}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The whole desk
// ---------------------------------------------------------------------------

function DeskSummary({
  feed,
  rows,
  booked,
  seen,
  personName,
  periodLabel,
}: {
  feed: ActivityItem[];
  rows: Row[];
  booked: Set<string>;
  seen: MailboxSeen[];
  personName: (id: string | null) => string;
  periodLabel: string;
}) {
  const count = (kind: string) => feed.filter((i) => i.kind === kind).length;
  const unclaimed = rows
    .filter((r) => !r.assigned_to && !booked.has(r.ref) && r.status !== "declined" && r.status !== "lost")
    .sort((a, b) => arrivedAt(a).localeCompare(arrivedAt(b)));

  return (
    <div className="space-y-3">
      <p className="hidden text-[12px] text-text-secondary lg:block">Pick a name on the left to see what they did, in sections.</p>

      <section>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">The desk · {periodLabel.toLowerCase()}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Tile label="Mails sent" value={feed.filter((i) => i.source === "mail").length} />
          <Tile label="Enquiries taken on" value={count("assigned")} />
          <Tile label="Quotes sent" value={count("quote_sent")} />
          <Tile label="Booked" value={count("promoted")} />
          <Tile label="Steps done" value={count("step_done")} />
          <Tile label="Unclaimed now" value={unclaimed.length} tone={unclaimed.length ? "warning" : undefined} />
        </div>
      </section>

      <section className="card p-4">
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Nobody has taken these on</h3>
        {!unclaimed.length ? (
          <p className="text-[12px] text-text-muted">Every open enquiry has somebody on it.</p>
        ) : (
          <ul className="divide-y divide-border">
            {unclaimed.map((r) => (
              <li key={r.ref} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-[12px]">
                <EnquiryLink to={`/enquiries/${r.ref}`} className="shrink-0 font-mono text-[11.5px] text-text-accent hover:underline">
                  {r.ref}
                </EnquiryLink>
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  {r.customer?.company || r.customer?.name || "—"}
                  <span className="text-text-secondary"> · {[r.origin, r.destination].filter(Boolean).join(" → ") || "route not captured"}</span>
                </span>
                <span className="shrink-0 text-[11px] text-text-warning">came in {ago(arrivedAt(r))}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MailboxStatus seen={seen} seenBy={personName} />
    </div>
  );
}

function MailboxStatus({ seen, seenBy }: { seen: MailboxSeen[]; seenBy: (id: string | null) => string }) {
  return (
    <section className="rounded-card border border-border bg-surface-1 p-4">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Mailboxes being copied in</h3>
      {!seen.length ? (
        <p className="text-[12px] text-text-muted">None yet. The server checks every CRM login&rsquo;s mailbox every five minutes.</p>
      ) : (
        <ul className="space-y-2 text-[12px]">
          {[...seen]
            .sort((a, b) => a.mailbox.localeCompare(b.mailbox))
            .map((s) => {
              // Not checked for a day: its mail is missing here, whatever the reason.
              const stale = !s.synced_at || Date.now() - Date.parse(s.synced_at) > 86_400_000;
              return (
                <li key={s.mailbox}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-text-primary">{s.mailbox}</span>
                    <span className={stale ? "text-text-warning" : "text-text-muted"}>
                      {!s.synced_at ? "never checked" : `last checked ${ago(s.synced_at)} ${s.synced_by ? `from ${seenBy(s.synced_by)}’s session` : "by the server"}`}
                    </span>
                  </div>
                  {s.server_error && (
                    <p className="mt-0.5 flex items-start gap-1.5 text-[11.5px] text-text-warning">
                      <AlertCircle size={12} className="mt-px shrink-0" />
                      <span>Server copy: {s.server_error}</span>
                    </p>
                  )}
                </li>
              );
            })}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
        Copied from each mailbox&rsquo;s Outlook Sent Items — mail sent from Outlook as well as from the CRM. The server checks every CRM login every five minutes;
        a person&rsquo;s own CRM session also copies theirs just after each send, with Outlook&rsquo;s first lines. Subject and recipients are kept, the body is
        not, and only administrators see other people&rsquo;s mail here.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Tile({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div className="card px-3 py-2.5">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`mt-0.5 text-[20px] font-medium leading-tight tabular-nums ${tone === "warning" ? "text-text-warning" : "text-text-primary"}`}>{value}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        active ? "border-brand bg-brand text-white" : "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
