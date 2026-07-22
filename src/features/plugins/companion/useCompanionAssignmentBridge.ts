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
    // TEAM_ASSIGNMENT_PROGRESS fires per STEP transition for EVERY team run.
    // Without these guards the bridge fetched the full assignment detail
    // (whole steps array) per event just to discover source !== 'athena' and
    // discard it — N+ wasted fetches per non-Athena assignment, concurrent
    // with the engine's own DB load.
    const nonAthena = new Set<string>(); // source verdict cache
    const pending = new Map<string, ReturnType<typeof setTimeout>>(); // per-assignment debounce
    const fetchDetail = async (assignmentId: string) => {
        if (cancelled) return;
        try {
          const detail = await getTeamAssignmentDetail(assignmentId);
          if (detail.assignment.source !== 'athena') {
            nonAthena.add(assignmentId);
            return;
          }
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
    };
    void listen<{ assignment_id: string; status: string; step_id: string | null }>(
      EventName.TEAM_ASSIGNMENT_PROGRESS,
      (event) => {
        if (cancelled) return;
        const id = event.payload.assignment_id;
        if (nonAthena.has(id)) return;
        // Trailing 300ms debounce per assignment: a rapid step cascade
        // produces one fetch instead of one per step.
        const existing = pending.get(id);
        if (existing) clearTimeout(existing);
        pending.set(id, setTimeout(() => {
          pending.delete(id);
          void fetchDetail(id);
        }, 300));
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
      for (const handle of pending.values()) clearTimeout(handle);
      if (unlisten) unlisten();
    };
  }, [upsert]);
}
