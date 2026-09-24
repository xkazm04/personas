// The margin beside the loupe: the grease pencil for this frame, who made it
// (blind until the owner unmasks it or the roll is decided), the frame's
// review sheet (note + pins) and the trays of the whole roll.
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import { ReviewSheet } from '../../components/ReviewSheet';
import type { ReviewDraft } from '../../hooks/useReviewDraft';
import { CONTACT_COPY as C } from './copy';
import { seatSpecForVariant } from './contactModel';
import { GreaseMarks, SortTrays } from './GreaseTrays';
import { SpecChips } from './SpecChips';

export interface LoupeSideProps {
  detail: ContestDetail;
  variant: ContestVariant;
  draft: ReviewDraft;
  unmasked: boolean;
  onUnmaskedChange: (on: boolean) => void;
  onPick: (key: string) => void;
}

export function LoupeSide({ detail, variant, draft, unmasked, onUnmaskedChange, onPick }: LoupeSideProps) {
  const decided = detail.summary.phase === 'decided';
  const spec = seatSpecForVariant(detail, variant);
  const showSeat = decided || unmasked;

  return (
    <aside className="space-y-4" aria-label={C.loupeTitle} data-testid="contact-loupe-side">
      <GreaseMarks draft={draft} variantKey={variant.key} />

      <div className="space-y-1.5" data-testid="contact-made-by">
        <div className="flex items-center gap-2">
          <span className="typo-label text-foreground flex-1">{C.madeBy}</span>
          {!decided && (
            <Tooltip content={C.unmaskHint}>
              <span>
                <AccessibleToggle checked={unmasked} onChange={() => onUnmaskedChange(!unmasked)} label={C.unmask} size="sm" />
              </span>
            </Tooltip>
          )}
        </div>
        {showSeat && spec ? (
          <SpecChips spec={spec} />
        ) : (
          <p className="typo-caption text-foreground">{C.blindSeat}</p>
        )}
      </div>

      <ReviewSheet variant={variant} draft={draft} />

      {draft.review && <SortTrays review={draft.review} current={variant.key} onPick={onPick} />}
    </aside>
  );
}
