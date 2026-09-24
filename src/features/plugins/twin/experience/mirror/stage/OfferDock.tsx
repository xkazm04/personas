/**
 * What the guide wants to write down, as a dock that rises over the field.
 *
 * An offer is the moment the twin actually learns something, so it takes the
 * lane for as long as it is unresolved instead of living in a column the eye
 * has to keep. It clears itself when the next question arrives.
 *
 * The record-versus-queue logic is `useDeskProposals`, reused as it is: the
 * session drops a proposal the moment it is resolved, and the dock keeps it
 * wearing its verdict, so the person can still see what they just agreed to.
 * Nothing here writes anything — accept/edit/dismiss all go back through the
 * session.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Inbox } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { SetupProposalRow } from '../../../setup/SetupProposalRow';
import type { DeskProposals } from '../../../setup/desk/useDeskProposals';
import type { SetupProposal } from '../../../setup/setupContract';
import { offerVariants } from '../motion';

interface OfferDockProps {
  proposals: DeskProposals;
  /** Told what was kept, so the lane can whisper it once. */
  onKept: (proposal: SetupProposal) => void;
}

export function OfferDock({ proposals, onKept }: OfferDockProps) {
  const { t } = useTranslation();
  const mr = t.twin.experience_mirror.offer;
  const reduced = useReducedMotion();
  const { record, resolved } = proposals;

  return (
    <AnimatePresence>
      {record.length > 0 && (
        <motion.section
          key="offers"
          variants={offerVariants(reduced)}
          initial="enter"
          animate="rest"
          exit="gone"
          className="mr-frame rounded-card px-4 py-3 space-y-2.5"
          aria-labelledby="mr-offer-title"
          data-testid="mr-offers"
        >
          <p id="mr-offer-title" className="flex items-center gap-2 typo-title text-foreground">
            <Inbox className="w-4 h-4 text-primary" aria-hidden />
            {mr.title}
          </p>
          {record.map((proposal) => (
            <SetupProposalRow
              key={proposal.id}
              proposal={proposal}
              resolution={resolved[proposal.id]}
              onAccept={async (p) => {
                await proposals.onAccept(p);
                onKept(p);
              }}
              onEdit={proposals.onEdit}
              onDismiss={proposals.onDismiss}
            />
          ))}
          <p className="typo-caption">{mr.hint}</p>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

export default OfferDock;
