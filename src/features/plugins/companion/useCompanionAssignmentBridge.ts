import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { getTeamAssignmentDetail } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore, type AthenaAssignmentRef } from './companionStore';

/** Listens to TEAM_ASSIGNMENT_PROGRESS globally and surfaces Athena-
 *  dispatched assignments as cards in the companion chat (above
 *  messages). Mounted in CompanionPanel so cards only refresh while the
 *  panel is mounted; the store retains state across panel toggles. */
export function useCompanionAssignmentBridge() {
  const upsert = useCompanionStore((s) => s.upsertAthenaAssignment);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<{ assignment_id: string; status: string; step_id: string | null }>(
      EventName.TEAM_ASSIGNMENT_PROGRESS,
      async (event) => {
        if (cancelled) return;
        try {
          const detail = await getTeamAssignmentDetail(event.payload.assignment_id);
          if (detail.assignment.source !== 'athena') return;
          const ref: AthenaAssignmentRef = {
            assignmentId: detail.assignment.id,
            teamId: detail.assignment.teamId,
            title: detail.assignment.title,
            goal: detail.assignment.goal,
            status: detail.assignment.status,
            totalSteps: detail.steps.length,
            doneSteps: detail.steps.filter((s) => s.status === 'done').length,
            failedSteps: detail.steps.filter((s) => s.status === 'failed').length,
            updatedAt: Date.now(),
          };
          upsert(ref);
        } catch (e) {
          // Detail fetch failures don't break the chat — the card just
          // won't update this turn. Next event will retry.
          silentCatch('companion.assignmentBridge.fetchDetail')(e);
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
  }, [upsert]);
}
