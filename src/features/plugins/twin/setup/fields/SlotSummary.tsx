/**
 * A read-only band for a slot that is FINISHED SOMEWHERE ELSE.
 *
 * Channels and memories are not typed in here, and pretending otherwise with a
 * disabled-looking form would be worse than saying so: the band states where
 * the slot is worked and carries the jump that goes there, so the page never
 * dead-ends on a slot it does not own.
 */

import { ArrowRight } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';

interface SlotSummaryProps {
  /** One line: where this slot is actually worked. */
  body: string;
  actionLabel: string;
  onAction: () => void;
  testId: string;
}

export function SlotSummary({ body, actionLabel, onAction, testId }: SlotSummaryProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="typo-body min-w-0 flex-1">{body}</p>
      <Button
        variant="secondary"
        size="sm"
        onClick={onAction}
        data-testid={testId}
        iconRight={<ArrowRight className="w-3.5 h-3.5" />}
      >
        {actionLabel}
      </Button>
    </div>
  );
}

export default SlotSummary;
