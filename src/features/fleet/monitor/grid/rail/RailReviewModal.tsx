// RailReviewModal — one rail Reviews row, opened as the considered pass.
//
// `RailRowView` keeps its inline accept/reject exactly as they were: most of a
// triage pass is "yes, obviously" and "no, obviously", and those two buttons
// are where that pass belongs. This is the OTHER door — the one its own header
// reserves for "anything that needs an argument should be opened". Opening a
// row no longer takes over the 320px dock body; it raises the full Approvals
// surface over the rail.
//
// THE COMPONENT IS NOT OURS AND IS NOT ADAPTED HERE. `ReviewFocusFlow` is
// Overview's, and it is the baseline: severity gradient, ring and shadow, the
// per-persona workspace tint, `stripPersonaPrefix`, `ContextDataPreview` and
// the per-decision carousel are all its own. The rail bends to it — the whole
// translation is `railTriageReview`, one module, running rail -> Approvals.
//
// BORROWED FROM `RailThreadModal`, its neighbour and the precedent for opening
// a rail row: `BaseModal` from `@/lib/ui/BaseModal` with `portal` (the rail
// sits inside transformed, stacked dock chrome), `staggerChildren={false}`
// (the body is a flex column that must fill, and the stagger wrapper breaks
// the flex chain), the same 44px header bar — avatar, title, close — and the
// same `titleId` contract. It differs in exactly one dimension: a thread is a
// column of bubbles and fits `max-w-xl`; a triage pass is a 330px queue rail
// beside a card, so this one is wide and tall.
//
// THE VERDICT GOES THROUGH THE QUEUE'S OWN DOOR (`useReviewFeed.resolve`), the
// same one the deck and the rail's inline buttons write through, so a verdict
// recorded here and one recorded there cannot take different paths.
//
// IT STAYS OPEN AFTER A VERDICT. The queue rail is the point: a reviewer opens
// the case that needed an argument, rules on it, and the component advances to
// the next pending row on its own as the feed re-reads. Closing on every
// verdict would make the rail a one-shot detail pane again.

import { useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { ReviewFocusFlow } from '@/features/overview/sub_manual-review/components/ReviewFocusFlow';
import type { TriageDecision, TriageItem } from '@/features/agents/quick-answer/triage/triageTypes';
import { railBranchIdFor, triageItemsToReviews } from './railTriageReview';

const TITLE_ID = 'rail-review-modal-title';

export function RailReviewModal({
  item, queue, onClose, onResolve,
}: {
  /** The row the operator opened. Null closes the modal. */
  item: TriageItem | null;
  /**
   * The rail's visible queue, in the rail's own order — what the focus flow's
   * 330px sidebar lists. `item` is expected to be in it; when the feed has
   * polled it away it is not, and the flow simply opens at the head.
   */
  queue: readonly TriageItem[];
  onClose: () => void;
  /** The queue's own verdict door. Rejects on a failed write. */
  onResolve: (decision: TriageDecision) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);

  // The queue as Approvals reads it. `item` is appended when the feed can no
  // longer resolve it, so a row that polled away mid-read does not take the
  // open card with it.
  const items = useMemo<TriageItem[]>(() => {
    if (!item) return [];
    return queue.some((i) => i.id === item.id) ? [...queue] : [item];
  }, [item, queue]);

  const reviews = useMemo(() => triageItemsToReviews(items), [items]);
  const initialIndex = Math.max(0, items.findIndex((i) => i.id === item?.id));

  // `ReviewFocusFlow` keys every callback by the review id, which
  // `triageItemToReview` sets to `TriageItem.id` — so this is a lookup, never
  // a parse.
  const itemOf = useCallback(
    (id: string) => items.find((i) => i.id === id),
    [items],
  );

  const send = useCallback(
    (decision: TriageDecision) => {
      setIsProcessing(true);
      onResolve(decision)
        .catch(toastCatch('rail-review:resolve'))
        .finally(() => setIsProcessing(false));
    },
    [onResolve],
  );

  const onApprove = useCallback(
    (id: string, notes?: string) => {
      const target = itemOf(id);
      if (target) send({ item: target, verdict: 'accept', reason: notes });
    },
    [itemOf, send],
  );

  const onReject = useCallback(
    (id: string, notes?: string) => {
      const target = itemOf(id);
      if (target) send({ item: target, verdict: 'reject', reason: notes });
    },
    [itemOf, send],
  );

  /**
   * A suggested action resolves the item AND fires its branch — materially
   * different from a bare approval. The flow hands back the LABEL it rendered;
   * `railBranchIdFor` turns that into the id the dispatcher routes on. An
   * unresolvable label would fire the wrong branch, so it falls back to a plain
   * accept rather than guessing.
   */
  const onDispatchAction = useCallback(
    (id: string, action: string) => {
      const target = itemOf(id);
      if (!target) return;
      const branchId = railBranchIdFor(target, action);
      send({ item: target, verdict: 'accept', branchId, reason: branchId ? undefined : action });
    },
    [itemOf, send],
  );

  if (!item) return null;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-6xl"
      staggerChildren={false}
      panelClassName="flex h-[82vh] flex-col overflow-hidden rounded-modal border border-border bg-background shadow-elevation-4"
    >
      <div className="flex h-11 flex-shrink-0 items-center gap-2.5 border-b border-border bg-secondary/30 px-4">
        <PersonaIcon icon={item.personaIcon ?? null} color={item.source.color ?? null} size="w-4 h-4" />
        <h2 id={TITLE_ID} className="min-w-0 truncate typo-title">
          {t.monitor.grid_rail_triage_modal_aria}
        </h2>
        {/* `RailThreadModal`'s close is a raw element with `opacity-60`; both
            are census findings, so this one takes the kit primitive instead —
            the precedent is the modal SHELL, not its chrome's debt. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t.common.close}
          data-testid="rail-review-close"
          className="ml-auto flex-shrink-0"
          icon={<X className="h-4 w-4" />}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" data-testid="rail-review-modal">
        <ReviewFocusFlow
          reviews={reviews}
          initialIndex={initialIndex}
          onApprove={onApprove}
          onReject={onReject}
          onDispatchAction={onDispatchAction}
          isProcessing={isProcessing}
        />
      </div>
    </BaseModal>
  );
}

export default RailReviewModal;
