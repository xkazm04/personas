import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { usePipelineStore } from '@/stores/pipelineStore';

/**
 * App-level subscription to TEAM_ASSIGNMENT_PROGRESS. Mounted once in
 * BackgroundServices so a running assignment's state stays fresh **regardless
 * of which module is on screen** — the orchestrator keeps emitting progress
 * on its background tick loop, and this keeps the per-team lists (and any
 * tracked detail) in sync, so the live checklist / board are accurate the
 * moment the user navigates back.
 *
 * This is the team-agnostic complement to the panel-scoped
 * `useAssignmentProgressListener` (which additionally refreshes one team's
 * list ordering while that panel is open).
 */
export function useGlobalAssignmentProgressListener() {
  const apply = usePipelineStore((s) => s.applyAssignmentProgress);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<{ assignment_id: string; status: string; step_id: string | null }>(
      EventName.TEAM_ASSIGNMENT_PROGRESS,
      (event) => {
        if (!cancelled) apply(event.payload);
      },
    ).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [apply]);
}
