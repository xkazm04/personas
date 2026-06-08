import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { usePipelineStore } from '@/stores/pipelineStore';

/** Subscribes to TEAM_ASSIGNMENT_PROGRESS while mounted. Each event triggers
 *  the slice's applyAssignmentProgress(), which re-fetches the assignment's
 *  detail row so the checklist UI stays in sync with the orchestrator
 *  without coupling the UI to per-step state-machine knowledge. */
export function useAssignmentProgressListener(teamId: string | null) {
  const apply = usePipelineStore((s) => s.applyAssignmentProgress);
  const fetchList = usePipelineStore((s) => s.fetchTeamAssignments);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<{ assignment_id: string; status: string; step_id: string | null }>(
      EventName.TEAM_ASSIGNMENT_PROGRESS,
      (event) => {
        if (cancelled) return;
        apply({
          assignment_id: event.payload.assignment_id,
          status: event.payload.status,
          step_id: event.payload.step_id,
        });
        // Top-level status transitions (queued→running, *→done/failed/aborted/
        // awaiting_review) may flip the per-team list ordering — refresh it.
        if (event.payload.step_id === null) {
          void fetchList(teamId);
        }
      },
    ).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [teamId, apply, fetchList]);
}
