import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as api from '@/api/tauriApi';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { getSeedReviews } from '@/lib/personas/seedTemplates';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';

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
    setIsLoading(true);
    try {
      const data = await api.listDesignReviews();
      setReviews(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch reviews');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const seedDoneRef = useRef(false);

  // Seed built-in templates into the database on first mount
  const seedBuiltinTemplates = useCallback(async (existingReviews: PersonaDesignReview[]) => {
    if (seedDoneRef.current) return;
    seedDoneRef.current = true;

    const seeds = getSeedReviews();
    const existingIds = new Set(
      existingReviews
        .filter((r) => r.test_run_id?.startsWith('seed-'))
        .map((r) => r.test_case_id),
    );

    const missing = seeds.filter((s) => !existingIds.has(s.test_case_id));
    if (missing.length === 0) return;

    try {
      await Promise.all(missing.map((input) => api.importDesignReview(input)));
      // Re-fetch to include seeded records
      const data = await api.listDesignReviews();
      setReviews(data);
    } catch {
      // Seeding is best-effort — don't block the UI
    }
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const data = await api.listDesignReviews();
        setReviews(data);
        await seedBuiltinTemplates(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch reviews');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [seedBuiltinTemplates]);

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
      // Listen for review status events
      if (unlistenRef.current) {
        unlistenRef.current();
      }
      unlistenRef.current = await listen<ReviewStatusPayload>('design-review-status', (event) => {
        const { status, test_case_name, test_case_index, total, run_id, error_message, elapsed_ms } = event.payload;

        // Filter out events from other runs. The first event may arrive before
        // startDesignReviewRun returns, so accept it and latch the run_id.
        if (currentRunId.current === null) {
          currentRunId.current = run_id;
        } else if (run_id !== currentRunId.current) {
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
          // Template is being generated — update progress with template name
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
          const errorStr = error_message ? ` — ${error_message}` : '';
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

      const result = await api.startDesignReviewRun(personaId, testCases ?? []);
      currentRunId.current = result.run_id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start review run');
      setIsRunning(false);
    }
  }, [refresh]);

  const cancelReview = useCallback(async () => {
    // Signal backend to stop processing
    if (currentRunId.current) {
      try {
        await api.cancelDesignReviewRun(currentRunId.current);
      } catch {
        // Best effort cancellation
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
      await api.deleteDesignReview(id);
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
