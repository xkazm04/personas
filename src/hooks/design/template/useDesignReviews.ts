import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { batchImportDesignReviews, cancelDesignReviewRun, deleteDesignReview, deleteStaleSeedTemplates, listDesignReviews, startDesignReviewRun } from "@/api/overview/reviews";

import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { getActiveSeedIds, getSeedReviews, SEED_RUN_ID } from '@/lib/personas/templates/seedTemplates';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { createSWRFetcher, invalidateSWRCache } from '@/lib/utils/staleWhileRevalidate';

const SWR_KEY = 'design-reviews';
const fetchReviewsSWR = createSWRFetcher(SWR_KEY, () => listDesignReviews());

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

  // Derive unique connectors from review data
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
  }, []);

  const seedDoneRef = useRef(false);

  // Seed catalog templates into the database on first mount.
  // Also prunes templates that were renamed or deleted from the catalog.
  const seedCatalogTemplates = useCallback(async () => {
    if (seedDoneRef.current) return;
    seedDoneRef.current = true;

    const seeds = getSeedReviews();

    // Upsert ALL seeds (not just missing) to backfill new fields like category.
    // The backend uses ON CONFLICT DO UPDATE so this is safe -- it preserves
    // adoption_count and last_adopted_at while updating changed fields.
    if (seeds.length === 0) return;

    try {
      await batchImportDesignReviews(seeds);

      // Prune stale seed templates whose IDs are no longer in the catalog
      // (e.g. renamed or deleted template files). Only affects seed rows.
      const activeIds = getActiveSeedIds();
      if (activeIds.length > 0) {
        await deleteStaleSeedTemplates(SEED_RUN_ID, activeIds);
      }

      // Invalidate cache and re-fetch to include seeded records (and reflect deletions)
      invalidateSWRCache(SWR_KEY);
      const { data } = await fetchReviewsSWR();
      setReviews(data);
    } catch {
      // intentional: non-critical -- seeding catalog templates is best-effort
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      try {
        // SWR: returns cached data instantly if available, revalidates in background
        const { data, fromCache } = await fetchReviewsSWR();
        if (cancelled) return;
        setReviews(data);

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
              }).catch(() => { /* non-critical */ });
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
  }, [seedCatalogTemplates]);

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
      } catch {
        // intentional: non-critical -- cancellation is best-effort
      }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete review');
    }
  }, []);

  return {
    reviews,
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
