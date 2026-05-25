import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';

const TERMINAL = new Set(['done', 'failed', 'awaiting_review']);

/**
 * Phase 4 — Athena post-run reconciliation.
 *
 * When a team assignment reaches a terminal status, ask the backend to record
 * its outcome digest into Athena's OperativeMemory — so her chat can reason
 * about what the team accomplished. Mounted once in BackgroundServices so it
 * fires regardless of the active module.
 *
 * The fire decision is **server-side, not cache-dependent**: the command
 * (`companion_record_assignment_outcome`) resolves the assignment's
 * `companion_op_id` from the DB and no-ops (returns false) for any assignment
 * that has no operation to reconcile into — i.e. every team-UI assignment.
 * So we can call it on every terminal transition without first needing the
 * assignment cached frontend-side; the dedupe ref just avoids a redundant IPC
 * on event replay. This is what makes the hook fire reliably for
 * Athena-dispatched assignments created outside the pipeline store's cache.
 *
 * Mirrors `useFleetCompanionBridge` (event → companion record command). Sonnet
 * still does the up-front decompose; this is reflection, not orchestration.
 */
export function useAthenaAssignmentReconciliation() {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<{ assignment_id: string; status: string; step_id: string | null }>(
      EventName.TEAM_ASSIGNMENT_PROGRESS,
      (event) => {
        if (cancelled) return;
        const { assignment_id, status, step_id } = event.payload;
        // Assignment-level terminal transitions only.
        if (step_id !== null || !TERMINAL.has(status)) return;
        const key = `${assignment_id}:${status}`;
        if (firedRef.current.has(key)) return;
        firedRef.current.add(key);

        // No cache lookup: the command resolves companion_op_id from the DB and
        // returns false for any assignment with no operation to reconcile (every
        // team-UI assignment), so calling it on every terminal transition is safe
        // and lets the hook fire for Athena assignments not in the store cache.
        void invokeWithTimeout<boolean>('companion_record_assignment_outcome', {
          assignmentId: assignment_id,
        }).catch(silentCatch('teams/athenaReconciliation'));
      },
    ).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
}
