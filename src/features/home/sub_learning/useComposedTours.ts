import { useEffect, useState } from 'react';
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
 * Athena-composed tours for the Learning timeline. Fetches `companion_tours`
 * (the server re-proves each row against the current anchor manifest and
 * marks drifted ones `stale`), then ingests the ready ones through the SAME
 * frontend validation gate every composed tour passes (`ingestComposedTour`)
 * so only proven tours become playable. Stale/rejected records still render
 * — with an honest "may be outdated" note and no start affordance — instead
 * of silently vanishing or breaking mid-play.
 */
export function useComposedTours(): { entries: ComposedTourEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<ComposedTourEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
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
      })
      .catch(silentCatch('home/sub_learning/useComposedTours:list'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, loading };
}
