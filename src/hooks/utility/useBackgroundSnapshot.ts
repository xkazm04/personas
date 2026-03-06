import { useEffect, useRef } from 'react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;
const BACKOFF_FACTOR = 1.5;

/**
 * Shape common to both N8nTransformSnapshot and TemplateAdoptSnapshot.
 */
export interface SnapshotLike {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
  questions?: unknown[] | null;
  /** Streaming sections from section-by-section transform. */
  sections?: unknown[] | null;
}

export interface UseBackgroundSnapshotOptions {
  /** The background job ID to poll for. Polling starts when this is truthy. */
  snapshotId: string | null;
  /** Fetches the current snapshot from the backend. */
  getSnapshot: (id: string) => Promise<SnapshotLike>;
  /** Called with each batch of output lines. */
  onLines: (lines: string[]) => void;
  /** Called when the snapshot status changes to running/completed/failed. */
  onPhase: (phase: 'running' | 'completed' | 'failed') => void;
  /** Called when a draft is available. */
  onDraft: (draft: N8nPersonaDraft) => void;
  /** Called when the snapshot completes but has no draft. */
  onCompletedNoDraft: () => void;
  /** Called when the snapshot reports failure. */
  onFailed: (error: string) => void;
  /** Called when polling hits 3 consecutive fetch errors (session lost). */
  onSessionLost: () => void;
  /** Called when the backend is awaiting user answers and questions are available. */
  onQuestions?: (questions: unknown[]) => void;
  /** Called with streaming sections from section-by-section transform. */
  onSections?: (sections: unknown[]) => void;
  /** Polling interval in ms. Defaults to 1000. */
  interval?: number;
  /** Number of consecutive fetch failures before treating session as lost. Defaults to 3. */
  maxFailures?: number;
  /** Increment to force polling restart (e.g. after user answers questions and Turn 2 begins). */
  epoch?: number;
}

/**
 * Polls a background snapshot endpoint at a regular interval, dispatching
 * callbacks for lines, phase changes, draft availability, and errors.
 *
 * Used by both AdoptionWizardModal and N8nImportTab to track background
 * transformation jobs.
 */
export function useBackgroundSnapshot({
  snapshotId,
  getSnapshot,
  onLines,
  onPhase,
  onDraft,
  onCompletedNoDraft,
  onFailed,
  onSessionLost,
  onQuestions,
  onSections,
  interval = 1000,
  maxFailures = 3,
  epoch = 0,
}: UseBackgroundSnapshotOptions) {
  const pollTimerRef = useRef<number | null>(null);
  const backoffRef = useRef<number>(Math.max(interval, MIN_BACKOFF_MS));
  const consecutiveRunningRef = useRef(0);
  const notFoundCountRef = useRef(0);
  const questionsDeliveredRef = useRef(false);

  useEffect(() => {
    if (!snapshotId) return;

    notFoundCountRef.current = 0;
    questionsDeliveredRef.current = false;
    consecutiveRunningRef.current = 0;
    backoffRef.current = Math.max(interval, MIN_BACKOFF_MS);

    const clearPollTimer = () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const scheduleNextPoll = (delayMs: number) => {
      clearPollTimer();
      pollTimerRef.current = window.setTimeout(() => {
        void syncSnapshot();
      }, delayMs);
    };

    const syncSnapshot = async () => {
      try {
        const snapshot = await getSnapshot(snapshotId);
        notFoundCountRef.current = 0;

        const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
        onLines(lines);

        // Forward streaming sections if present
        if (onSections && Array.isArray(snapshot.sections) && snapshot.sections.length > 0) {
          onSections(snapshot.sections);
        }

        if (snapshot.status === 'running' || snapshot.status === 'completed' || snapshot.status === 'failed') {
          onPhase(snapshot.status);
        }

        // Handle awaiting_answers: forward questions and pause polling
        if (snapshot.status === 'awaiting_answers' && onQuestions && !questionsDeliveredRef.current) {
          const questions = Array.isArray(snapshot.questions) ? snapshot.questions : [];
          if (questions.length > 0) {
            questionsDeliveredRef.current = true;
            onQuestions(questions);
            // Stop polling — user needs to answer before we continue
            clearPollTimer();
            return;
          }
        }

        if (snapshot.draft) {
          onDraft(snapshot.draft);
        } else if (snapshot.status === 'completed') {
          onCompletedNoDraft();
        }

        if (snapshot.status === 'failed') {
          onFailed(snapshot.error || 'Background job failed.');
        }

        // Stop polling once we reach a terminal state
        if (snapshot.status === 'completed' || snapshot.status === 'failed') {
          clearPollTimer();
          return;
        }

        if (snapshot.status === 'running') {
          consecutiveRunningRef.current += 1;
          if (consecutiveRunningRef.current >= 2) {
            backoffRef.current = Math.min(
              MAX_BACKOFF_MS,
              Math.max(MIN_BACKOFF_MS, Math.round(backoffRef.current * BACKOFF_FACTOR)),
            );
          }
        } else {
          consecutiveRunningRef.current = 0;
          backoffRef.current = Math.max(interval, MIN_BACKOFF_MS);
        }

        scheduleNextPoll(backoffRef.current);
      } catch {
        // intentional: non-critical — polling retries with backoff until maxFailures
        notFoundCountRef.current += 1;
        if (notFoundCountRef.current >= maxFailures) {
          onSessionLost();
          clearPollTimer();
          return;
        }
        scheduleNextPoll(backoffRef.current);
      }
    };

    void syncSnapshot();

    return () => {
      clearPollTimer();
    };
  }, [snapshotId, getSnapshot, onLines, onPhase, onDraft, onCompletedNoDraft, onFailed, onSessionLost, onQuestions, onSections, interval, maxFailures, epoch]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);
}
