// Accept / reject controls — the one gesture shared by every surface that lets
// a human resolve a completed goal (the Triage queue and the goal detail
// drawer).
//
// This file used to also carry a team monogram, a KPI mini-gauge, a KPI divider
// and an empty state built for `AcceptanceTriagePolished`. That component was
// replaced by the shared `triage/GoalsTriage`, which renders its own KPI gauge
// from the triage model, so those pieces (and the `goalAcceptanceModel` view
// model behind them) were deleted rather than left as a second vocabulary for
// the same ideas.
import { useState } from 'react';
import { Check, RotateCcw, Send } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * Accept is the primary affordance; reject opens a comment field (rejection
 * always carries a reason — it becomes the feedback the team reworks against).
 */
export function AcceptRejectControls({
  onAccept,
  onReject,
  onSendBackIntent,
  size = 'md',
}: {
  onAccept: () => void;
  onReject: (comment: string) => void;
  /** When set, Send back hands off here (a host too small for the comment field) instead of opening it inline. */
  onSendBackIntent?: () => void;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <textarea
          autoFocus
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={dl.accept_send_back_placeholder}
          rows={2}
          className="w-full px-2 py-1.5 typo-caption bg-surface-1 rounded-input text-foreground placeholder:text-ink-3 focus-ring resize-none"
        />
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm"
            type="button"
            disabled={!comment.trim()}
            onClick={() => onReject(comment.trim())}
          >
            <Send className="w-3 h-3" /> {dl.accept_send_back}
          </Button>
          <Button variant="ghost" size="sm"
            type="button"
            onClick={() => { setRejecting(false); setComment(''); }}
          >
            {dl.accept_cancel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="accent" tone="success" size={size === 'sm' ? 'xs' : 'sm'}
        type="button"
        onClick={onAccept}
      >
        <Check className="w-3.5 h-3.5" /> {dl.accept_accept}
      </Button>
      <Tooltip content={dl.accept_send_back}><Button variant="ghost" size={size === 'sm' ? 'xs' : 'sm'}
        type="button"
        onClick={() => (onSendBackIntent ? onSendBackIntent() : setRejecting(true))}
        aria-label={dl.accept_send_back}
      >
        <RotateCcw className="w-3.5 h-3.5" /> {dl.accept_send_back}
      </Button></Tooltip>
    </div>
  );
}
