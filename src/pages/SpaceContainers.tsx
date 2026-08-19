import { useEffect, useState } from "react";
import { Boxes, Check, X, Loader2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import StatusPill from "../components/StatusPill";
import ContainerPlanView from "../components/ContainerPlanView";
import {
  getSpaceSlots,
  checkSpace,
  bookSpace,
  type SpaceSlot,
  type CheckSpaceResponse,
} from "../services/backend";

const statusTone = { open: "success", closing_soon: "warning", full: "danger" } as const;

function FillBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="w-36">
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full ${pct >= 100 ? "bg-text-danger" : pct >= 85 ? "bg-text-warning" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-text-secondary mt-1">{pct}% full</p>
    </div>
  );
}

export default function SpaceContainers() {
  const [slots, setSlots] = useState<SpaceSlot[]>([]);
  const [offline, setOffline] = useState(false);

  const [openSlotId, setOpenSlotId] = useState<string | null>(null);

  const [form, setForm] = useState({
    route: "Chennai -> Singapore",
    sailing_date: "2026-08-20",
    client_name: "Meera Textiles",
    length_cm: 120,
    width_cm: 100,
    height_cm: 110,
    quantity: 10,
    weight_kg_each: 180,
    stackable: true,
    upright_only: false,
  });
  const [result, setResult] = useState<CheckSpaceResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [booking, setBooking] = useState(false);

  async function refresh() {
    try {
      const d = await getSpaceSlots();
      setSlots(d.slots);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCheck() {
    setChecking(true);
    setResult(null);
    try {
      setResult(await checkSpace(form));
    } catch (e) {
      setResult({ available: false, spoken_answer: `Couldn't reach the space service: ${e}` });
    } finally {
      setChecking(false);
    }
  }

  async function onBook() {
    if (!result?.slot_id) return;
    const slotId = result.slot_id;
    setBooking(true);
    try {
      await bookSpace({
        slot_id: slotId,
        client_name: form.client_name || "Unnamed client",
        reference: `ARX-${Date.now().toString(36).toUpperCase()}`,
        length_cm: form.length_cm,
        width_cm: form.width_cm,
        height_cm: form.height_cm,
        quantity: form.quantity,
        weight_kg_each: form.weight_kg_each,
        stackable: form.stackable,
        upright_only: form.upright_only,
        source: "crm",
      });
      await refresh();
      setResult(null);
      setOpenSlotId(slotId); // show the customer where their cargo actually landed
    } catch (e) {
      setResult({ ...result, spoken_answer: `Booking failed: ${e}` });
    } finally {
      setBooking(false);
    }
  }

  const routes = [...new Set(slots.map((s) => s.route))];

  return (
    <div>
      <PageHeader
        title="Space & containers"
        subtitle="Live remaining space per sailing, checked in three dimensions — the same service the voice agent queries mid-call."
        action={
          offline ? <StatusPill tone="danger">backend offline</StatusPill> : <StatusPill tone="success">live</StatusPill>
        }
      />

      <div className="rounded-card bg-surface-1 border border-border p-4 mb-5">
        <p className="text-sm font-medium text-text-primary mb-3 flex items-center gap-1.5">
          <Boxes size={14} /> Will it fit?
        </p>

        <div className="grid grid-cols-4 gap-3 mb-3">
          <label className="col-span-2 text-xs text-text-secondary">
            Route
            <select
              className="w-full mt-1"
              value={form.route}
              onChange={(e) => setForm({ ...form, route: e.target.value })}
            >
              {routes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-text-secondary">
            Sailing date
            <input
              className="w-full mt-1"
              value={form.sailing_date}
              onChange={(e) => setForm({ ...form, sailing_date: e.target.value })}
            />
          </label>
          <label className="text-xs text-text-secondary">
            Quantity
            <input
              type="number"
              className="w-full mt-1"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-3">
          <label className="col-span-2 text-xs text-text-secondary">
            Client
            <input
              className="w-full mt-1"
              value={form.client_name}
              onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            />
          </label>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-3">
          {(["length_cm", "width_cm", "height_cm", "weight_kg_each"] as const).map((k) => (
            <label key={k} className="text-xs text-text-secondary">
              {k === "weight_kg_each" ? "Weight each (kg)" : `${k.split("_")[0]} (cm)`}
              <input
                type="number"
                className="w-full mt-1"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>

        <div className="flex items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={form.stackable}
              onChange={(e) => setForm({ ...form, stackable: e.target.checked })}
            />
            Stackable
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={form.upright_only}
              onChange={(e) => setForm({ ...form, upright_only: e.target.checked })}
            />
            This way up (can't be laid down)
          </label>
          <button
            onClick={onCheck}
            disabled={checking}
            className="ml-auto text-xs px-3 py-2 rounded-lg border border-border-strong hover:bg-surface-2 text-text-primary flex items-center gap-1.5"
          >
            {checking && <Loader2 size={13} className="animate-spin" />} Check space
          </button>
        </div>

        {result && (
          <div
            className={`rounded-card px-4 py-3 ${result.available ? "bg-bg-success" : "bg-bg-danger"}`}
          >
            <p
              className={`text-[13px] font-medium flex items-center gap-1.5 ${
                result.available ? "text-text-success" : "text-text-danger"
              }`}
            >
              {result.available ? <Check size={14} /> : <X size={14} />}
              {result.available ? "Space available" : "Won't fit"}
            </p>
            <p className={`text-[13px] mt-1 ${result.available ? "text-text-success" : "text-text-danger"}`}>
              {result.spoken_answer}
            </p>

            {result.loading_plan && (
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-text-success">
                <span>{result.loading_plan.across} across</span>
                <span>{result.loading_plan.high} high</span>
                <span>{result.loading_plan.rows} rows</span>
                <span>{result.loading_plan.floor_length_needed_m}m floor</span>
                <span>{result.loading_plan.total_weight_kg}kg</span>
              </div>
            )}

            {result.available && result.slot_id && (
              <button
                onClick={onBook}
                disabled={booking}
                className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-border-strong bg-surface-1 hover:bg-surface-2 text-text-primary flex items-center gap-1.5"
              >
                {booking && <Loader2 size={13} className="animate-spin" />}
                Commit this space to {result.slot_id}
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-sm font-medium text-text-primary mb-2">Sailings</p>
      <div className="rounded-card bg-surface-1 border border-border overflow-hidden">
        <table className="w-full text-[13px]" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-secondary">
              <th className="px-4 py-2.5">Route</th>
              <th className="px-4 py-2.5 w-24">Sailing</th>
              <th className="px-4 py-2.5 w-20">Box</th>
              <th className="px-4 py-2.5 w-40">Utilisation</th>
              <th className="px-4 py-2.5 w-32">Floor left</th>
              <th className="px-4 py-2.5 w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr
                key={s.id}
                onClick={() => setOpenSlotId(s.id)}
                className="border-b border-border last:border-0 cursor-pointer hover:bg-surface-2"
              >
                <td className="px-4 py-2.5 text-text-primary">
                  {s.route}
                  <span className="text-text-muted"> · {s.carrier}</span>
                  {s.consignmentCount > 0 && (
                    <span className="text-text-muted"> · {s.consignmentCount} clients</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{s.sailingDate}</td>
                <td className="px-4 py-2.5 font-mono text-text-primary">{s.containerCode}</td>
                <td className="px-4 py-2.5">
                  {s.internal && <FillBar used={s.usedLengthM} total={s.internal.lengthM} />}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">
                  {s.remaining ? (
                    <>
                      {s.remaining.lengthM}m
                      <span className="text-text-muted"> · {s.remaining.cbm} CBM</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill tone={statusTone[s.status]}>{s.status.replace("_", " ")}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted mt-2">Click any sailing to see the load plan inside that container.</p>

      {offline && (
        <p className="text-xs text-text-muted mt-3">
          Start the backend with <code>npm run server</code> to see live space data.
        </p>
      )}

      {openSlotId && (
        <ContainerPlanView
          slotId={openSlotId}
          onClose={() => {
            setOpenSlotId(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
