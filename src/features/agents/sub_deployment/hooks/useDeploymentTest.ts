import { useState, useCallback, useRef, useEffect } from 'react';
import { executePersona } from '@/api/agents/executions';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { awaitExecutionResult } from './awaitExecutionResult';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

export interface TestResult {
  status: 'pass' | 'fail';
  durationMs: number | null;
  /** `null` when the run's cost was never recorded — not the same as free. */
  costUsd: number | null;
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
  const unmountedRef = useRef(false);
  // In-flight ids live in a ref (not read from `tests`) so runTest keeps one
  // identity and the double-fire guard holds even before a re-render lands.
  const runningRef = useRef<Set<string>>(new Set());

  // Walk all pending dismiss timers and clear them on unmount so stale
  // setTests calls don't fire on an unmounted hook (memory retention of
  // closure + test result map; React 19 silently no-ops the setState but
  // the timer still holds the closure until it fires).
  useEffect(() => {
    const timerMap = timers.current;
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      for (const id of Object.keys(timerMap)) {
        clearTimeout(timerMap[id]);
        delete timerMap[id];
      }
    };
  }, []);

  const runTest = useCallback(async (deploymentId: string, personaId: string, prompt?: string) => {
    // Prevent double-fire
    if (runningRef.current.has(deploymentId)) return;
    runningRef.current.add(deploymentId);

    // Clear any previous dismiss timer
    if (timers.current[deploymentId]) {
      clearTimeout(timers.current[deploymentId]);
    }

    setTests((prev) => ({
      ...prev,
      [deploymentId]: { running: true, result: null },
    }));

    try {
      const started = await executePersona(personaId, undefined, prompt || DEFAULT_TEST_PROMPT);
      // The returned row is the run as it was queued, not its outcome - wait
      // for it to land before calling it a pass or a fail.
      const exec = await awaitExecutionResult(started, personaId, { isCancelled: () => unmountedRef.current });
      if (unmountedRef.current) return;

      const result: TestResult = exec
        ? {
            status: exec.status === 'completed' ? 'pass' : 'fail',
            durationMs: exec.duration_ms,
            costUsd: exec.cost_usd,
            error: exec.error_message ?? undefined,
          }
        : {
            // Still going when the wait budget ran out: not a pass, and its
            // cost is not recorded yet - null, never 0.
            status: 'fail',
            durationMs: null,
            costUsd: null,
            error: getActiveTranslations().errors.stream_timeout,
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
      // An IPC rejection is usually a plain AppError object, not an Error:
      // `String(err)` painted it as "[object Object]" and no door saw it.
      silentCatch('features/agents/sub_deployment/useDeploymentTest:run')(err);
      setTests((prev) => ({
        ...prev,
        [deploymentId]: {
          running: false,
          result: {
            status: 'fail',
            durationMs: null,
            // The run never happened, so its cost was never recorded - null,
            // per the TestResult contract, not 0 ("free").
            costUsd: null,
            error: extractMessage(err),
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
    } finally {
      runningRef.current.delete(deploymentId);
    }
  }, []);

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
