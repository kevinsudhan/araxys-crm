import { Fragment } from "react";
import { splitHighlights } from "../lib/searchHighlight";

/** Text with the words searched for marked, as Outlook marks them. Plain text without terms. */
export default function Highlighted({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms?.length || !text) return <>{text}</>;
  return (
    <>
      {splitHighlights(text, terms).map((p, i) =>
        p.hit ? (
          <mark key={i} className="search-hit">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}
