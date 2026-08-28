import { useCallback, useEffect, useState } from 'react';
import {
  listComposedTours,
  ingestComposedTour,
  type ComposedTourRecord,
} from '@/stores/slices/system/dynamicTours';
import { getTourById, type TourDef } from '@/stores/slices/system/tourSlice';
import { silentCatch } from '@/lib/silentCatch';

export interface ComposedTourEntry {
  record: ComposedTourRecord;
  /** Playable def — null when the record is stale or failed re-validation. */
  def: TourDef | null;
}

/**
 * Where the composed-tour fetch stands.
 *
 * - `loading` — the request is in flight.
 * - `loaded`  — the request settled; `entries` is the authoritative answer,
 *               and an empty list genuinely means "nothing composed yet".
 * - `failed`  — the request rejected. `entries` is empty for a reason the
 *               user must be told about, because an empty list and a broken
 *               `companion_tours` command otherwise render identically.
 */
export type ComposedToursStatus = 'loading' | 'loaded' | 'failed';

export interface UseComposedTours {
  entries: ComposedTourEntry[];
  loading: boolean;
  status: ComposedToursStatus;
  /** Re-run the fetch. Drives the retry affordance on the `failed` branch. */
  reload: () => void;
}

/**
 * Athena-composed tours for the Learning timeline. Fetches `companion_tours`
 * (the server re-proves each row against the current anchor manifest and
 * marks drifted ones `stale`), then ingests the ready ones through the SAME
 * frontend validation gate every composed tour passes (`ingestComposedTour`)
 * so only proven tours become playable. Stale/rejected records still render
 * — with an honest "may be outdated" note and no start affordance — instead
 * of silently vanishing or breaking mid-play.
 *
 * A rejected fetch is reported as `failed` rather than folded into the empty
 * list: routing the error to `silentCatch` alone left the view showing the
 * "none composed yet" hint, so a broken IPC command read to the user as
 * "Athena has not composed anything for you". Same posture as the live-roadmap
 * freshness pill, which surfaces a failed refresh instead of leaving a healthy
 * label in place.
 */
export function useComposedTours(): UseComposedTours {
  const [entries, setEntries] = useState<ComposedTourEntry[]>([]);
  const [status, setStatus] = useState<ComposedToursStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    listComposedTours()
      .then((records) => {
        if (cancelled) return;
        setEntries(
          records.map((record) => {
            if (record.status !== 'ready') return { record, def: null };
            const id = ingestComposedTour(record);
            return { record, def: id ? (getTourById(id) ?? null) : null };
          }),
        );
        setStatus('loaded');
      })
      .catch((err: unknown) => {
        silentCatch('home/sub_learning/useComposedTours:list')(err);
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { entries, loading: status === 'loading', status, reload };
}
