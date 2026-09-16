/**
 * useDeskProposals — the typed values the guide offers in the current turn,
 * kept as a RECORD rather than a queue.
 *
 * `session.proposals` drops a proposal the moment it is resolved, which is the
 * right thing for the engine and the wrong thing for the desk: a card that
 * vanishes on Accept leaves the user with no evidence of what they just agreed
 * to. So the desk keeps every proposal it has seen for the current question and
 * re-renders a resolved one wearing its verdict. Both are cleared when the next
 * question arrives — the trail carries the verdict from then on.
 */

import { useCallback, useEffect, useState } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import type { SetupProposal, SetupSessionApi } from '../setupContract';
import type { SetupProposalResolution } from '../SetupProposalRow';

/** Keep every proposal of the current turn, in the order they arrived. */
function merge(kept: SetupProposal[], incoming: readonly SetupProposal[]): SetupProposal[] {
  const seen = new Set(kept.map((p) => p.id));
  const added = incoming.filter((p) => !seen.has(p.id));
  return added.length === 0 ? kept : [...kept, ...added];
}

export interface DeskProposals {
  record: SetupProposal[];
  resolved: Record<string, SetupProposalResolution>;
  onAccept: (proposal: SetupProposal) => Promise<void>;
  onEdit: (proposal: SetupProposal) => void;
  onDismiss: (proposal: SetupProposal) => void;
}

export function useDeskProposals(
  session: SetupSessionApi,
  /** Where an "Edit" lands: the composer, so the user keeps authorship. */
  intoComposer: (value: string) => void,
): DeskProposals {
  const [record, setRecord] = useState<SetupProposal[]>([]);
  const [resolved, setResolved] = useState<Record<string, SetupProposalResolution>>({});

  useEffect(() => {
    setRecord([]);
    setResolved({});
  }, [session.question]);

  useEffect(() => {
    setRecord((kept) => merge(kept, session.proposals));
  }, [session.proposals]);

  const mark = useCallback(
    (proposal: SetupProposal, resolution: SetupProposalResolution) =>
      setResolved((prev) => ({ ...prev, [proposal.id]: resolution })),
    [],
  );

  const onAccept = useCallback(
    async (proposal: SetupProposal) => {
      try {
        await session.accept(proposal);
        mark(proposal, 'accepted');
      } catch (err) {
        toastCatch('features/plugins/twin/setup/desk/useDeskProposals:accept')(err);
      }
    },
    [session, mark],
  );

  const onEdit = useCallback(
    (proposal: SetupProposal) => {
      intoComposer(proposal.value);
      mark(proposal, 'edited');
    },
    [intoComposer, mark],
  );

  const onDismiss = useCallback(
    (proposal: SetupProposal) => {
      session.dismiss(proposal);
      mark(proposal, 'dismissed');
    },
    [session, mark],
  );

  return { record, resolved, onAccept, onEdit, onDismiss };
}
