import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { getTeamAssignmentDetail } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
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
    // Per-assignment latest-wins guard: two TEAM_ASSIGNMENT_PROGRESS events
    // >300ms apart each schedule their own fetchDetail; the debounce only
    // coalesces the SCHEDULING, not the in-flight fetches. Without this, an
    // earlier fetch that resolves after a later one can regress the card's
    // doneSteps/status. Keyed per assignmentId — unrelated assignments must
    // not gate each other.
    const latestWinsByAssignment = new Map<string, ReturnType<typeof createLatestWins>>();
    const getLatestWins = (assignmentId: string) => {
      let lw = latestWinsByAssignment.get(assignmentId);
      if (!lw) {
        lw = createLatestWins();
        latestWinsByAssignment.set(assignmentId, lw);
      }
      return lw;
    };
    const fetchDetail = async (assignmentId: string) => {
        if (cancelled) return;
        const lw = getLatestWins(assignmentId);
        const token = lw.next();
        try {
          const detail = await getTeamAssignmentDetail(assignmentId);
          if (detail.assignment.source !== 'athena') {
            nonAthena.add(assignmentId);
            return;
          }
          // Discard a stale response — a newer fetch for this same
          // assignment has already started (or already resolved).
          if (!lw.isCurrent(token)) return;
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
