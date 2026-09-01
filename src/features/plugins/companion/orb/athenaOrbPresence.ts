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
import { useAgentStore } from '@/stores/agentStore';
import { useCompanionStore } from '../companionStore';
import type { AthenaState } from '../AthenaAvatar';
import {
  resolveMention,
  type MentionCandidate,
  type ResolvedMention,
} from './athenaOrbMention';

/** Perimeter dots cap — past this the arc stops reading as countable. */
const MAX_TASK_DOTS = 5;

/** Frozen empties for the closed-Monitor path. Referentially stable, so the
 *  gated selectors above cannot re-render the orb by handing it a fresh `[]`. */
const EMPTY_PERSONAS: never[] = [];
const EMPTY_SESSIONS: never[] = [];

/** The board strips the same team/role prefixes before it labels a tile
 *  (`fleetGridModel.cleanName`), so the name Athena is matched against is the
 *  name the operator can actually see. Duplicated rather than imported: this
 *  module must not pull the Monitor's grid into the orb's bundle. */
function cleanPersonaName(n: string): string {
  return n.replace(/^T:\s*/, '').replace(/^SDLC[ —-]*/i, '').trim() || n;
}

/** Caption budget. `OrbCaption` is `max-w-[320px]` and wraps, so this is about
 *  how much of a paragraph is worth reading beside an orb — not about fitting. */
const CAPTION_MAX = 180;

/**
 * One line of a possibly-long assistant reply.
 *
 * Takes the first sentence when there is a clean one and the reply runs on past
 * it, because Athena's opening sentence is nearly always her verdict and the
 * rest is the working. Falls back to a hard clip. Markdown fences and headings
 * are stripped: a bubble that opens with "##" is showing syntax, not a remark.
 */
function summarise(text: string | null): string | null {
  if (!text) return null;
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return null;
  const stop = flat.search(/[.!?](\s|$)/);
  if (stop > 0 && stop < CAPTION_MAX && flat.length > stop + 1) return flat.slice(0, stop + 1);
  return flat.length > CAPTION_MAX ? `${flat.slice(0, CAPTION_MAX).trimEnd()}…` : flat;
}

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
  /**
   * The one board node this caption unambiguously names, or null. Present only
   * while the Monitor is open — everywhere else there is no board to point at.
   */
  captionMention: ResolvedMention | null;
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

  // THE MONITOR IS THE ONE SCREEN ATHENA CAN NARRATE.
  //
  // She has the overview the operator is looking at — every persona's state and
  // every live session, across every project — so on that screen her latest
  // remark is not chatter, it is the reading of the board that the board itself
  // cannot give: which column deserves attention, what just went wrong, what she
  // has already handled. Everywhere else this stays null, because a permanently
  // pinned line over ordinary work IS chatter.
  const monitorOpen = useSystemStore((s) => s.headerOverlay === 'monitor');
  // A PRIMITIVE selector, deliberately: returning the message object would
  // re-render the orb on every store write that replaces the array, and this
  // component is mounted over every screen for the whole session.
  const lastAthenaLine = useCompanionStore((s) => {
    for (let i = s.messages.length - 1; i >= 0; i -= 1) {
      const m = s.messages[i];
      if (m && m.role === 'assistant' && m.content.trim()) return m.content;
    }
    return null;
  });
  const monitorCaption = useMemo(
    () => (monitorOpen ? summarise(lastAthenaLine) : null),
    [monitorOpen, lastAthenaLine],
  );

  // THE CANDIDATE LIST IS BUILT ONLY WHILE THE MONITOR IS OPEN.
  //
  // This component is mounted over every screen for the whole session, which is
  // why every other selector in this file returns a primitive. These two return
  // arrays, so they are gated at the SELECTOR: closed Monitor -> the shared
  // frozen empty, which is referentially stable, so the memo below never
  // recomputes and the orb never re-renders for a roster change it is not
  // using. Reading the arrays unconditionally would put a persona-list
  // subscription on every screen in the app to serve one overlay.
  const personas = useAgentStore((s) => (monitorOpen ? s.personas : EMPTY_PERSONAS));
  const sessions = useSystemStore((s) => (monitorOpen ? s.fleetSessions : EMPTY_SESSIONS));

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (!monitorOpen) return [];
    const out: MentionCandidate[] = personas.map((p) => ({
      key: `p:${p.id}`,
      name: cleanPersonaName(p.name),
    }));
    for (const sn of sessions) {
      const name = (sn.title?.trim() || sn.name?.trim() || '').trim();
      if (name) out.push({ key: `s:${sn.id}`, name });
    }
    return out;
  }, [monitorOpen, personas, sessions]);

  const captionMention = useMemo(
    () => resolveMention(monitorCaption, candidates),
    [monitorCaption, candidates],
  );

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
  // a fleet-orchestration cue > Athena's latest line on the Monitor > nothing.
  //
  // The Monitor line sits LAST on purpose. The three above it are all "what
  // Athena is doing right now", which is always more urgent than "what she last
  // said" — a caption that buried a live transcript under an old remark would
  // be a worse orb, not a better-informed one.
  const caption =
    talking && interimText
      ? interimText
      : explainComposing
        ? t.plugins.companion.orb_composing_explanation
        : working && fleetGridOpen
          ? t.plugins.companion.orb_managing_fleet
          : monitorCaption;

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
    captionMention,
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
