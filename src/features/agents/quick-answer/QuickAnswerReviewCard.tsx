import { useState } from 'react';
import { Check, X, MessageSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { severityBucket, SEVERITY_META } from '@/features/fleet/monitor/monitorModel';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

interface QuickAnswerReviewCardProps {
  review: ManualReviewItem;
  busy: boolean;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
}

/** Compact, inline approve/reject for a pending human review. Rich notes /
 *  context stay in the full Monitor — this is the fast path. */
export function QuickAnswerReviewCard({ review, busy, onAction }: QuickAnswerReviewCardProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const sev = SEVERITY_META[severityBucket(review.severity)];

  const act = (status: ManualReviewStatus) => {
    void onAction(review.id, status, note.trim() || undefined);
  };

  return (
    <div
      className="rounded-card border border-card-border bg-card-bg/60 p-3 flex flex-col gap-2"
      data-testid={`quick-answer-review-${review.id}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <PersonaIcon icon={review.persona_icon ?? null} color={review.persona_color ?? null} display="framed" frameSize="sm" />
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`} aria-hidden />
        <span className="typo-body font-semibold text-foreground truncate min-w-0">{review.title}</span>
      </div>
      {review.persona_name && (
        <span className="typo-caption text-foreground truncate">{review.persona_name}</span>
      )}

      {showNote && (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.monitor.quick_answer_placeholder}
          className="px-3 py-1.5 rounded-input bg-primary/5 border border-card-border typo-caption text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
          data-testid={`quick-answer-review-note-${review.id}`}
        />
      )}

      <div className="flex items-center gap-1.5 self-end">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setShowNote((v) => !v)}
          aria-pressed={showNote}
          aria-label={t.monitor.quick_note}
          className="px-1.5"
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </Button>
        <Button variant="danger" size="xs" disabled={busy} onClick={() => act('rejected')} data-testid={`quick-answer-reject-${review.id}`}>
          <X className="w-3 h-3" />
          {t.monitor.quick_reject}
        </Button>
        <Button variant="primary" size="xs" disabled={busy} onClick={() => act('approved')} data-testid={`quick-answer-approve-${review.id}`}>
          <Check className="w-3 h-3" />
          {t.monitor.quick_approve}
        </Button>
      </div>
    </div>
  );
}
