import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { notifyProcessComplete } from '@/lib/notifications/notifyProcessComplete';
import { useTranslation } from '@/i18n/useTranslation';
import { getTeamAssignmentDetail } from '@/api/pipeline/assignments';

/** Global listener that dispatches notifications when an assignment
 *  transitions to `awaiting_review`. Mounted at App level (BackgroundServices)
 *  so notifications fire even when the user isn't on the team page.
 *
 *  Throttling: each assignment_id is notified at most once per awaiting_review
 *  transition (idempotent across duplicate events emitted during the
 *  orchestrator's tick re-entries). */
export function useAssignmentNotificationDispatcher() {
  const { t } = useTranslation();
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listen<{ assignment_id: string; status: string; step_id: string | null }>(
      EventName.TEAM_ASSIGNMENT_PROGRESS,
      async (event) => {
        if (cancelled) return;
        const { assignment_id, status } = event.payload;

        // Reset the dedupe key when the assignment leaves awaiting_review,
        // so a future re-failure can fire another notification.
        if (status !== 'awaiting_review') {
          notifiedRef.current.delete(assignment_id);
          return;
        }

        if (notifiedRef.current.has(assignment_id)) return;
        notifiedRef.current.add(assignment_id);

        try {
          const detail = await getTeamAssignmentDetail(assignment_id);
          const failedStep =
            detail.steps.find((s) => s.status === 'failed') ??
            detail.steps.find((s) => s.status === 'awaiting_review');
          const stepTitle = failedStep?.title ?? detail.assignment.title;
          const isUnmatched = !!failedStep?.errorMessage?.includes('not eligible');
          const summary = (isUnmatched
            ? t.pipeline.assignments.notification_unmatched_summary
            : t.pipeline.assignments.notification_failed_summary
          ).replace('{step}', stepTitle);

          void notifyProcessComplete(
            {
              processType: isUnmatched
                ? 'team-assignment-unmatched'
                : 'team-assignment-failed',
              success: false,
              summary,
              redirectSection: 'pipeline',
              redirectTab: null,
            },
            t,
          );
        } catch {
          // Detail fetch failures here are not fatal — the user can still see
          // the awaiting_review status in the panel itself.
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
  }, [t]);
}
