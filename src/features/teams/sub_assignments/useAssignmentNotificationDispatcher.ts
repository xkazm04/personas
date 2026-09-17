import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { notifyProcessComplete } from '@/lib/notifications/notifyProcessComplete';
import type { ProcessType } from '@/stores/notificationCenterStore';
import { useTranslation } from '@/i18n/useTranslation';
import { getTeamAssignmentDetail } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import type { Translations } from '@/i18n/en';

/** Assignment statuses that END the work. Reaching one is news whether or not
 *  the operator is looking at the panel — which is the whole reason this
 *  listener is mounted at BackgroundServices rather than on the team page. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'aborted']);

/** Dedupe bucket for a status. One notification per assignment per bucket; the
 *  orchestrator's tick re-entries emit the same status repeatedly. */
type Bucket = 'review' | 'terminal';

function bucketOf(status: string): Bucket | null {
  if (status === 'awaiting_review') return 'review';
  return TERMINAL_STATUSES.has(status) ? 'terminal' : null;
}

interface Notification {
  processType: ProcessType;
  success: boolean;
  summary: string;
}

type AssignmentDetail = Awaited<ReturnType<typeof getTeamAssignmentDetail>>;

/**
 * What to tell the operator about an assignment that has just reached `status`.
 *
 * Exported for the dispatcher's test: the decision is the interesting part and
 * it is pure, while the listener around it is Tauri plumbing.
 */
export function describeAssignmentOutcome(
  status: string,
  detail: AssignmentDetail,
  t: Translations,
): Notification | null {
  const a = t.pipeline.assignments;
  const title = detail.assignment.title;

  if (status === 'completed') {
    return {
      processType: 'team-assignment-completed',
      success: true,
      summary: a.notification_completed_summary.replace('{title}', title),
    };
  }
  if (status === 'aborted') {
    return {
      processType: 'team-assignment-failed',
      success: false,
      summary: a.notification_stopped_summary.replace('{title}', title),
    };
  }
  // `failed` and `awaiting_review` both point at the step that stopped: the
  // assignment title alone does not say what needs attention.
  if (status === 'failed' || status === 'awaiting_review') {
    const failedStep =
      detail.steps.find((s) => s.status === 'failed') ??
      detail.steps.find((s) => s.status === 'awaiting_review');
    const stepTitle = failedStep?.title ?? title;
    const isUnmatched = !!failedStep?.errorMessage?.includes('not eligible');
    return {
      processType: isUnmatched ? 'team-assignment-unmatched' : 'team-assignment-failed',
      success: false,
      summary: (isUnmatched ? a.notification_unmatched_summary : a.notification_failed_summary)
        .replace('{step}', stepTitle),
    };
  }
  return null;
}

/**
 * Global listener that notifies when an assignment reaches a status the
 * operator would want to hear about: `awaiting_review` (it is blocked on them)
 * and the three terminal statuses (it is over). Mounted at App level
 * (BackgroundServices) so this works while the user is anywhere in the app.
 *
 * Terminal statuses used to fall into the early return that only cleared the
 * dedupe key, so a team that finished — or died — in the background said
 * nothing at all unless someone happened to be watching the panel. That is the
 * case unattended work is FOR.
 *
 * Throttling: one notification per assignment per bucket (review / terminal),
 * idempotent across the duplicate events the orchestrator's tick re-entries
 * emit. Leaving a bucket's status clears its key, so a re-failure after a fix
 * notifies again.
 */
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
        const bucket = bucketOf(status);
        const notified = notifiedRef.current;

        if (bucket === null) {
          // Back in flight (running / queued / paused): both buckets re-arm.
          notified.delete(`${assignment_id}:review`);
          notified.delete(`${assignment_id}:terminal`);
          return;
        }
        // An assignment that ENDS leaves review behind; re-arm that key so a
        // later re-run can block on review again and be heard.
        if (bucket === 'terminal') notified.delete(`${assignment_id}:review`);

        const key = `${assignment_id}:${bucket}`;
        if (notified.has(key)) return;
        notified.add(key);

        try {
          const detail = await getTeamAssignmentDetail(assignment_id);
          const outcome = describeAssignmentOutcome(status, detail, t);
          if (!outcome) return;
          void notifyProcessComplete(
            { ...outcome, redirectSection: 'pipeline', redirectTab: null },
            t,
          );
        } catch (err) {
          // Detail fetch failures are not fatal — the status is visible in the
          // panel itself. Undo the dedupe mark so the next event for this
          // assignment retries instead of being permanently suppressed.
          notified.delete(key);
          silentCatch('teams/useAssignmentNotificationDispatcher')(err);
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
