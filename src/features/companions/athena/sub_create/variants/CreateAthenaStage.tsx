import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { TRANSITION_NORMAL, TRANSITION_SLOW } from '@/lib/utils/animation/animationPresets';
import type { CreateAthenaVariantProps } from '../engine/createAthenaTypes';
import { TypedLine } from '../shared/TypedLine';
import { StageRail } from './stage/StageRail';
import { StageCard } from './stage/StageCard';

/**
 * Create Athena — "Stage" shell. A setup studio: Athena is always present on
 * the left (hero + step rail), the work happens on the right, where her line
 * is a caption and the card is the primary object.
 *
 * Choreography per step: the line types; the card rises in once the line is
 * done; on step change both fade out together (250 ms) before the next line
 * starts typing — `AnimatePresence mode="wait"` keyed on `line.id`.
 */
const TYPING_CHARS_PER_S = 28;
const REVEAL_FALLBACK_CAP_MS = 8_000;

/**
 * `true` once the current line is fully visible. `TypedLine.onDone` is the
 * real signal; the timer is a belt-and-braces reveal for a line that never
 * reports (the WP0 stub) so the card can never be stranded behind a caption.
 */
function useLineDone(lineId: string, text: string): [boolean, () => void] {
  const [doneFor, setDoneFor] = useState<string | null>(null);
  useEffect(() => {
    const ms = Math.min(REVEAL_FALLBACK_CAP_MS, (text.length / TYPING_CHARS_PER_S) * 1000 + 500);
    const timer = setTimeout(() => setDoneFor(lineId), ms);
    return () => clearTimeout(timer);
  }, [lineId, text]);
  return [doneFor === lineId, () => setDoneFor(lineId)];
}

export default function CreateAthenaStage({ engine }: CreateAthenaVariantProps) {
  const { shouldAnimate } = useMotion();
  const { line, card } = engine;
  const [lineDone, markDone] = useLineDone(line.id, line.text);
  const rise = shouldAnimate ? 12 : 0;
  const enter = shouldAnimate ? TRANSITION_SLOW : { duration: 0 };
  const exit = shouldAnimate ? TRANSITION_NORMAL : { duration: 0 };

  return (
    <div className="flex h-full min-h-0 rounded-card border border-foreground/10 overflow-hidden" data-testid="create-athena-stage">
      <StageRail engine={engine} />
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={line.id}
            className="flex flex-col gap-5 px-8 py-8 max-w-[720px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: enter }}
            exit={{ opacity: 0, transition: exit }}
            data-testid="create-athena-stage-step"
            data-step={engine.stepId}
          >
            {/* Her line starts where an inline avatar would sit and grows to the
                right; the rail hero is her presence, so nothing shares the row
                with the typing text. */}
            <TypedLine
              lineId={line.id}
              text={line.text}
              onDone={markDone}
              className="typo-title max-w-[560px] min-h-[1.75em]"
            />
            {lineDone && (
              <motion.div
                initial={{ opacity: 0, y: rise }}
                animate={{ opacity: 1, y: 0, transition: enter }}
                data-testid="create-athena-stage-card-slot"
                data-kind={card.kind}
              >
                <StageCard engine={engine} />
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
