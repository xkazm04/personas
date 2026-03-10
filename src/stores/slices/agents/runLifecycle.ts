/**
 * Shared run lifecycle abstraction for evaluation-style slices (testSlice, labSlice).
 *
 * Encapsulates the common pattern:
 * - isRunning boolean + progress tracking
 * - 30-minute safety timeout that auto-resets stalled runs
 * - start / cancel / finish lifecycle transitions
 *
 * Each slice composes a RunLifecycle instance, keeping mode-specific
 * fields (runs arrays, results maps, etc.) in the slice itself.
 */

const RUN_MAX_DURATION_MS = 30 * 60 * 1000;

export interface RunProgress {
  runId?: string;
  phase: string;
  scenariosCount?: number;
  current?: number;
  total?: number;
  modelId?: string;
  scenarioName?: string;
  status?: string;
  scores?: { tool_accuracy?: number; output_quality?: number; protocol_compliance?: number };
  summary?: Record<string, unknown>;
  error?: string;
}

/**
 * Create a run lifecycle manager.
 *
 * Returns helpers that manage a single isRunning/progress state pair
 * with a safety timeout. The `isRunningKey` and `progressKey` params
 * let each slice map to its own state field names.
 *
 * @example
 * ```ts
 * const lifecycle = createRunLifecycle('isLabRunning', 'labProgress');
 * // In startArena:
 * lifecycle.markStarted(set);
 * // In cancelArena:
 * lifecycle.markCancelled(set);
 * // In finishLabRun:
 * lifecycle.markFinished(set);
 * ```
 */
export function createRunLifecycle<
  TRunningKey extends string,
  TProgressKey extends string,
>(
  isRunningKey: TRunningKey,
  progressKey: TProgressKey,
) {
  let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null;

  function clearSafetyTimeout() {
    if (safetyTimeoutId) {
      clearTimeout(safetyTimeoutId);
      safetyTimeoutId = null;
    }
  }

  function scheduleSafetyTimeout(onTimeout: () => void) {
    clearSafetyTimeout();
    safetyTimeoutId = setTimeout(() => {
      safetyTimeoutId = null;
      onTimeout();
    }, RUN_MAX_DURATION_MS);
  }

  return {
    /** Set isRunning=true, clear progress, schedule 30min safety timeout. */
    markStarted(set: (partial: Record<string, unknown>) => void) {
      set({ [isRunningKey]: true, [progressKey]: null, error: null });
      scheduleSafetyTimeout(() => {
        set({ [isRunningKey]: false, [progressKey]: null });
      });
    },

    /** Clear safety timeout and set isRunning=false (on error during start). */
    markFailed(set: (partial: Record<string, unknown>) => void) {
      clearSafetyTimeout();
      set({ [isRunningKey]: false });
    },

    /** Clear safety timeout and set isRunning=false + progress=null (on cancel). */
    markCancelled(set: (partial: Record<string, unknown>) => void) {
      clearSafetyTimeout();
      set({ [isRunningKey]: false, [progressKey]: null });
    },

    /** Clear safety timeout and set isRunning=false (on normal finish). */
    markFinished(set: (partial: Record<string, unknown>) => void) {
      clearSafetyTimeout();
      set({ [isRunningKey]: false });
    },
  };
}
