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

/**
 * Accept is the primary affordance; reject opens a comment field (rejection
 * always carries a reason — it becomes the feedback the team reworks against).
 */
export function AcceptRejectControls({
  onAccept,
  onReject,
  size = 'md',
}: {
  onAccept: () => void;
  onReject: (comment: string) => void;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const pad = size === 'sm' ? 'px-2 py-1' : 'px-2.5 py-1.5';

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <textarea
          autoFocus
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={dl.accept_send_back_placeholder}
          rows={2}
          className="w-full px-2 py-1.5 typo-caption bg-secondary/50 rounded-input text-foreground placeholder:text-muted-foreground focus-ring resize-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => onReject(comment.trim())}
            className="inline-flex items-center gap-1 typo-caption rounded-interactive px-2 py-1 text-[var(--destructive)] bg-[var(--destructive)]/15 hover:bg-[var(--destructive)]/25 transition-colors disabled:opacity-40"
          >
            <Send className="w-3 h-3" /> {dl.accept_send_back}
          </button>
          <button
            type="button"
            onClick={() => { setRejecting(false); setComment(''); }}
            className="typo-caption rounded-interactive px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
          >
            {dl.accept_cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onAccept}
        className={`inline-flex items-center gap-1 typo-caption rounded-interactive ${pad} text-[var(--success)] bg-[var(--success)]/15 hover:bg-[var(--success)]/25 transition-colors`}
      >
        <Check className="w-3.5 h-3.5" /> {dl.accept_accept}
      </button>
      <button
        type="button"
        onClick={() => setRejecting(true)}
        aria-label={dl.accept_send_back}
        title={dl.accept_send_back}
        className={`inline-flex items-center gap-1 typo-caption rounded-interactive ${pad} text-muted-foreground bg-primary/10 hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15 transition-colors`}
      >
        <RotateCcw className="w-3.5 h-3.5" /> {dl.accept_send_back}
      </button>
    </div>
  );
}
