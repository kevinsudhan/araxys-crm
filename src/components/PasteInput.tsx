import { useMemo, useState } from "react";
import { tableRows, tableTextFromHtml } from "../lib/pastedTable";

/**
 * Where a rate is pasted: on the quotation itself, where pasting is the way a
 * quotation starts, and in "Paste a quotation".
 *
 * A table copied from a mail or a sheet is taken as its rows, not as the
 * cell-per-line text Gmail puts beside it (lib/pastedTable), and shown as the
 * table it was. Anything else is text, as typed.
 */
export default function PasteInput({
  value,
  onChange,
  air,
  rows = 14,
  autoFocus,
}: {
  value: string;
  onChange: (text: string) => void;
  /** An air enquiry: the example in the empty box is an air rate. */
  air: boolean;
  rows?: number;
  autoFocus?: boolean;
}) {
  /** A pasted table is shown as one; this shows its text instead, for editing. */
  const [asText, setAsText] = useState(false);
  const grid = useMemo(() => tableRows(value), [value]);
  const width = Math.max(1, ...(grid ?? []).map((r) => r.length));

  if (grid && !asText) {
    return (
      <div>
        <div className="max-h-[22rem] overflow-auto rounded-lg border border-border bg-white">
          <table className="w-full border-collapse text-[12px] text-text-primary">
            <tbody>
              {grid.map((cells, r) => (
                <tr key={r}>
                  {cells.map((c, k) => (
                    <td
                      key={k}
                      colSpan={cells.length === 1 ? width : 1}
                      className={`border border-border px-2 py-1 align-top ${/^[\d.,\s%-]+$/.test(c) && c.trim() ? "text-right tabular-nums" : ""} ${cells.length === 1 && c === c.toUpperCase() ? "font-semibold" : ""}`}
                    >
                      {c}
                    </td>
                  ))}
                  {/* A row whose last cells were empty keeps its columns under the others. */}
                  {cells.length > 1 && Array.from({ length: width - cells.length }, (_, k) => <td key={`pad${k}`} className="border border-border" />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[11.5px]">
          <span className="text-text-muted">Pasted as a table, {grid.length} rows.</span>
          <button type="button" onClick={() => setAsText(true)} className="text-text-accent hover:underline">
            Edit as text
          </button>
          <button type="button" onClick={() => onChange("")} className="text-text-accent hover:underline">
            Paste something else
          </button>
        </div>
      </div>
    );
  }

  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => {
        const table = tableTextFromHtml(e.clipboardData.getData("text/html"));
        if (!table) return;
        e.preventDefault();
        const el = e.currentTarget;
        const before = value.slice(0, el.selectionStart);
        const after = value.slice(el.selectionEnd);
        // On lines of its own, wherever in the text it lands.
        onChange(`${before}${before && !before.endsWith("\n") ? "\n" : ""}${table}${after && !after.startsWith("\n") ? "\n" : ""}${after}`);
        setAsText(false);
      }}
      autoFocus={autoFocus}
      rows={rows}
      aria-label="The rate, as pasted"
      placeholder={
        air
          ? "HEL - IST - MAA, carrier TK, TT 2-3 days\nAF EUR 3.20/kg\nEXW EUR 795/shpt\nCC charges 3% on OF+EXW\nDO INR 2,500\nAirline DO at receipted\nROE 1 EUR = 111.70"
          : "EXW charges\nPickup from factory – INR 4,500\nExport customs clearance – 2,500\n\nOcean freight USD 1,150 per 40HC × 2\nBL fee 1,500 per BL\n\nValidity 15 days. Duties extra."
      }
      className="w-full resize-y font-mono text-[12.5px] leading-relaxed"
    />
  );
}
