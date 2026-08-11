import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { cancelDesignReviewRun, deleteDesignReview, listDesignReviews, startDesignReviewRun } from "@/api/overview/reviews";
import { countDesignReviews } from "@/api/design/reviewCounts";

import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { seedCatalogTemplatesOnce } from '@/lib/personas/templates/seedTemplates';
import { invalidateTemplateCatalog } from '@/lib/personas/templates/templateCatalog';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { createSWRFetcher, invalidateSWRCache } from '@/lib/utils/staleWhileRevalidate';
import { silentCatch } from '@/lib/silentCatch';


const SWR_KEY = 'design-reviews';

/**
 * How many review rows this hook keeps in memory.
 *
 * This is a DELIBERATE cap, stated here rather than inherited by accident:
 * `listDesignReviews()` with no argument silently took the backend's
 * `limit.unwrap_or(50)`, which is how `reviews.length` came to be rendered as
 * a total for a catalog of 124+ seeded templates. The cap stays — nothing
 * renders this array, it only feeds derived facts — but the TOTAL now comes
 * from a dedicated count query (`totalCount`), never from `reviews.length`.
 */
export const REVIEW_LIST_LIMIT = 50;

const fetchReviewsSWR = createSWRFetcher(SWR_KEY, () =>
  listDesignReviews(undefined, REVIEW_LIST_LIMIT),
);

const COUNT_SWR_KEY = 'design-reviews-count';
const fetchReviewCountSWR = createSWRFetcher(COUNT_SWR_KEY, () => countDesignReviews());

interface ReviewStatusPayload {
  run_id: string;
  test_case_index: number;
  total: number;
  status: string;
  test_case_name: string;
  error_message?: string;
  elapsed_ms?: number;
}

interface TestRunResult {
  testRunId: string;
  totalTests: number;
  passed: number;
  failed: number;
  errored: number;
}

export interface RunProgress {
  current: number;
  total: number;
  startedAt: number;
  currentTemplateName: string;
}

