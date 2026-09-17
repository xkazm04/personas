import { useEffect, useState } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import {
  MOTION_PRESETS,
  REDUCED_FRAMER,
  TRANSITION_NORMAL,
} from '@/lib/utils/animation/animationPresets';
import { AthenaAvatar } from '@/features/plugins/companion/AthenaAvatar';
import { TypedLine } from '../../shared/TypedLine';
import { AthenaWaveform } from '../../shared/AthenaWaveform';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { ConversationCard } from './ConversationCard';
import { echoFor } from './conversationEcho';

/** `TypedLine` types at ~28 chars/s; used only as a safety net when it never reports `onDone`. */
const TYPING_CHARS_PER_SEC = 28;
const TYPING_SETTLE_MS = 300;

/**
 * One exchange: Athena's turn (avatar + typed line in a soft bubble, waveform
 * on the voice steps) and, once the line has finished typing, the user's turn
 * — the current card, right-aligned. While this exchange is leaving
 * (`AnimatePresence` keeps it mounted for the exit) the card collapses to a
 * compact echo of the answer that was given.
 */
export function ConversationExchange({ engine }: { engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { shouldAnimate } = useMotion();
  const isPresent = useIsPresent();
  const [lineDone, setLineDone] = useState(false);

  const { line, stepId, speaking, card } = engine;
  const showWave = stepId === 'voice_pick' || stepId === 'handoff';

  // Safety net for a TypedLine that never calls back (the WP0 stub): reveal the
  // card after the time the line would have taken to type.
  useEffect(() => {
    if (lineDone) return;
    const ms = (line.text.length / TYPING_CHARS_PER_SEC) * 1000 + TYPING_SETTLE_MS;
    const id = window.setTimeout(() => setLineDone(true), shouldAnimate ? ms : 0);
    return () => window.clearTimeout(id);
  }, [lineDone, line.text, shouldAnimate]);

  const enter = shouldAnimate ? MOTION_PRESETS.gentle.framer : REDUCED_FRAMER;
  const exit = shouldAnimate ? TRANSITION_NORMAL : REDUCED_FRAMER;
  const echo = echoFor(card, c);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: enter }}
      exit={{ opacity: 0, y: -8, transition: exit }}
      className="flex flex-col gap-5"
      data-testid="create-athena-exchange"
    >
      <div className="flex items-start gap-3">
        <AthenaAvatar
          state={speaking ? 'speaking' : 'idle'}
          size={56}
          className="shrink-0 mt-1"
        />
        <div
          className="min-w-0 flex-1 rounded-card bg-secondary/40 border border-foreground/10 px-4 py-3"
          data-testid="create-athena-line"
        >
          <TypedLine
            lineId={line.id}
            text={line.text}
            onDone={() => setLineDone(true)}
            className="typo-body-lg leading-relaxed text-foreground"
          />
          {showWave && (
            <AthenaWaveform active={speaking} bars={22} className="mt-3 opacity-80" />
          )}
        </div>
      </div>

      {!isPresent && echo ? (
        <div className="flex justify-end">
          <span
            className="rounded-card bg-primary/20 border border-primary/30 px-3 py-1.5 typo-body text-foreground"
            data-testid="create-athena-echo"
          >
            {echo}
          </span>
        </div>
      ) : (
        lineDone && (
          <div className="flex justify-end">
            <ConversationCard engine={engine} />
          </div>
        )
      )}
    </motion.div>
  );
}
