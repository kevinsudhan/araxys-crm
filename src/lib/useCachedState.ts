import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { peek, put } from "./queryCache";

/**
 * A page's state, kept when the page is left (lib/queryCache): opened again,
 * it shows what it showed last at once and reads again behind it, instead of
 * a skeleton while it waits for the database (6 Oct).
 *
 * `key` names the page and what it is of — "enquiries:board", "case:ALG10001-26"
 * — so two pages, or two jobs, never share one.
 */
export function useCachedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const hit = peek<T>(key);
    return hit === undefined ? initial : hit;
  });
  // The page's key can change under it (another case file opened in place): take that one's.
  const [at, setAt] = useState(key);
  if (at !== key) {
    setAt(key);
    const hit = peek<T>(key);
    setValue(hit === undefined ? initial : hit);
  }
  useEffect(() => {
    put(key, value);
  }, [key, value]);
  return [value, setValue];
}

/** The same, for a Map — kept as its entries, since a Map does not survive JSON. */
export function useCachedMap<K, V>(key: string): [Map<K, V>, (next: Map<K, V> | ((prev: Map<K, V>) => Map<K, V>)) => void] {
  const [entries, setEntries] = useCachedState<Array<[K, V]>>(key, []);
  const map = useMemo(() => new Map(entries), [entries]);
  const set = useCallback(
    (next: Map<K, V> | ((prev: Map<K, V>) => Map<K, V>)) =>
      setEntries((prev) => [...(typeof next === "function" ? next(new Map(prev)) : next).entries()]),
    [setEntries]
  );
  return [map, set];
}
