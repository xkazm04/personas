import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listComposedTours,
  ingestComposedTour,
  type ComposedTourRecord,
} from '@/stores/slices/system/dynamicTours';
import { getTourById, type TourDef } from '@/stores/slices/system/tourSlice';
import { silentCatch } from '@/lib/silentCatch';
import { useDismissedComposedTours } from './dismissedComposedTours';

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
  /** What to render — the fetched records minus the ones the user dismissed. */
  entries: ComposedTourEntry[];
  /**
   * How many records the fetch actually returned, dismissals included. An
   * empty `entries` means two different things — "Athena has composed nothing"
   * (`total === 0`) and "everything she composed went stale and you cleared
   * it" — and the second must not render as the first.
   */
  total: number;
  loading: boolean;
  status: ComposedToursStatus;
  /** Re-run the fetch. Drives the retry affordance on the `failed` branch. */
  reload: () => void;
  /** Hide an unplayable tour. Reversed on its own if the tour becomes playable. */
  dismiss: (id: string) => void;
}

/**
 * Athena-composed tours for the Learning timeline. Fetches `companion_tours`
 * (the server re-proves each row against the current anchor manifest and
 * marks drifted ones `stale`), then ingests the ready ones through the SAME
 * frontend validation gate every composed tour passes (`ingestComposedTour`)
 * so only proven tours become playable. Stale/rejected records still render
 * — with an honest "may be outdated" note and no start affordance — instead
 * of silently vanishing or breaking mid-play — but they are dismissible, so
 * the list cannot grow into a permanent pile of dimmed cards the user has no
 * way to clear (see `dismissedComposedTours.ts`).
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

  const dismissed = useDismissedComposedTours((s) => s.dismissed);
  const dismiss = useDismissedComposedTours((s) => s.dismiss);

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
        // Read through getState() rather than closing over `prune`: this is a
        // fire-once side effect of the fetch, and taking the action as a dep
        // would make the fetch effect re-run on any store identity change.
        useDismissedComposedTours.getState().prune(records.map((r) => r.id));
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

  // A dismissal is honoured only while the entry is still unplayable. If the
  // anchors come back (or Athena recomposes the tour) the server marks it
  // `ready` again, re-validation produces a def, and the card returns without
  // the user having to remember they hid it.
  const visible = useMemo(
    () => entries.filter((entry) => entry.def !== null || !dismissed[entry.record.id]),
    [entries, dismissed],
  );

  return {
    entries: visible,
    total: entries.length,
    loading: status === 'loading',
    status,
    reload,
    dismiss,
  };
}
