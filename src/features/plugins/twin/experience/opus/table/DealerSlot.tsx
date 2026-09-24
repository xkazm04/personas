/**
 * Where the question card lives, and how it leaves. Keyed on the question (or
 * on "dealing" while the next one is drawn), so a card leaves the moment it is
 * answered rather than when its successor arrives: played, it lifts away;
 * skipped, it is swept to the discard on the left. Then the next one is
 * turned face up.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { dealerCardVariants, type TableVerdict } from '../cardMotion';
import { DealerCard } from './DealerCard';

type DealerCardProps = Parameters<typeof DealerCard>[0];

export function DealerSlot({ verdict, ...card }: DealerCardProps & { verdict: TableVerdict }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const key = card.busy ? 'dealing' : `q:${card.question ?? ''}`;

  return (
    <div className="[perspective:1200px]">
      {/* The announcement lives HERE, outside the keyed card, so the live
          region exists before its message does and a screen reader hears it
          (a region born with its text is not announced). */}
      <span className="sr-only" role="status">
        {card.busy ? t.twin.experience_opus.table.dealing : ''}
      </span>
      <AnimatePresence mode="wait" custom={verdict} initial={false}>
        <motion.div
          key={key}
          custom={verdict}
          variants={dealerCardVariants(reduced)}
          initial="enter"
          animate="rest"
          exit="gone"
        >
          <DealerCard {...card} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default DealerSlot;
