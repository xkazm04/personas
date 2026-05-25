import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { usePipelineStore } from '@/stores/pipelineStore';
import { silentCatch } from '@/lib/silentCatch';

const TERMINAL = new Set(['done', 'failed', 'awaiting_review']);

/**
 * Phase 4 — Athena post-run reconciliation.
 *
 * When an **Athena-dispatched** team assignment (`source === 'athena'`, with a
 * `companionOpId`) reaches a terminal status, record its outcome digest into
 * Athena's OperativeMemory exactly once — so her chat can reason about what the
 * team accomplished. Mounted once in BackgroundServices so it fires regardless
 * of the active module. Team-UI assignments are skipped (they have no operation
 * to reconcile into; they surface via the live checklist + board instead).
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

        // Resolve from cache; only Athena-dispatched assignments reconcile.
        const st = usePipelineStore.getState();
        const cached =
          st.assignmentDetails[assignment_id]?.assignment ??
          Object.values(st.assignmentsByTeam).flat().find((a) => a.id === assignment_id);
        if (!cached || cached.source !== 'athena' || !cached.companionOpId) return;

        firedRef.current.add(key);
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
