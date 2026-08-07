/**
 * Athena's floating, dockable orb — the minimized presence that lives as an
 * overlay above app content (rendered only while `companionState === 'minimized'`).
 *
 * This file is the shell: position, the gesture surface, and which decorations
 * are up. The pieces it composes each own one concern —
 *
 *  - `athenaOrbGeometry` — fractions ⇄ pixels, viewport, dock side
 *  - `athenaOrbGesture`  — tap / hold-to-talk / drag-and-snap
 *  - `athenaOrbPresence` — posture, counts, caption
 *  - `athenaOrbReactions`— the one-shot message + forward-ack pulses
 *  - `AthenaOrbDecor`    — glows, unread badge, task halo, caption
 *
 * — so a change to any one of them is a change to one file.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '../companionStore';
import type { HoldToTalk } from '../useHoldToTalk';
import { AthenaAvatar } from '../AthenaAvatar';
import { AthenaOrbCornerActions } from './AthenaOrbCornerActions';
import {
  OrbCaption,
  OrbPulseGlow,
  OrbSpeakingGlow,
  OrbTaskDots,
  OrbUnreadBadge,
} from './AthenaOrbDecor';
import {
  clamp,
  fractionToPx,
  isDockedLeft,
  MARGIN,
  ORB_SIZE,
  useViewport,
} from './athenaOrbGeometry';
import { useAthenaOrbGesture } from './athenaOrbGesture';
import { useOrbAudioGlow } from './athenaOrbGlow';
import { useAthenaOrbPresence } from './athenaOrbPresence';
import { useAthenaOrbReactions } from './athenaOrbReactions';
import { useSystemStore } from '@/stores/systemStore';

export { ORB_SIZE } from './athenaOrbGeometry';

export function AthenaOrb({
  talk,
  quickInputOpen,
  onToggleQuickInput,
}: {
  talk: HoldToTalk;
  /** Whether the compact quick-message bar (rendered by the layer) is open. */
  quickInputOpen: boolean;
  onToggleQuickInput: () => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const streaming = useCompanionStore((s) => s.streaming);
  const orbPos = useSystemStore((s) => s.companionOrbPos);
  // Guided-walkthrough drive: while a walkthrough is active the orb is steered
  // by the runner (`orbGuideTarget`), not the user.
  const orbGuideTarget = useCompanionStore((s) => s.orbGuideTarget);
  const guideActive = useCompanionStore((s) => s.activeWalkthrough != null);

  const vp = useViewport();
  const resolved = fractionToPx(orbPos.x, orbPos.y, vp);
  const { talking, interimText } = talk;
  const gesture = useAthenaOrbGesture({
    talk,
    left: resolved.left,
    top: resolved.top,
    vp,
    guideActive,
  });
  const left = gesture.dragPx?.left ?? resolved.left;
  const top = gesture.dragPx?.top ?? resolved.top;

  const presence = useAthenaOrbPresence({ talking, interimText, orbSize: ORB_SIZE });
  const reactions = useAthenaOrbReactions(streaming);

  // While a walkthrough drives the orb, a step's target position wins and the
  // orb glides to it (spring); otherwise it follows the drag / docked position
  // instantly. Under reduced motion the glide becomes a jump.
  const renderLeft = orbGuideTarget
    ? clamp(orbGuideTarget.left, MARGIN, Math.max(vp.w - ORB_SIZE, 0) - MARGIN)
    : left;
  const renderTop = orbGuideTarget
    ? clamp(orbGuideTarget.top, MARGIN, Math.max(vp.h - ORB_SIZE, 0) - MARGIN)
    : top;
  const glideTransition =
    orbGuideTarget && !reduceMotion
      ? ({ type: 'spring', stiffness: 220, damping: 28 } as const)
      : ({ duration: 0 } as const);
  const dockedLeft = isDockedLeft(renderLeft, vp.w);

  const glowRef = useOrbAudioGlow(presence.speaking, !!reduceMotion);

  return (
    <motion.div
      className="group pointer-events-auto absolute select-none touch-none"
      // Anchored at the origin and moved with a transform: animating left/top
      // would force a layout pass on every frame of the glide and every drag.
      style={{ width: ORB_SIZE, height: ORB_SIZE, left: 0, top: 0 }}
      initial={false}
      animate={{ x: renderLeft, y: renderTop }}
      transition={glideTransition}
    >
      {presence.caption && <OrbCaption text={presence.caption} dockedLeft={dockedLeft} />}

      <button
        type="button"
        {...gesture.handlers}
        data-testid="companion-orb"
        aria-pressed={talking}
        className={`relative w-full h-full rounded-full overflow-visible cursor-grab active:cursor-grabbing focus-ring transition-transform ${
          talking
            ? `ring-2 ring-primary/60 ${reduceMotion ? '' : 'animate-pulse'}`
            : reduceMotion
              ? ''
              : 'hover:scale-105'
        }`}
        title={t.plugins.companion.orb_talk_hint}
        aria-label={presence.ariaLabel}
      >
        {presence.speaking && <OrbSpeakingGlow reduceMotion={!!reduceMotion} glowRef={glowRef} />}
        {reactions.messageActive && <OrbPulseGlow tone="primary" />}
        {reactions.forwardAck && <OrbPulseGlow tone="amber" reduceMotion={!!reduceMotion} />}
        {/* Standing unread ring. Ranks BELOW the two one-shots above it: while a
            reaction plays the user is being told about this very message, and
            the standing ring re-asserts itself the moment that loop ends. */}
        <span
          className={`absolute inset-0 rounded-full overflow-hidden shadow-elevation-3 bg-primary/10 transition-[box-shadow] ${
            reactions.forwardAck
              ? 'ring-2 ring-amber-400'
              : reactions.messageActive
                ? 'ring-2 ring-primary'
                : presence.hasUnread
                  ? 'ring-2 ring-primary/70'
                  : 'ring-1 ring-primary/25'
          }`}
        >
          <AthenaAvatar
            state={presence.avatarState}
            fill
            className="absolute inset-0"
            messageNonce={reactions.messageNonce}
            onMessageActiveChange={reactions.setMessageActive}
          />
        </span>
        {talking && (
          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center ring-2 ring-background">
            <span className="w-1.5 h-1.5 rounded-full bg-background animate-pulse" />
          </span>
        )}
        {presence.hasUnread && (
          <OrbUnreadBadge
            count={presence.unreadReplies}
            label={presence.unreadLabel}
            reduceMotion={!!reduceMotion}
          />
        )}
        {presence.taskDots.length > 0 && (
          <OrbTaskDots
            dots={presence.taskDots}
            total={presence.runningTaskCount}
            reduceMotion={!!reduceMotion}
          />
        )}
      </button>

      <AthenaOrbCornerActions
        quickInputOpen={quickInputOpen}
        onToggleQuickInput={onToggleQuickInput}
      />
    </motion.div>
  );
}
