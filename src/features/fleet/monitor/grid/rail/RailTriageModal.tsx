// RailTriageModal — the full case for one queue row, centre screen.
//
// The rail's two verdict buttons handle the obvious majority. This is the rest:
// the row you cannot decide from a title, opened into the same card the triage
// deck deals — `TriageCardBody`, not a re-implementation of it. That reuse is
// the whole point. The deck's card already knows how to render every kind the
// unified queue produces (review, idea, practice, question, policy, evolution,
// goal): its prose, its evidence block, its metric ledger, its source stamp. A
// second renderer for the same model would drift from it within one feature.
//
// WHAT IS DELIBERATELY LEFT BEHIND. `TriageCard` — the outer component — is a
// drag surface: fling-to-verdict, rotation, accept/reject washes, the stamps,
// depth transforms for the two cards behind it. None of that belongs here. A
// modal opened from a list has no deck to fling into and no next card to reveal;
// the gesture would be decoration over a queue the reviewer is reading in a
// different order. So this takes the BODY and gives it an explicit footer, and
// the deck keeps its gesture.
//
// The verdicts here are the same three the spine defines, with the item's own
// verbs (`verdictLabels`) — "Approve" reads wrong on a practice and "Adopt"
// reads wrong on a review, and the model already carries the right word.

import { useCallback, useState } from 'react';
import { Check, SkipForward, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { TriageCardBody } from '@/features/agents/quick-answer/triage/deck/TriageCardBody';
import type { TriageItem, TriageVerdict } from '@/features/agents/quick-answer/triage/triageTypes';

const TITLE_ID = 'rail-triage-modal-title';

export function RailTriageModal({
  item, onClose, onDecide,
}: {
  /** Null closes it. The parent owns which row is open. */
  item: TriageItem | null;
  onClose: () => void;
  /** Resolves when the verdict has been accepted by its backend. */
  onDecide: (item: TriageItem, verdict: TriageVerdict) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Answers for a question-shaped item are NOT collected here: the deck owns
  // that flow (`answerSlot` + the batched submit), and a half-implementation of
  // it in a second surface is how two paths to one write start disagreeing.
  // Such an item opens read-only and is decided in the deck.
  const [busy, setBusy] = useState(false);

  const decide = useCallback(
    async (verdict: TriageVerdict) => {
      if (!item || busy) return;
      setBusy(true);
      try {
        await onDecide(item, verdict);
        onClose();
      } finally {
        setBusy(false);
      }
    },
    [item, busy, onDecide, onClose],
  );

  if (!item) return null;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-2xl"
      // The header/body/footer flex chain below depends on the body being the
      // only thing that grows; the stagger wrapper is a block-level motion.div
      // that breaks it and silently no-ops `flex-1 overflow-y-auto`.
      staggerChildren={false}
      panelClassName="max-h-[82vh] flex flex-col"
    >
      <h2 id={TITLE_ID} className="sr-only">{item.title}</h2>

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-3 pt-5" data-testid="rail-triage-modal">
        <TriageCardBody item={item} isTop />
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        <AsyncButton
          onClick={() => decide('reject')}
          disabled={busy}
          variant="secondary"
          size="sm"
          data-testid="rail-triage-reject"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          {item.verdictLabels.reject}
        </AsyncButton>
        <AsyncButton
          onClick={() => decide('skip')}
          disabled={busy}
          variant="ghost"
          size="sm"
          data-testid="rail-triage-skip"
        >
          <SkipForward className="mr-1.5 h-3.5 w-3.5" />
          {item.verdictLabels.skip}
        </AsyncButton>
        <span className="ml-auto">
          <AsyncButton
            onClick={() => decide('accept')}
            disabled={busy}
            variant="primary"
            size="sm"
            data-testid="rail-triage-accept"
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {item.verdictLabels.accept}
          </AsyncButton>
        </span>
      </div>

      <span className="sr-only">{t.monitor.grid_rail_triage_modal_aria}</span>
    </BaseModal>
  );
}

export default RailTriageModal;