export function useDesignReviews() {
  const [reviews, setReviews] = useState<PersonaDesignReview[]>([]);
  // `null` until the count query answers — callers render a placeholder
  // rather than a number that would be wrong.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runLines, setRunLines] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<TestRunResult | null>(null);
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null);
  const [connectorFilter, setConnectorFilter] = useState<string[]>([]);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const countersRef = useRef({ passed: 0, failed: 0, errored: 0 });
  const currentRunId = useRef<string | null>(null);

  /**
   * Refresh the true row count. Cheap (one indexed aggregate), so it runs
   * alongside every list fetch rather than being wired to its own trigger —
   * a count that lags the list is the same class of lie as a capped one.
   * Failures leave `totalCount` alone: a stale-but-real number beats
   * reverting to the page length.
   */
  const refreshCount = useCallback(async () => {
    invalidateSWRCache(COUNT_SWR_KEY);
    try {
      const { data } = await fetchReviewCountSWR();
      setTotalCount(data);
    } catch (err) { silentCatch("hooks/design/template/useDesignReviews:count")(err); }
  }, []);

  // Derive unique connectors from review data.
  // NOTE: derived from the capped `reviews` page, so this is a SAMPLE of the
  // connector vocabulary, not the whole of it. Nothing consumes it today; a
  // future consumer that needs completeness must query the backend
  // (`list_review_connectors`) rather than widen this cap.
  const availableConnectors = useMemo(() => {
    const connectorSet = new Set<string>();
    for (const review of reviews) {
      const connectors = parseJsonOrDefault<string[]>(review.connectors_used, []);
      connectors.forEach((c) => connectorSet.add(c));
    }
    return Array.from(connectorSet).sort();
  }, [reviews]);

  const refresh = useCallback(async () => {
    // Invalidate cache so the next SWR fetch is forced
    invalidateSWRCache(SWR_KEY);
    setIsLoading(true);
    try {
      const { data } = await fetchReviewsSWR();
      setReviews(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reviews');
    } finally {
      setIsLoading(false);
    }
    void refreshCount();
  }, [refreshCount]);

  const seedDoneRef = useRef(false);

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

    // Dev-mode: drop the Vite glob cache so each mount re-parses template
    // JSON from disk. Cheap — the glob itself is still statically resolved,
    // only the parsed objects get refreshed.
    if (import.meta.env.DEV) {
      invalidateTemplateCatalog();
    }

    try {
      // Shared session-scoped runner: idempotent upsert + stale-seed prune.
      // May already have run at app-init (App.tsx bootstrap) — the runner's
      // own guard short-circuits, and we still re-fetch below to surface the
      // seeded rows into this hook's local state. `force` in dev re-seeds so
      // hot-reloaded template JSON flows through.
      await seedCatalogTemplatesOnce({ force: import.meta.env.DEV });

      // Invalidate cache and re-fetch to include seeded records (and reflect deletions)
      invalidateSWRCache(SWR_KEY);
      const { data } = await fetchReviewsSWR();
      setReviews(data);
      // Seeding is exactly when the total moves — recount, or the header
      // keeps reporting the pre-seed number.
      await refreshCount();
    } catch (err) { silentCatch("hooks/design/template/useDesignReviews:catch1")(err); }
  }, [refreshCount]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        // SWR: returns cached data instantly if available, revalidates in background
        const { data, fromCache } = await fetchReviewsSWR();
        if (cancelled) return;
        setReviews(data);
        void refreshCount();

        // Only seed on first real fetch, not from stale cache
        if (!fromCache) {
          await seedCatalogTemplates();
        } else {
          // Data shown from cache — kick off seed in background, then refresh
          seedCatalogTemplates().then(() => {
            if (!cancelled) {
              // After seeding, do a background revalidation
              invalidateSWRCache(SWR_KEY);
              fetchReviewsSWR().then(({ data: fresh }) => {
                if (!cancelled) setReviews(fresh);
              }).catch(silentCatch("hooks/design/template/useDesignReviews:catch3"));
            }
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch reviews');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [seedCatalogTemplates, refreshCount]);

  const startNewReview = useCallback(async (personaId?: string, testCases?: object[]) => {
    if (!personaId) {
      setError('No persona selected for review');
      return;
    }

    setError(null);
    setIsRunning(true);
    setRunLines([]);
    setRunResult(null);
    setRunProgress(null);
    countersRef.current = { passed: 0, failed: 0, errored: 0 };

    try {
      // Clean up any previous listener
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      // Start the run FIRST to get the authoritative run_id.  This prevents
      // stale events from a previous run latching currentRunId to the wrong
      // value.  Any events emitted during the invoke round-trip are buffered
      // by Tauri and delivered once the listener is registered below.
      const result = await startDesignReviewRun(personaId, testCases ?? []);
      currentRunId.current = result.run_id;

      unlistenRef.current = await listen<ReviewStatusPayload>(EventName.DESIGN_REVIEW_STATUS, (event) => {
        const { status, test_case_name, test_case_index, total, run_id, error_message, elapsed_ms } = event.payload;

        // Only process events for the current run
        if (run_id !== currentRunId.current) {
          return;
        }

        if ((status === 'completed' || status === 'cancelled') && test_case_index === total) {
          setIsRunning(false);
          setRunProgress(null);
          currentRunId.current = null;
          setRunResult({
            testRunId: run_id,
            totalTests: total,
            ...countersRef.current,
          });
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
          refresh();
        } else if (status === 'generating') {
          // Template is being generated -- update progress with template name
          setRunProgress((prev) => ({
            current: test_case_index,
            total,
            startedAt: prev?.startedAt ?? Date.now(),
            currentTemplateName: test_case_name,
          }));
          setRunLines((prev) => [
            ...prev,
            `[${test_case_index + 1}/${total}] Generating: ${test_case_name}...`,
          ]);
        } else if (status === 'cancelled') {
          setRunLines((prev) => [...prev, `[Cancelled by user]`]);
          setIsRunning(false);
          setRunProgress(null);
          currentRunId.current = null;
          if (unlistenRef.current) {
            unlistenRef.current();
            unlistenRef.current = null;
          }
          refresh();
        } else {
          // passed, failed, error
          if (status === 'passed') countersRef.current.passed++;
          else if (status === 'failed') countersRef.current.failed++;
          else if (status === 'error') countersRef.current.errored++;

          const elapsedStr = elapsed_ms ? ` (${(elapsed_ms / 1000).toFixed(1)}s)` : '';
          const errorStr = error_message ? ` -- ${error_message}` : '';
          setRunProgress((prev) => ({
            current: test_case_index + 1,
            total,
            startedAt: prev?.startedAt ?? Date.now(),
            currentTemplateName: test_case_name,
          }));
          setRunLines((prev) => [
            ...prev,
            `[${test_case_index + 1}/${total}] ${test_case_name}: ${status.toUpperCase()}${elapsedStr}${errorStr}`,
          ]);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start review run');
      setIsRunning(false);
    }
  }, [refresh]);

  const cancelReview = useCallback(async () => {
    // Signal backend to stop processing
    if (currentRunId.current) {
      try {
        await cancelDesignReviewRun(currentRunId.current);
      } catch (err) { silentCatch("hooks/design/template/useDesignReviews:catch2")(err); }
    }
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    setIsRunning(false);
    setRunProgress(null);
    currentRunId.current = null;
    setRunLines((prev) => [...prev, '[Cancelled by user]']);
  }, []);

  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const deleteReview = useCallback(async (id: string) => {
    try {
      await deleteDesignReview(id);
      setReviews((prev) => prev.filter((r) => r.id !== id));
      // Decrement optimistically so the header moves with the delete, then
      // reconcile against the backend. Without the local step the count would
      // sit one high until the round-trip lands.
      setTotalCount((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
      void refreshCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete review');
    }
  }, [refreshCount]);

  return {
    reviews,
    /**
     * The TRUE number of design reviews in the database, from a dedicated
     * count query — `null` while it is still in flight. NEVER use
     * `reviews.length` as a total: that array is capped at
     * {@link REVIEW_LIST_LIMIT}.
     */
    totalCount,
    /**
     * True when the in-memory page is a strict subset of the real population.
     * Anything rendering `reviews` as if it were the whole set must surface
     * this rather than silently showing a slice.
     */
    isTruncated: totalCount !== null && reviews.length < totalCount,
    isLoading,
    error,
    runLines,
    isRunning,
    runResult,
    runProgress,
    connectorFilter,
    setConnectorFilter,
    availableConnectors,
    refresh,
    startNewReview,
    cancelReview,
    deleteReview,
  };
}
