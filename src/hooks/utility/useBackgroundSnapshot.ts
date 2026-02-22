import { useEffect, useRef } from 'react';
import type { N8nPersonaDraft } from '@/api/design';

/**
 * Shape common to both N8nTransformSnapshot and TemplateAdoptSnapshot.
 */
export interface SnapshotLike {
  status: 'idle' | 'running' | 'completed' | 'failed';
  error: string | null;
  lines: string[];
  draft: N8nPersonaDraft | null;
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
  /** Polling interval in ms. Defaults to 1500. */
  interval?: number;
  /** Number of consecutive fetch failures before treating session as lost. Defaults to 3. */
  maxFailures?: number;
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
  interval = 1500,
  maxFailures = 3,
}: UseBackgroundSnapshotOptions) {
  const pollTimerRef = useRef<number | null>(null);
  const notFoundCountRef = useRef(0);

  useEffect(() => {
    if (!snapshotId) return;

    notFoundCountRef.current = 0;

    const syncSnapshot = async () => {
      try {
        const snapshot = await getSnapshot(snapshotId);
        notFoundCountRef.current = 0;

        const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
        onLines(lines);

        if (snapshot.status === 'running' || snapshot.status === 'completed' || snapshot.status === 'failed') {
          onPhase(snapshot.status);
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
          if (pollTimerRef.current !== null) {
            window.clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          return;
        }
      } catch {
        notFoundCountRef.current += 1;
        if (notFoundCountRef.current >= maxFailures) {
          onSessionLost();
        }
      }
    };

    void syncSnapshot();

    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    pollTimerRef.current = window.setInterval(() => {
      void syncSnapshot();
    }, interval);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [snapshotId, getSnapshot, onLines, onPhase, onDraft, onCompletedNoDraft, onFailed, onSessionLost, interval, maxFailures]);

  // Cleanup poll timer on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);
}
