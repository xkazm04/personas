/**
 * Typed field offers, dealt as a second row of cards under the question.
 * Verdicts stay on the table for this turn so Accept is visible.
 */

import { SetupProposalRow } from '../../../setup/SetupProposalRow';
import { useDeskProposals } from '../../../setup/desk/useDeskProposals';
import type { SetupSessionApi } from '../../../setup/setupContract';

interface ProposalFanProps {
  session: SetupSessionApi;
  intoComposer: (value: string) => void;
}

export function ProposalFan({ session, intoComposer }: ProposalFanProps) {
  const proposals = useDeskProposals(session, intoComposer);
  if (proposals.record.length === 0) return null;

  return (
    <div className="w-full max-w-[52rem] mx-auto mt-4 grid gap-3 md:grid-cols-2">
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
  );
}

export default ProposalFan;
