import { useEffect, useRef, useState } from 'react';

/** How long a flight stays in the air, and a receiver's plaque reads "New from <sender>". */
export const FLIGHT_MS = 4000;

/** Items whose key was not seen before. The first call only records what is already there. */
export function freshSince<T>(seen: Set<string> | null, items: T[], key: (t: T) => string): { seen: Set<string>; fresh: T[] } {
  if (seen === null) return { seen: new Set(items.map(key)), fresh: [] };
  const fresh = items.filter((t) => !seen.has(key(t)));
  for (const t of fresh) seen.add(key(t));
  return { seen, fresh };
}

/** Items that arrived after the first poll, each kept for `ttlMs` (one flight, one plaque). */
export function useFresh<T>(items: T[] | undefined, key: (t: T) => string, ttlMs: number): T[] {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [live, setLive] = useState<T[]>([]);

  useEffect(() => {
    if (!items) return;
    const r = freshSince(seen.current, items, key);
    seen.current = r.seen;
    if (r.fresh.length === 0) return;
    for (const t of r.fresh) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setLive((list) => list.filter((x) => key(x) !== key(t)));
      }, ttlMs);
      timers.current.add(timer);
    }
    setLive((list) => [...list, ...r.fresh]);
    // `key` is a module-level function at every call site.
  }, [items, ttlMs]);

  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);
  return live;
}

const REDUCED = '(prefers-reduced-motion: reduce)';

/** True while the visitor asks for reduced motion. */
export function useReducedMotion(): boolean {
  const [still, setStill] = useState(() => window.matchMedia(REDUCED).matches);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED);
    const on = () => setStill(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return still;
}
