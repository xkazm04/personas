import { useState, useCallback, useEffect, useRef } from 'react';
import { countDesignReviews } from "@/api/design/reviewCounts";

import { seedCatalogTemplatesOnce } from '@/lib/personas/templates/seedTemplates';
import { invalidateTemplateCatalog } from '@/lib/personas/templates/templateCatalog';
import { createSWRFetcher, invalidateSWRCache } from '@/lib/utils/staleWhileRevalidate';
import { extractMessage, silentCatch } from '@/lib/silentCatch';


const COUNT_SWR_KEY = 'design-reviews-count';
const fetchReviewCountSWR = createSWRFetcher(COUNT_SWR_KEY, () => countDesignReviews());

/** Progress of a design-review generation run, rendered by DesignReviewRunner. */
export interface RunProgress {
  current: number;
  total: number;
  startedAt: number;
  currentTemplateName: string;
}

/**
 * The Templates page header's view of the design-review catalog: seeds the
 * catalog templates once, then reports the TRUE row count.
 *
 * The hook used to also hold a capped page of review rows, a connector
 * filter, a review-run listener and a delete action. Its one caller
 * (DesignReviewsPage) read none of them, so every page mount paid two
 * `list_design_reviews` round-trips of up to 50 full rows for no reader.
 * Lists live in useGalleryQuery; deletes in useGalleryActions.
 */
export function useDesignReviews() {
  // `null` until the count query answers — callers render a placeholder
  // rather than a number that would be wrong.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seedDoneRef = useRef(false);

  /**
   * Fetch the true row count (one indexed aggregate). `force` drops the SWR
   * cache first, for the moments the total is known to have moved.
   */
  const loadCount = useCallback(async (force: boolean) => {
    if (force) invalidateSWRCache(COUNT_SWR_KEY);
    const { data, fromCache } = await fetchReviewCountSWR();
    setTotalCount(data);
    setError(null);
    return fromCache;
  }, []);

  /** Recount after a change elsewhere. A failure leaves the last real number. */
  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await loadCount(true);
    } catch (err) {
      setError(extractMessage(err) || 'Failed to fetch reviews');
    } finally {
      setIsLoading(false);
    }
  }, [loadCount]);

  // Seed catalog templates into the database on mount.
  //
  // In production builds we gate with `seedDoneRef` so we only re-seed once
  // per component mount. In dev we also force-invalidate the in-memory
  // template catalog cache so edits to template JSON files (e.g. adding
  // `allow_custom: true` to a question) flow through to the DB after a
  // hot reload — without this, `_cached` in templateCatalog.ts would serve
  // stale content and the seed upsert would re-write the same old JSON.
  const seedCatalogTemplates = useCallback(async () => {
    if (seedDoneRef.current) return;
    seedDoneRef.current = true;

    if (import.meta.env.DEV) {
      invalidateTemplateCatalog();
    }

    try {
      // Shared session-scoped runner: idempotent upsert + stale-seed prune.
      // May already have run at app-init (App.tsx bootstrap) — the runner's
      // own guard short-circuits. `force` in dev re-seeds so hot-reloaded
      // template JSON flows through.
      await seedCatalogTemplatesOnce({ force: import.meta.env.DEV });
      // Seeding is exactly when the total moves — recount, or the header
      // keeps reporting the pre-seed number.
      await loadCount(true);
    } catch (err) { silentCatch("hooks/design/template/useDesignReviews:seed")(err); }
  }, [loadCount]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        // SWR: a cached count renders instantly; the seed then recounts.
        const fromCache = await loadCount(false);
        if (cancelled) return;
        if (!fromCache) {
          await seedCatalogTemplates();
        } else {
          void seedCatalogTemplates();
        }
      } catch (err) {
        if (!cancelled) setError(extractMessage(err) || 'Failed to fetch reviews');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [seedCatalogTemplates, loadCount]);

  return {
    /**
     * The TRUE number of design reviews in the database, from a dedicated
     * count query — `null` while it is still in flight.
     */
    totalCount,
    isLoading,
    error,
    refresh,
  };
}
