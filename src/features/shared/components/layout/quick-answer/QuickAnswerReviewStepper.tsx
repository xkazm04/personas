import { useEffect, useState } from 'react';
import { Check, X, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { severityBucket, SEVERITY_META } from '@/features/shared/components/layout/monitor/monitorModel';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

/**
 * ONE decision at a time. The popover used to stack every pending review as a
 * title-only card — so the user approved blind, and long descriptions were
 * invisible. This walks the queue one review at a time, showing the FULL,
 * untruncated description (markdown) + the suggested actions, so the user
 * knows exactly what they are approving before they click.
 */

/** Parse the suggested-actions JSON (`{actions:[...]}` or a bare array/string). */
function parseActions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    if (v && typeof v === 'object' && Array.isArray((v as { actions?: unknown }).actions)) {
      return (v as { actions: unknown[] }).actions.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    if (raw.trim()) return [raw.trim()];
  }
  return [];
}

export function QuickAnswerReviewStepper({
  reviews,
  busy,
  onAction,
}: {
  reviews: ManualReviewItem[];
  busy: boolean;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const [idx, setIdx] = useState(0);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  // Keep the cursor in range as reviews resolve and drop out of the list.
  const safeIdx = Math.min(idx, Math.max(0, reviews.length - 1));
  useEffect(() => {
    if (idx !== safeIdx) setIdx(safeIdx);
  }, [idx, safeIdx]);
  // Reset the per-decision note when the visible review changes.
  const review = reviews[safeIdx];
  useEffect(() => {
    setNote('');
    setShowNote(false);
  }, [review?.id]);

  if (reviews.length === 0 || !review) return null;
  const sev = SEVERITY_META[severityBucket(review.severity)];
  const actions = parseActions(review.suggested_actions);

  const act = async (status: ManualReviewStatus) => {
    await onAction(review.id, status, note.trim() || undefined);
    // The resolved review drops from the list; the index stays, naturally
    // landing on the next one (or clamps when it was the last).
  };

  return (
    <div className="rounded-card border border-card-border bg-card-bg/60 flex flex-col" data-testid="quick-answer-review-stepper">
      {/* Queue position + prev/next */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-card-border/60">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sev.dot}`} aria-hidden />
        <span className="typo-caption text-foreground/55 tabular-nums">
          {tx(t.monitor.quick_decision_position, { current: safeIdx + 1, total: reviews.length })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={safeIdx === 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            className="p-1 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            aria-label="Previous decision"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={safeIdx >= reviews.length - 1}
            onClick={() => setIdx((i) => Math.min(reviews.length - 1, i + 1))}
            className="p-1 rounded-interactive text-foreground/50 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            aria-label="Next decision"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* The decision — full content, no truncation */}
      <div className="px-3 py-3 flex flex-col gap-2 max-h-[42vh] overflow-y-auto">
        <div className="flex items-center gap-2 min-w-0">
          <PersonaIcon icon={review.persona_icon ?? null} color={review.persona_color ?? null} display="framed" frameSize="sm" />
          <div className="min-w-0">
            <div className="typo-body font-semibold text-foreground">{review.title}</div>
            {review.persona_name && <div className="typo-caption text-foreground/60 truncate">{review.persona_name}</div>}
          </div>
        </div>

        {review.content && (
          <div className="rounded-card border border-card-border bg-background/40 px-3 py-2">
            <MarkdownRenderer content={review.content} className="typo-body leading-relaxed" />
          </div>
        )}

        {actions.length > 0 && (
          <div>
            <p className="typo-label uppercase tracking-wider text-foreground/55 mb-1">{t.monitor.quick_suggested_actions}</p>
            <ul className="space-y-1">
              {actions.map((a, i) => (
                <li key={i} className="typo-caption text-foreground/75 flex gap-1.5">
                  <span className="text-primary/60">→</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showNote && (
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.monitor.quick_answer_placeholder}
            className="px-3 py-1.5 rounded-input bg-primary/5 border border-card-border typo-caption text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
          />
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-card-border/60">
        <Button variant="ghost" size="xs" onClick={() => setShowNote((v) => !v)} aria-pressed={showNote} aria-label={t.monitor.quick_note} className="px-1.5">
          <MessageSquare className="w-3.5 h-3.5" />
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="danger" size="xs" disabled={busy} onClick={() => void act('rejected')} data-testid={`quick-answer-reject-${review.id}`}>
            <X className="w-3 h-3" />
            {t.monitor.quick_reject}
          </Button>
          <Button variant="primary" size="xs" disabled={busy} onClick={() => void act('approved')} data-testid={`quick-answer-approve-${review.id}`}>
            <Check className="w-3 h-3" />
            {t.monitor.quick_approve}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default QuickAnswerReviewStepper;
