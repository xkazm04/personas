import { useState, useCallback, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import * as api from '@/api/tauriApi';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

interface ReviewStatusPayload {
  run_id: string;
  test_case_index: number;
  total: number;
  status: string;
  test_case_name: string;
}

interface TestRunResult {
  testRunId: string;
  totalTests: number;
  passed: number;
  failed: number;
  errored: number;
}

export function useDesignReviews() {
  const [reviews, setReviews] = useState<PersonaDesignReview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runLines, setRunLines] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<TestRunResult | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const countersRef = useRef({ passed: 0, failed: 0, errored: 0 });

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

  useEffect(() => { refresh(); }, [refresh]);

  const startNewReview = useCallback(async (personaId?: string, testCases?: object[]) => {
    if (!personaId) {
      setError('No persona selected for review');
      return;
    }

    setError(null);
    setIsRunning(true);
    setRunLines([]);
    setRunResult(null);
    countersRef.current = { passed: 0, failed: 0, errored: 0 };

    try {
      // Listen for review status events
      if (unlistenRef.current) {
        unlistenRef.current();
      }
      unlistenRef.current = await listen<ReviewStatusPayload>('design-review-status', (event) => {
        const { status, test_case_name, test_case_index, total, run_id } = event.payload;

        if (status === 'completed' && test_case_index === total) {
          setIsRunning(false);
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
        } else {
          if (status === 'passed') countersRef.current.passed++;
          else if (status === 'failed') countersRef.current.failed++;
          else if (status === 'errored') countersRef.current.errored++;
          setRunLines((prev) => [
            ...prev,
            `[${test_case_index + 1}/${total}] ${test_case_name}: ${status}`,
          ]);
        }
      });

      await api.startDesignReviewRun(personaId, testCases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start review run');
      setIsRunning(false);
    }
  }, [refresh]);

  const cancelReview = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    setIsRunning(false);
    setRunLines([]);
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
    refresh,
    startNewReview,
    cancelReview,
    deleteReview,
  };
}
