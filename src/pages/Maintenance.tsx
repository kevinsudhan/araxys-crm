import { Wrench } from "lucide-react";
import { PoweredByAraxys } from "../components/Brand";

/**
 * What every screen of the desk shows while `VITE_MAINTENANCE` is on (29 Sep
 * 2026: large changes under way). The customers' quotation and tracking pages
 * are not behind it — see App.tsx.
 *
 * Drawn without the database or the session, so it shows whatever state they
 * are in.
 */
export default function Maintenance() {
  return (
    <main className="screen-min grid place-items-center bg-surface-0 px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <img
          src="/media/mark-v1.webp"
          alt=""
          className="h-16 w-16 rounded-[24%] object-cover shadow-[0_10px_24px_-10px_rgba(15,33,58,0.6)]"
        />
        <p className="mt-4 text-[13px] font-medium tracking-wide text-text-secondary">Aashish Logistics Global</p>

        <div className="card mt-8 w-full px-6 py-7">
          <span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-bg-warning text-text-warning">
            <Wrench size={20} />
          </span>
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-text-primary">Under maintenance</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
            Big changes are being made to the CRM. It will be back shortly — thank you for your patience.
          </p>
          <p className="mt-4 text-[12px] text-text-muted">
            Your enquiries, shipments and mail are safe. Nothing needs to be done on your side.
          </p>
        </div>

        <PoweredByAraxys stacked className="mt-10" />
      </div>
    </main>
  );
}
