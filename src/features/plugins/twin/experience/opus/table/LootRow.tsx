/**
 * The offers of the current turn, laid out between the question and the
 * hand. Each turns over as it lands. Kept, it sends a token flying off to the
 * right, toward the twin's card (whose count pops as the row is written), and
 * settles stamped; passed, it dims and stays stamped. The stamped cards are
 * the turn's record until the next question clears them.
 *
 * The record-versus-queue logic is `useDeskProposals` from the Setup desk,
 * reused as is: the session drops a proposal the moment it is resolved, the
 * table keeps it wearing its verdict.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { DeskProposals } from '../../../setup/desk/useDeskProposals';
import { lootCardVariants } from '../cardMotion';
import { LootCard } from './LootCard';

interface LootRowProps {
  proposals: DeskProposals;
}

export function LootRow({ proposals }: LootRowProps) {
  const reduced = useReducedMotion();
  const { record, resolved } = proposals;
  if (record.length === 0) return null;

  return (
    <div
      className="grid gap-3 [perspective:1200px]"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))' }}
      data-testid="xo-loot"
    >
      <AnimatePresence initial={false}>
        {record.map((proposal, i) => {
          const resolution = resolved[proposal.id];
          return (
            <motion.div
              key={proposal.id}
              custom={i}
              variants={lootCardVariants(reduced)}
              initial="enter"
              animate={resolution === 'dismissed' ? { opacity: 0.7, scale: 0.98 } : 'rest'}
              exit="gone"
              className="relative"
            >
              <LootCard
                proposal={proposal}
                resolution={resolution}
                onKeep={proposals.onAccept}
                onEdit={proposals.onEdit}
                onPass={proposals.onDismiss}
              />
              {resolution === 'accepted' && !reduced && (
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute right-4 top-3 inline-flex items-center justify-center w-7 h-7 rounded-full bg-status-success text-background shadow-elevation-3"
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: 360, y: -90, opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Check className="w-4 h-4" />
                </motion.span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default LootRow;
