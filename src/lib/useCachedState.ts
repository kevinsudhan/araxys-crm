import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { peek, put } from "./queryCache";

/**
 * A page's state, kept when the page is left (lib/queryCache): opened again,
 * it shows what it showed last at once and reads again behind it, instead of
 * a skeleton while it waits for the database (6 Oct).
 *
 * `key` names the page and what it is of — "enquiries:board", "case:ALG10001-26"
 * — so two pages, or two jobs, never share one.
 *
 * The third value says whether the page has been read before: a list read
 * and found empty is shown as empty at once (its "none yet"), and only a page
 * never read shows the skeleton. Nothing is kept until the page has been read
 * — the empty starting value is not a reading.
 */
export function useCachedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>, boolean] {
  const start = useRef(initial);
  const [value, setValue] = useState<T>(() => {
    const hit = peek<T>(key);
    return hit === undefined ? initial : hit;
  });
  const [known, setKnown] = useState(() => peek<T>(key) !== undefined);
  // The page's key can change under it (another case file opened in place): take that one's.
  const [at, setAt] = useState(key);
  if (at !== key) {
    setAt(key);
    const hit = peek<T>(key);
    setValue(hit === undefined ? start.current : hit);
    setKnown(hit !== undefined);
  }
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setKnown(true);
    setValue(next);
  }, []);
  useEffect(() => {
    if (known) put(key, value);
  }, [key, value, known]);
  return [value, set, known];
}

/** The same, for a Map — kept as its entries, since a Map does not survive JSON. */
export function useCachedMap<K, V>(key: string): [Map<K, V>, (next: Map<K, V> | ((prev: Map<K, V>) => Map<K, V>)) => void, boolean] {
  const [entries, setEntries, known] = useCachedState<Array<[K, V]>>(key, []);
  const map = useMemo(() => new Map(entries), [entries]);
  const set = useCallback(
    (next: Map<K, V> | ((prev: Map<K, V>) => Map<K, V>)) =>
      setEntries((prev) => [...(typeof next === "function" ? next(new Map(prev)) : next).entries()]),
    [setEntries]
  );
  return [map, set, known];
}
