/**
 * SetupProposalRow — one typed value the guide proposes for a real field,
 * rendered as a card the user acts on: Accept / Edit / Dismiss.
 *
 * Two invariants from the elicitation standard live here:
 *  - nothing is written on silence, so the card has no default action and no
 *    timer; the user's choice is the only thing that resolves it;
 *  - a resolved card STAYS in the record, wearing its verdict, so the
 *    transcript remains an account of what was decided rather than a list of
 *    things still pending.
 */

import { Check, Pencil, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupProposal } from './setupContract';

export type SetupProposalResolution = 'accepted' | 'edited' | 'dismissed';

interface SetupProposalRowProps {
  proposal: SetupProposal;
  /** Set once the user has acted. The card then reads as a record, not a task. */
  resolution?: SetupProposalResolution;
  onAccept: (proposal: SetupProposal) => Promise<void> | void;
  onEdit: (proposal: SetupProposal) => void;
  onDismiss: (proposal: SetupProposal) => void;
}

const VERDICT_TONE: Record<SetupProposalResolution, string> = {
  accepted: 'border-status-success/35 bg-status-success/5',
  edited: 'border-primary/30 bg-primary/5',
  dismissed: 'border-foreground/10 bg-secondary/20 opacity-70',
};

export function SetupProposalRow({ proposal, resolution, onAccept, onEdit, onDismiss }: SetupProposalRowProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup.proposal;
  const label = proposal.channel ? `${ts.kind[proposal.kind]} · ${proposal.channel}` : ts.kind[proposal.kind];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      data-testid={`setup-proposal-${proposal.kind}`}
      className={`rounded-card border shadow-elevation-1 overflow-hidden ${
        resolution ? VERDICT_TONE[resolution] : 'border-primary/20 bg-card/60'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/10 bg-secondary/25">
        <span className="typo-caption uppercase tracking-[0.18em]">{label}</span>
        {proposal.lengthHint && (
          <span className="typo-caption tabular-nums">{proposal.lengthHint}</span>
        )}
        {resolution && (
          <span
            className={`ml-auto typo-caption ${
              resolution === 'accepted' ? 'text-status-success' : ''
            }`}
          >
            {ts[resolution]}
          </span>
        )}
      </div>

      <p className={`px-3 py-2.5 typo-body whitespace-pre-wrap ${
        resolution === 'dismissed' ? 'text-foreground line-through decoration-foreground/25' : 'text-foreground'
      }`}>
        {proposal.value}
      </p>

      {proposal.reason && (
        <p className="px-3 pb-2 typo-caption">{proposal.reason}</p>
      )}

      {!resolution && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-primary/10 bg-secondary/15">
          <AsyncButton
            size="sm"
            variant="accent"
            tone="agent"
            icon={<Check className="w-3.5 h-3.5" />}
            onClick={() => onAccept(proposal)}
            data-testid="setup-proposal-accept"
          >
            {ts.accept}
          </AsyncButton>
          <Button
            size="sm"
            variant="ghost"
            icon={<Pencil className="w-3.5 h-3.5" />}
            onClick={() => onEdit(proposal)}
            data-testid="setup-proposal-edit"
          >
            {ts.edit}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="w-3.5 h-3.5" />}
            onClick={() => onDismiss(proposal)}
            data-testid="setup-proposal-dismiss"
            className="ml-auto"
          >
            {ts.dismiss}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export default SetupProposalRow;
