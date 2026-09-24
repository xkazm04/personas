/**
 * Typed field offers, dealt as a second row of cards under the question.
 *
 * Rendered straight from the session's offer record, which the backend keeps:
 * open offers are actionable, and offers resolved since the live question was
 * dealt stay on the table wearing their verdict — so Accept is visible, and it
 * is still visible after the overlay is closed and reopened. (This used to be
 * a per-mount copy in `useDeskProposals`; the persisted record made it
 * redundant, and a copy that forgot on remount was the defect.)
 *
 * Offers read from the person's LAST answer arrive while they are already on
 * the next question, so those carry a small "from your last answer" label —
 * otherwise a card about a thing they said a moment ago reads as coming from
 * nowhere.
 */

import { useCallback } from 'react';
import { Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { SetupProposalRow } from '../../setup/SetupProposalRow';
import type { SetupProposal, SetupSessionApi } from '../../setup/setupContract';

interface ProposalFanProps {
  session: SetupSessionApi;
  intoComposer: (value: string) => void;
}

export function ProposalFan({ session, intoComposer }: ProposalFanProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience;
  const { editOffer } = session;

  // "Edit" lands in the composer, so the person keeps authorship: the value
  // is theirs to rewrite and answer with. The verdict is recorded; no field
  // is written.
  const onEdit = useCallback(
    (proposal: SetupProposal) => {
      intoComposer(proposal.value);
      editOffer(proposal).catch(toastCatch('features/plugins/twin/experience/table/ProposalFan:edit'));
    },
    [intoComposer, editOffer],
  );

  if (session.offerRecord.length === 0) return null;
  const fresh = new Set(session.lastAnswerOfferIds);

  return (
    <section className="w-full max-w-[52rem] mx-auto mt-4 space-y-2" aria-labelledby="tx-offers-title">
      <p id="tx-offers-title" className="flex items-center gap-2 typo-title text-foreground">
        <Inbox className="w-4 h-4 text-primary" aria-hidden />
        {tx.offers.title}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {session.offerRecord.map(({ proposal, resolution }) => (
          <div key={proposal.id} className="space-y-1" data-testid={`tx-offer-${proposal.id}`}>
            {fresh.has(proposal.id) && (
              <p className="typo-caption text-primary" data-testid="tx-offer-fresh">
                {tx.table.fromLastAnswer}
              </p>
            )}
            <SetupProposalRow
              proposal={proposal}
              resolution={resolution ?? undefined}
              onAccept={session.accept}
              onEdit={onEdit}
              onDismiss={session.dismiss}
            />
          </div>
        ))}
      </div>
      <p className="typo-caption">{tx.offers.hint}</p>
    </section>
  );
}

export default ProposalFan;
