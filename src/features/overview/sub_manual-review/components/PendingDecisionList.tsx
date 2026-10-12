// Approvals › Pending — a HISTORY view's list of what still waits, with the
// Decision Deck as the one place a verdict is made.
//
// This replaced the inline `TriageFocus` the pending filter used to render.
// Deciding happens in the global deck (`openDecisionDeck`): "Decide N" opens
// the gates chip's queue from its most urgent card, and a row opens the same
// queue with that review on top. The checkboxes stay because the bulk bar
// (approve / reject a selection) is a list act, not a card act.
import { CheckSquare, Layers, Square } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ManualReviewItem } from '@/lib/types/types';

import { openChipDeck, reviewDecisionId } from '../libs/decisionDeckDoors';
import { InboxItem } from './ReviewListItem';

interface PendingDecisionListProps {
  reviews: ManualReviewItem[];
  /** The pending total across every page (L0 counts), not just the loaded rows. */
  pendingTotal: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** L2 lazy-load — callback ref for the keyset sentinel at the list end. */
  sentinelRef?: (el: HTMLElement | null) => void;
  hasMore?: boolean;
}

export function PendingDecisionList({
  reviews,
  pendingTotal,
  selectedIds,
  onToggleSelect,
  sentinelRef,
  hasMore,
}: PendingDecisionListProps) {
  const { t, tx } = useTranslation();
  const count = Math.max(pendingTotal, reviews.length);

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="pending-decision-list">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/10 flex-shrink-0">
        <p className="flex-1 min-w-0 typo-body text-foreground">{t.overview.dc_pending_lead}</p>
        <Tooltip content={t.overview.dc_decide_tip} placement="bottom">
          <Button
            variant="primary"
            size="sm"
            icon={<Layers className="w-3.5 h-3.5" aria-hidden />}
            onClick={(e) => openChipDeck('gates', undefined, e.currentTarget)}
            data-testid="pending-decide-all"
            data-count={count}
          >
            {tx(t.overview.dc_decide_n, { count })}
          </Button>
        </Tooltip>
      </div>

      {/* Plain blocks, not <ul>/<li>: `InboxItem` (the shared DecisionRow) renders
          its own <li>, exactly as in ReviewInboxPanel. */}
      <div role="group" className="flex-1 min-h-0 overflow-y-auto" aria-label={t.overview.dc_pending_list_aria}>
        {reviews.map((review) => (
          <div key={review.id} className="flex items-start">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onToggleSelect(review.id)}
              role="checkbox"
              aria-checked={selectedIds.has(review.id)}
              aria-label={t.overview.dc_select_review}
              className="flex-shrink-0 mt-2 ml-0.5"
            >
              {selectedIds.has(review.id) ? (
                <CheckSquare className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
            </Button>
            <div className="flex-1 min-w-0">
              <InboxItem
                review={review}
                isActive={false}
                onClick={() =>
                  openChipDeck(
                    'gates',
                    reviewDecisionId(review.id),
                    document.querySelector(`[data-testid="review-row-${review.id}"]`),
                  )
                }
              />
            </div>
          </div>
        ))}
        {/* Keyset sentinel: scrolling near it pulls the next page. No spinner —
            the next page's rows ARE the progress. */}
        {hasMore && <div ref={sentinelRef} aria-hidden className="h-8" />}
      </div>
    </div>
  );
}
