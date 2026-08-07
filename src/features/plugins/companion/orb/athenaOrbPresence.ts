/**
 * What the orb IS at any moment — the posture, the counts, the caption.
 *
 * Every selector here returns a PRIMITIVE (or a memoized derivation of one) so
 * the orb re-renders when its appearance actually changes, not on every store
 * write. That matters more here than almost anywhere else in the app: the orb
 * is mounted over every screen for the whole session.
 */

import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import type { AthenaState } from '../AthenaAvatar';

/** Perimeter dots cap — past this the arc stops reading as countable. */
const MAX_TASK_DOTS = 5;

export interface OrbPresence {
  avatarState: AthenaState;
  speaking: boolean;
  working: boolean;
  runningTaskCount: number;
  unreadReplies: number;
  hasUnread: boolean;
  unreadLabel: string;
  /**
   * Accessible name for the orb button. The unread badge and the task halo are
   * both decorative (`aria-hidden`), so their counts have to reach assistive
   * tech through here — an unreadable indicator is not an indicator.
   */
  ariaLabel: string;
  /** Positioned dots for the activity halo. */
  taskDots: Array<{ left: number; top: number; delay: number }>;
  /** Transient line beside the orb, or null. */
  caption: string | null;
}

export function useAthenaOrbPresence(args: {
  talking: boolean;
  interimText: string;
  orbSize: number;
}): OrbPresence {
  const { talking, interimText, orbSize } = args;
  const { t, tx } = useTranslation();

  // One Athena = aggregate presence. The flat `streaming` mirrors the FOCUSED
  // thread only; a turn running in a background conversation should still put
  // her in the thinking posture.
  const anyConversationStreaming = useCompanionStore((s) => {
    if (s.streaming) return true;
    for (const turn of Object.values(s.liveTurns)) if (turn.streaming) return true;
    return false;
  });
  const explainComposing = useCompanionStore((s) => s.explainComposing);
  const hasUnreadPlayback = useCompanionStore(
    (s) => s.pendingPlayback != null && !s.pendingPlayback.played,
  );
  const unreadReplies = useCompanionStore((s) => s.unreadReplies);
  const runningTaskCount = useCompanionStore((s) => {
    let n = 0;
    for (const j of Object.values(s.jobsById)) {
      if (j.status === 'running' || j.status === 'queued') n += 1;
    }
    for (const j of Object.values(s.inTurnToolJobs)) {
      if (j.status === 'running' || j.status === 'queued') n += 1;
    }
    return n;
  });
  // While the Fleet grid is open, a working orb is most likely orchestrating
  // the fleet — surface that as a glanceable caption.
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);

  // Background tasks running (even with no turn streaming) put her in the
  // working posture, so parallel work is visible while the panel is minimized.
  const working = runningTaskCount > 0;
  // `composing` (Explain-in-Cockpit in flight) outranks the generic thinking
  // posture — the user just asked for a visual explanation and the presenting
  // clip telegraphs "she's building it".
  const avatarState: AthenaState = explainComposing
    ? 'composing'
    : talking || anyConversationStreaming || working
      ? 'thinking'
      : hasUnreadPlayback
        ? 'speaking'
        : 'idle';

  const shown = Math.min(runningTaskCount, MAX_TASK_DOTS);
  const taskDots = useMemo(
    () =>
      Array.from({ length: shown }, (_, i) => {
        // Arc the dots across the orb's top, on a circle just outside it.
        const angleDeg = shown === 1 ? -90 : -132 + (84 * i) / (shown - 1);
        const a = (angleDeg * Math.PI) / 180;
        const R = orbSize / 2 + 9;
        return {
          left: orbSize / 2 + R * Math.cos(a),
          top: orbSize / 2 + R * Math.sin(a),
          delay: i * 0.16,
        };
      }),
    [shown, orbSize],
  );

  // Caption priority: live dictation transcript > composing an explanation >
  // a fleet-orchestration cue > nothing.
  const caption =
    talking && interimText
      ? interimText
      : explainComposing
        ? t.plugins.companion.orb_composing_explanation
        : working && fleetGridOpen
          ? t.plugins.companion.orb_managing_fleet
          : null;

  const unreadLabel = tx(
    unreadReplies === 1
      ? t.plugins.companion.orb_unread_one
      : t.plugins.companion.orb_unread_other,
    { count: unreadReplies },
  );
  const ariaLabel = talking
    ? t.plugins.companion.footer_listening
    : working
      ? tx(
          runningTaskCount === 1
            ? t.plugins.companion.tasks_running_one
            : t.plugins.companion.tasks_running_other,
          { count: runningTaskCount },
        )
      : unreadReplies > 0
        ? `${unreadLabel} — ${t.plugins.companion.orb_talk_hint}`
        : t.plugins.companion.orb_talk_hint;

  return {
    avatarState,
    speaking: avatarState === 'speaking',
    working,
    runningTaskCount,
    unreadReplies,
    hasUnread: unreadReplies > 0,
    unreadLabel,
    ariaLabel,
    taskDots,
    caption,
  };
}
