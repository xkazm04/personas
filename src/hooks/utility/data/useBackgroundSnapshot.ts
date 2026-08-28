import { useEffect, useRef } from 'react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;
const BACKOFF_FACTOR = 1.5;

/** Shape of a background job snapshot as consumed by `useBackgroundSnapshot`. */
export interface SnapshotLike {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft?: N8nPersonaDraft | null;
  questions?: unknown[] | null;
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
 * Polls a background job snapshot endpoint at regular intervals with
 * adaptive backoff, handling terminal states, awaiting-answers pauses,
 * and session loss via a callback-based API.
 *
 * The callbacks and `getSnapshot` are *configuration*, not data deps. Callers
 * build them with `useCallback` over their own props, so any consumer that is
 * itself rendered with an inline closure (e.g.
 * `useBackgroundRebuild(() => gallery.refresh())` in `GeneratedReviewsTab`)
 * hands this hook a fresh identity on every render. Depending on them
 * restarted the polling effect on every render: it cleared the timer, reset
 * the backoff and the consecutive-failure counter, re-armed `onQuestions`
 * delivery, and immediately re-polled — and because `onLines` sets state with
 * a fresh array on every poll, that loop sustained itself at IPC speed
 * instead of at `interval`, and `maxFailures` could never be reached. They
 * are latched in refs, and the effect keys only on the values that really
 * identify a polling session: `snapshotId`, `interval`, `maxFailures`,
 * `epoch`. Same pattern as `useAppSetting` and `useLayeredList` next door.
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

  // Latest-callback refs — see the hook doc above.
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;
  const onLinesRef = useRef(onLines);
  onLinesRef.current = onLines;
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const onCompletedNoDraftRef = useRef(onCompletedNoDraft);
  onCompletedNoDraftRef.current = onCompletedNoDraft;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const onSessionLostRef = useRef(onSessionLost);
  onSessionLostRef.current = onSessionLost;
  const onQuestionsRef = useRef(onQuestions);
  onQuestionsRef.current = onQuestions;
  const onSectionsRef = useRef(onSections);
  onSectionsRef.current = onSections;

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
        const snapshot = await getSnapshotRef.current(snapshotId);
        notFoundCountRef.current = 0;

        const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
        onLinesRef.current(lines);

        // Forward streaming sections if present
        const onSectionsFn = onSectionsRef.current;
        if (onSectionsFn && Array.isArray(snapshot.sections) && snapshot.sections.length > 0) {
          onSectionsFn(snapshot.sections);
        }

        if (snapshot.status === 'running' || snapshot.status === 'completed' || snapshot.status === 'failed') {
          onPhaseRef.current(snapshot.status);
        }

        // Handle awaiting_answers: forward questions and pause polling
        const onQuestionsFn = onQuestionsRef.current;
        if (snapshot.status === 'awaiting_answers' && onQuestionsFn && !questionsDeliveredRef.current) {
          const questions = Array.isArray(snapshot.questions) ? snapshot.questions : [];
          if (questions.length > 0) {
            questionsDeliveredRef.current = true;
            onQuestionsFn(questions);
            // Stop polling -- user needs to answer before we continue
            clearPollTimer();
            return;
          }
        }

        if (snapshot.draft) {
          onDraftRef.current(snapshot.draft);
        } else if (snapshot.status === 'completed') {
          onCompletedNoDraftRef.current();
        }

        if (snapshot.status === 'failed') {
          onFailedRef.current(snapshot.error || 'Background job failed.');
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
        // intentional: non-critical -- polling retries with backoff until maxFailures
        notFoundCountRef.current += 1;
        if (notFoundCountRef.current >= maxFailures) {
          onSessionLostRef.current();
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
    // Callbacks are latched in refs above; only these values identify a
    // polling session. Re-running on a callback identity is the render-thrash
    // loop documented in the hook doc.
  }, [snapshotId, interval, maxFailures, epoch]);

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
