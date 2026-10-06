import { useState, type InputHTMLAttributes } from "react";
import { parseFigure } from "../lib/figures";

/**
 * A box for a figure that counts as it is typed (the totals beside it move),
 * without losing what is being typed.
 *
 * A box whose text is the number itself drops a decimal point the moment it
 * is typed: "1150." is the number 1150, written back as "1150", and the next
 * key makes 11505. This keeps the text as typed while the box has the
 * cursor, passes up each whole figure as it forms, and shows the figure
 * itself again once the cursor leaves. Commas are fine: "1,150.50".
 */
export default function FigureInput({
  value,
  onValue,
  allowNegative = false,
  blankZero = false,
  ...rest
}: {
  value: number | null | undefined;
  onValue: (n: number) => void;
  /** A discount or a credit can be less than nothing. */
  allowNegative?: boolean;
  /** Nought shown as an empty box, for a figure still to be given (a rate of exchange). */
  blankZero?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue">) {
  /** What is being typed, while the box has the cursor. */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null || value === undefined || !Number.isFinite(value) || (value === 0 && blankZero) ? "" : String(value));

  return (
    <input
      {...rest}
      inputMode="decimal"
      value={shown}
      onFocus={(e) => {
        setDraft(shown);
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (t.trim() === "") return onValue(0);
        const n = parseFigure(t);
        if (n !== null && (allowNegative || n >= 0)) onValue(n);
      }}
      onBlur={(e) => {
        setDraft(null);
        rest.onBlur?.(e);
      }}
    />
  );
}
