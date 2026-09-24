/**
 * The hand: up to three answer cards, dealt from the question and fanned.
 *
 * A card is a real CHOICE between different answers, never three wordings of
 * one (the guide's prompt and parser both hold that). Press a card to pick it
 * and press it again to play it; digits, arrows and Enter do the same from the
 * keyboard (the table owns those keys). While the next question is drawn the
 * hand is three card backs: the geometry of what is coming, not a spinner.
 *
 * A `write` question deals no cards at all — its answer has to be typed,
 * because it becomes a writing sample — so the hand is replaced by the
 * composer, which the table renders larger for that turn.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupSuggestion } from '../../../setup/setupContract';
import { fanPose, handCardVariants, type HandCustom, type TableVerdict } from '../cardMotion';
import { AnswerCard } from './AnswerCard';

interface HandProps {
  /** Keys the deal: a new question deals a new hand. */
  dealKey: string;
  cards: SetupSuggestion[];
  picked: number;
  verdict: TableVerdict;
  busy: boolean;
  onPick: (index: number) => void;
  onPlay: (index: number) => void;
}

const CARD_WIDTH = 'w-[min(20rem,30%)] min-w-[12rem]';

export function Hand({ dealKey, cards, picked, verdict, busy, onPick, onPlay }: HandProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const custom: HandCustom = { picked, verdict };

  return (
    <div
      role="group"
      aria-label={t.twin.experience_opus.table.handLabel}
      className="relative flex justify-center items-start gap-4 pt-2 min-h-[11rem]"
      data-testid="xo-hand"
    >
      {/* The backs sit OVER the hand rather than replacing it, so the cards
          just played can still fly out while the next hand waits face down.
          They arrive once that flight is over. */}
      <AnimatePresence>
        {busy && (
          <motion.div
            key="backs"
            aria-hidden
            data-testid="xo-hand-backs"
            className="absolute inset-0 pt-2 flex justify-center gap-4 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: reduced ? 0 : 0.3, duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            {[0, 1, 2].map((i) => {
              const pose = fanPose(i, 3);
              return (
                <span
                  key={i}
                  className={`xo-back ${CARD_WIDTH} h-40`}
                  style={{ transform: `translateY(${pose.y}px) rotate(${pose.rotate}deg)` }}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence custom={custom}>
        {cards.map((card, i) => (
          <motion.div
            key={`${dealKey}:${i}:${card.text}`}
            custom={custom}
            variants={handCardVariants(reduced, i, cards.length)}
            initial="dealt"
            animate="rest"
            exit="gone"
            className={`${CARD_WIDTH} origin-bottom`}
          >
            <AnswerCard
              index={i}
              card={card}
              picked={i === picked}
              onPress={() => (i === picked ? onPlay(i) : onPick(i))}
              onPlay={() => onPlay(i)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default Hand;
