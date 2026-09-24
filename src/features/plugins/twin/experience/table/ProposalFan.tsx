/**
 * Typed field offers, dealt as a second row of cards under the question.
 * Verdicts stay on the table for this turn so Accept is visible.
 */

import { Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SetupProposalRow } from '../../setup/SetupProposalRow';
import { useDeskProposals } from '../../setup/desk/useDeskProposals';
import type { SetupSessionApi } from '../../setup/setupContract';

interface ProposalFanProps {
  session: SetupSessionApi;
  intoComposer: (value: string) => void;
}

export function ProposalFan({ session, intoComposer }: ProposalFanProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience.offers;
  const proposals = useDeskProposals(session, intoComposer);
  if (proposals.record.length === 0) return null;

  return (
    <section className="w-full max-w-[52rem] mx-auto mt-4 space-y-2" aria-labelledby="tx-offers-title">
      <p id="tx-offers-title" className="flex items-center gap-2 typo-title text-foreground">
        <Inbox className="w-4 h-4 text-primary" aria-hidden />
        {tx.title}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
      {proposals.record.map((p) => (
        <SetupProposalRow
          key={p.id}
          proposal={p}
          resolution={proposals.resolved[p.id]}
          onAccept={proposals.onAccept}
          onEdit={proposals.onEdit}
          onDismiss={proposals.onDismiss}
        />
      ))}
      </div>
      <p className="typo-caption">{tx.hint}</p>
    </section>
  );
}

export default ProposalFan;
