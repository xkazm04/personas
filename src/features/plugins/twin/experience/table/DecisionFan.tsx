/**
 * The three suggestion cards dealt as a fan across the table.
 */

import { AnimatePresence } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupFocus, SetupSuggestion } from '../../setup/setupContract';
import { DecisionCard } from './DecisionCard';

interface DecisionFanProps {
  cards: SetupSuggestion[];
  picked: number;
  busy: boolean;
  focus: SetupFocus;
  onPick: (index: number) => void;
  onCommit: (text: string) => void;
}

export function DecisionFan({
  cards,
  picked,
  busy,
  focus,
  onPick,
  onCommit,
}: DecisionFanProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience;

  if (cards.length === 0) return null;

  return (
    <div
      className="flex items-end justify-center gap-3 md:gap-5 px-4 pt-2 pb-4"
      data-testid="twin-experience-fan"
    >
      <AnimatePresence mode="popLayout">
        {cards.map((card, i) => (
          <DecisionCard
            key={`${card.text}-${i}`}
            card={card}
            index={i}
            picked={i === picked}
            busy={busy}
            focus={focus}
            pickLabel={tx.table.pickCard}
            onPick={() => onPick(i)}
            onCommit={() => onCommit(card.text)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default DecisionFan;
