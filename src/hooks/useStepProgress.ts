import { useState, useMemo, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'active' | 'completed';

export interface StepState {
  index: number;
  status: StepStatus;
}

export interface StepProgressResult {
  /** Set of completed step indices. */
  completedSteps: Set<number>;
  /** Currently active step index (for auto-advance / derived modes). */
  activeStepIndex: number;
  /** Per-step status array derived from completedSteps + activeStepIndex. */
  steps: StepState[];
  /** Number of completed steps. */
  completedCount: number;
  /** Total number of steps. */
  totalSteps: number;
  /** Progress percentage 0–100. */
  progressPercent: number;
  /** Whether all steps are complete. */
  allDone: boolean;
  /** Optional captured values (key→value map). */
  capturedValues: Record<string, string>;

  // ── Actions ──────────────────────────────────────────────────
  /** Toggle a step completed/uncompleted (manual mode). */
  toggleStep: (index: number) => void;
  /** Mark a step completed and auto-advance activeStepIndex. */
  completeStep: (index: number) => void;
  /** Navigate to a specific step. */
  goToStep: (index: number) => void;
  /** Set active step from a derived value (e.g. from output line keywords). */
  setDerivedIndex: (index: number) => void;
  /** Capture a key→value pair. */
  captureValue: (key: string, value: string) => void;
  /** Reset all state to initial. */
  reset: () => void;
}

// ── Hook ────────────────────────────────────────────────────────

/**
 * Unified step-progress hook that supports three completion modes:
 *
 * - **manual**: Steps are toggled on/off via `toggleStep()`.
 *   Used by InteractiveSetupInstructions.
 *
 * - **auto-advance**: Steps are completed sequentially via `completeStep()`,
 *   which also advances `activeStepIndex`. Used by NegotiatorGuidingPhase.
 *
 * - **derived**: The active step index is set externally from content analysis
 *   via `setDerivedIndex()`. All prior steps are auto-completed.
 *   Used by AnalyzingPhase.
 */
export function useStepProgress(totalSteps: number): StepProgressResult {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [capturedValues, setCapturedValues] = useState<Record<string, string>>({});

  const completedCount = completedSteps.size;
  const progressPercent = totalSteps > 0 ? Math.min((completedCount / totalSteps) * 100, 100) : 0;
  const allDone = totalSteps > 0 && completedCount >= totalSteps;

  const steps: StepState[] = useMemo(() => {
    return Array.from({ length: totalSteps }, (_, i) => ({
      index: i,
      status: completedSteps.has(i)
        ? ('completed' as const)
        : i === activeStepIndex
          ? ('active' as const)
          : ('pending' as const),
    }));
  }, [totalSteps, completedSteps, activeStepIndex]);

  // Manual toggle (add/remove from set)
  const toggleStep = useCallback((index: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Auto-advance: mark complete and move forward
  const completeStep = useCallback((index: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    // Advance to the next incomplete step
    if (index < totalSteps - 1) {
      setActiveStepIndex(index + 1);
    }
  }, [totalSteps]);

  const goToStep = useCallback((index: number) => {
    setActiveStepIndex(index);
  }, []);

  // Derived mode: external index sets active, all prior auto-completed
  const setDerivedIndex = useCallback((index: number) => {
    setActiveStepIndex(index);
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < index; i++) {
        next.add(i);
      }
      return next;
    });
  }, []);

  const captureValue = useCallback((key: string, value: string) => {
    setCapturedValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setCompletedSteps(new Set());
    setActiveStepIndex(0);
    setCapturedValues({});
  }, []);

  return {
    completedSteps,
    activeStepIndex,
    steps,
    completedCount,
    totalSteps,
    progressPercent,
    allDone,
    capturedValues,
    toggleStep,
    completeStep,
    goToStep,
    setDerivedIndex,
    captureValue,
    reset,
  };
}
