/**
 * useLoadSettled — has the read asked for under `key` actually landed?
 *
 * The roster's sources start with `loading: false` and flip it on in their own
 * fetch effects, so the first frame after a chip is asked for reads "not
 * loading, nothing there" — and an empty band painted on that frame is the
 * confident lie loading pattern v2 forbids. Settled means: loading was seen and
 * has ended, or loading never started within a short grace (a warm source that
 * had nothing to fetch).
 */
import { useEffect, useRef, useState } from 'react';

const WARM_GRACE_MS = 400;

export function useLoadSettled(key: string | null, loading: boolean): boolean {
  const [settled, setSettled] = useState<string | null>(null);
  const seen = useRef<{ key: string | null; loading: boolean }>({ key: null, loading: false });

  useEffect(() => {
    if (seen.current.key !== key) seen.current = { key, loading: false };
    if (key === null) {
      // Closed: the next open of the same key earns its own settle.
      setSettled(null);
      return;
    }
    if (loading) {
      seen.current.loading = true;
      return;
    }
    if (seen.current.loading) {
      setSettled(key);
      return;
    }
    const timer = setTimeout(() => setSettled(key), WARM_GRACE_MS);
    return () => clearTimeout(timer);
  }, [key, loading]);

  return key !== null && settled === key;
}
