import { useState, useCallback, useRef } from 'react';
import { executePersona } from '@/api/agents/executions';

export interface TestResult {
  status: 'pass' | 'fail';
  durationMs: number | null;
  costUsd: number;
  error?: string;
}

interface TestState {
  running: boolean;
  result: TestResult | null;
}

const DEFAULT_TEST_PROMPT = 'Hello, this is a deployment smoke test. Respond briefly to confirm you are operational.';
const RESULT_DISPLAY_MS = 15_000;

/**
 * Manages one-click test execution state keyed by deployment ID.
 * Calls executePersona with a default (or custom) prompt,
 * then surfaces pass/fail + duration + cost as a transient inline result.
 */
export function useDeploymentTest() {
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const runTest = useCallback(async (deploymentId: string, personaId: string, prompt?: string) => {
    // Prevent double-fire
    if (tests[deploymentId]?.running) return;

    // Clear any previous dismiss timer
    if (timers.current[deploymentId]) {
      clearTimeout(timers.current[deploymentId]);
    }

    setTests((prev) => ({
      ...prev,
      [deploymentId]: { running: true, result: null },
    }));

    try {
      const exec = await executePersona(personaId, undefined, prompt || DEFAULT_TEST_PROMPT);
      const passed = exec.status === 'completed';

      const result: TestResult = {
        status: passed ? 'pass' : 'fail',
        durationMs: exec.duration_ms,
        costUsd: exec.cost_usd,
        error: exec.error_message ?? undefined,
      };

      setTests((prev) => ({
        ...prev,
        [deploymentId]: { running: false, result },
      }));

      // Auto-dismiss after 15s
      timers.current[deploymentId] = setTimeout(() => {
        setTests((prev) => {
          const next = { ...prev };
          delete next[deploymentId];
          return next;
        });
      }, RESULT_DISPLAY_MS);
    } catch (err) {
      setTests((prev) => ({
        ...prev,
        [deploymentId]: {
          running: false,
          result: {
            status: 'fail',
            durationMs: null,
            costUsd: 0,
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));

      timers.current[deploymentId] = setTimeout(() => {
        setTests((prev) => {
          const next = { ...prev };
          delete next[deploymentId];
          return next;
        });
      }, RESULT_DISPLAY_MS);
    }
  }, [tests]);

  const dismissResult = useCallback((deploymentId: string) => {
    if (timers.current[deploymentId]) {
      clearTimeout(timers.current[deploymentId]);
    }
    setTests((prev) => {
      const next = { ...prev };
      delete next[deploymentId];
      return next;
    });
  }, []);

  return { tests, runTest, dismissResult };
}
