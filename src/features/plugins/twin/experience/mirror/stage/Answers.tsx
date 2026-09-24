/**
 * Up to three answers, as slats under the question.
 *
 * A slat is a real CHOICE between different answers, never three wordings of
 * one (the guide's prompt and its parser both hold that). Press one to pick
 * it, press it again to play it; digits, arrows and Enter do the same from the
 * keyboard, which the lane owns.
 *
 * While the next question is being written the three slats stay on screen as
 * empty reserved frames of exactly the same geometry — so nothing moves when
 * the real answers arrive. A `write` question deals none at all: its answer
 * has to be typed, because it becomes a writing sample.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupSuggestion } from '../../../setup/setupContract';
import { slatVariants } from '../motion';

interface AnswersProps {
  /** Keys the deal: a new question deals new slats. */
  dealKey: string;
  cards: SetupSuggestion[];
  picked: number;
  busy: boolean;
  onPick: (index: number) => void;
  onPlay: (index: number) => void;
}

const LANE = 'grid gap-2.5 sm:grid-cols-3 min-h-[7.5rem]';

export function Answers({ dealKey, cards, picked, busy, onPick, onPlay }: AnswersProps) {
  const { t } = useTranslation();
  const mr = t.twin.experience_mirror.answers;
  const reduced = useReducedMotion();

  if (busy && cards.length === 0) {
    return (
      <div className={LANE} aria-hidden data-testid="mr-answers-reserved">
        {[0, 1, 2].map((i) => (
          <span key={i} className="mr-frame mr-frame-empty rounded-card" />
        ))}
      </div>
    );
  }

  return (
    <div className={LANE} role="group" aria-label={mr.label} data-testid="mr-answers">
      <AnimatePresence initial={false}>
        {cards.map((card, i) => (
          <motion.button
            key={`${dealKey}:${i}:${card.text}`}
            type="button"
            variants={slatVariants(reduced, i)}
            initial="enter"
            animate="rest"
            exit="gone"
            onClick={() => (i === picked ? onPlay(i) : onPick(i))}
            onDoubleClick={() => onPlay(i)}
            // While the next turn is in flight these are last turn's answers.
            // They stay on screen — the lane never blanks — but they stop being
            // pressable, because the claim in `useTurn` would drop the press
            // anyway and a control that looks live and does nothing is worse.
            disabled={busy}
            aria-pressed={i === picked}
            data-picked={i === picked}
            data-testid={`mr-answer-${i + 1}`}
            className="mr-slat focus-ring rounded-card px-4 py-3 pl-5 flex flex-col gap-2 text-left disabled:is-disabled"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="typo-label text-primary tabular-nums">{i + 1}</span>
              {i === picked && (
                <span className="inline-flex items-center gap-1 typo-caption text-primary">
                  <CornerDownLeft className="w-3.5 h-3.5" aria-hidden />
                  {mr.playHint}
                </span>
              )}
            </span>
            <span className="typo-body text-foreground whitespace-pre-wrap">{card.text}</span>
            {card.reason && <span className="mt-auto typo-caption line-clamp-2">{card.reason}</span>}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default Answers;
