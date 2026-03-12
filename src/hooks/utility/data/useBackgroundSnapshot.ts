import { useEffect, useRef } from 'react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;
const BACKOFF_FACTOR = 1.5;

// ============================================================================
// Generic background task snapshot
// ============================================================================

/**
 * Common fields present in every background task snapshot returned from Rust.
 * Job-specific extras are accessed via the generic parameter `T`.
 */
export interface BackgroundTaskSnapshot<T = Record<string, unknown>> {
  job_id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  elapsed_secs: number;
  /** Job-specific extra fields (flattened by serde on Rust side). */
  extras: T;
}

/**
 * @deprecated Use `BackgroundTaskSnapshot` instead. Kept for backward
 * compatibility during migration.
 */
export interface SnapshotLike {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'awaiting_answers';
  error: string | null;
  lines: string[];
  draft?: N8nPersonaDraft | null;
  questions?: unknown[] | null;
  sections?: unknown[] | null;
}

// ============================================================================
// Generic polling hook
// ============================================================================

export interface UseBackgroundJobPollingOptions<T> {
  /** The background job ID to poll for. Polling starts when this is truthy. */
  jobId: string | null;
  /** Fetches the current snapshot from the backend. */
  getSnapshot: (id: string) => Promise<T>;
  /** Called with each new snapshot while the job is active. */
  onSnapshot: (snapshot: T) => void;
  /** Called when the snapshot reaches a terminal state. */
  onTerminal?: (snapshot: T) => void;
  /** Called when polling hits consecutive fetch errors (session lost). */
  onSessionLost?: () => void;
  /** Extract the status string from the snapshot. */
  getStatus: (snapshot: T) => string;
  /** Polling interval in ms. Defaults to 1000. */
  interval?: number;
  /** Number of consecutive fetch failures before treating session as lost. Defaults to 3. */
  maxFailures?: number;
  /** Increment to force polling restart (e.g. after user answers questions). */
  epoch?: number;
  /** Statuses that should pause polling (e.g. 'awaiting_answers'). */
  pauseOnStatuses?: string[];
}

/**
 * Generic background job polling hook. Polls a snapshot endpoint at
 * regular intervals with adaptive backoff, handling terminal states,
 * session loss, and configurable pause conditions.
 *
 * This replaces the template-specific `useBackgroundSnapshot` with a
 * fully generic implementation that works for any async job type.
 */
export function useBackgroundJobPolling<T>({
  jobId,
  getSnapshot,
  onSnapshot,
  onTerminal,
  onSessionLost,
  getStatus,
  interval = 1000,
  maxFailures = 3,
  epoch = 0,
  pauseOnStatuses = [],
}: UseBackgroundJobPollingOptions<T>) {
  const pollTimerRef = useRef<number | null>(null);
  const backoffRef = useRef<number>(Math.max(interval, MIN_BACKOFF_MS));
  const consecutiveRunningRef = useRef(0);
  const notFoundCountRef = useRef(0);
  const pauseDeliveredRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;

    notFoundCountRef.current = 0;
    pauseDeliveredRef.current = false;
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
        const snapshot = await getSnapshot(jobId);
        notFoundCountRef.current = 0;
        const status = getStatus(snapshot);

        onSnapshot(snapshot);

        // Handle pause statuses (e.g. awaiting_answers)
        if (pauseOnStatuses.includes(status) && !pauseDeliveredRef.current) {
          pauseDeliveredRef.current = true;
          clearPollTimer();
          return;
        }

        // Stop polling on terminal states
        if (status === 'completed' || status === 'failed') {
          onTerminal?.(snapshot);
          clearPollTimer();
          return;
        }

        // Adaptive backoff for running state
        if (status === 'running') {
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
          onSessionLost?.();
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
  }, [jobId, getSnapshot, onSnapshot, onTerminal, onSessionLost, getStatus, interval, maxFailures, epoch, pauseOnStatuses]);

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

// ============================================================================
// Legacy useBackgroundSnapshot (delegates to useBackgroundJobPolling)
// ============================================================================

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
 * @deprecated Use `useBackgroundJobPolling` for new code. This wrapper
 * preserves the original callback-based API for existing consumers.
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
            // Stop polling -- user needs to answer before we continue
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
        // intentional: non-critical -- polling retries with backoff until maxFailures
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
