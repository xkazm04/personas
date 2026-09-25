import { useEffect, useState } from 'react';
import { readCuratorProcess } from '@/api/companions/curator';
import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';

/**
 * The page's one read. A single-slot module cache keeps the last reading so a remount (the page
 * is a lazy route) paints warm instead of re-ghosting; the read refreshes behind it.
 */
let warm: CuratorProcess | null = null;

/** Seed the warm slot - the shot harness's door, so a screenshot never needs a paired registry. */
export function primeProcessReading(reading: CuratorProcess): void {
  warm = reading;
}

export interface ProcessData {
  reading: CuratorProcess | null;
  loading: boolean;
  error: string | null;
}

export function useProcessData(): ProcessData {
  const [reading, setReading] = useState<CuratorProcess | null>(warm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readCuratorProcess()
      .then((r) => {
        warm = r;
        if (cancelled) return;
        setReading(r);
        setError(null);
      })
      .catch((err: unknown) => {
        // Nobody pressed anything - the read fires on mount - so the failure is reported where
        // the spine would have been, not as a toast. Sentry still gets the event.
        if (!cancelled) setError(resolveError(err instanceof Error ? err.message : String(err)).message);
        silentCatch('curator_process_read')(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { reading, loading, error };
}
