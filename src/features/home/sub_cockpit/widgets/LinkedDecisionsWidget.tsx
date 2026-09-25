import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react';

import { listManualReviewsByExecution } from '@/api/overview/reviews';
import { resolveReviewRow } from '@/lib/decisions/rowWrites';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import {
  ContextDataPreview,
  SeverityIndicator,
} from '@/features/overview/sub_manual-review/components/ReviewListItem';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Linked decisions — manual reviews tied to the contextual message's
 * `execution_id`. Mirrors the Section IV behaviour from the message
 * detail modal so the user can resolve from the cockpit too.
 *
 * Config:
 *   { executionId: string, personaId: string }
 */
export function LinkedDecisionsWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const executionId = (config?.executionId as string | undefined) ?? '';

  const [reviews, setReviews] = useState<PersonaManualReview[]>([]);
  const [loading, setLoading] = useState(true);
  // A thrown list call used to become `[]`, which rendered the same italic
  // "no linked decisions" line as a genuinely clean desk - so a down IPC told
  // the user there was nothing to decide while a review sat pending.
  const [error, setError] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!executionId) {
      setReviews([]);
      setError(false);
      setLoading(false);
      return;
    }
    // Law 1: a refetch never hides rows already on screen. Ghosts only when
    // the list is still empty (cold open). Resolve/reject drops the id locally
    // and revalidates underneath.
    setError(false);
    listManualReviewsByExecution(executionId)
      .then((rows) => setReviews(rows.filter((r) => r.status === 'pending')))
      .catch((err) => {
        silentCatch('LinkedDecisionsWidget:listManualReviewsByExecution')(err);
        setReviews([]);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [executionId]);

  useEffect(() => { reload(); }, [reload]);

  // One-shot row cascade: entries are latched for the widget's lifetime (no
  // resetKey), so a reload triggered by resolving one review never replays
  // the entrance for reviews already on screen.
  const enter = useRevealTracker();

  const resolve = useCallback(async (review: PersonaManualReview, status: 'approved' | 'rejected') => {
    if (resolvingId) return;
    setResolvingId(review.id);
    try {
      await resolveReviewRow(review, status);
      setReviews((rs) => rs.filter((r) => r.id !== review.id));
      reload();
    } catch (err) {
      toastCatch('Failed to update review')(err);
      // A conflict means someone else's verdict is the truth — re-read so the
      // widget stops offering a decision that has already been made.
      reload();
    } finally {
      setResolvingId(null);
    }
  }, [resolvingId, reload]);

  return (
    <div
      data-testid="cockpit-widget-linked_decisions"
      className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="typo-caption text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-foreground" />
          {title ?? t.overview.cockpit.linked_decisions_title}
        </div>
        {!loading && !error && (
          <span className="typo-caption text-foreground">{reviews.length}</span>
        )}
      </div>

      {loading && reviews.length === 0 ? (
        <div className="flex-1 grid grid-cols-1 gap-2" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-input bg-foreground/[0.04] h-16 animate-fade-in"
              style={{ animationDelay: `${120 + i * 35}ms` }}
            />
          ))}
        </div>
      ) : error && reviews.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <InlineErrorBanner
            compact
            className="w-full"
            message={t.overview.cockpit.linked_decisions_error}
            onRetry={reload}
          />
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption text-foreground italic">
          {t.overview.cockpit.linked_decisions_empty}
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto min-h-0">
          {reviews.map((r, index) => (
            <RevealItem
              key={r.id}
              revealId={r.id}
              order={index}
              hasEntered={enter.hasEntered}
              markEntered={enter.markEntered}
              data-testid={`cockpit-pending-review-row-${r.id}`}
              className="rounded-input border border-foreground/10 bg-background/40 px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <SeverityIndicator severity={r.severity} />
                <div className="min-w-0 flex-1">
                  <p className="typo-body text-foreground/95 truncate">{r.title}</p>
                  {r.description && (
                    <p className="typo-caption text-foreground mt-0.5 line-clamp-2">{r.description}</p>
                  )}
                  {r.context_data && (
                    <div className="mt-1.5 px-2 py-1.5 rounded-input bg-foreground/[0.03] border border-foreground/[0.06]">
                      <ContextDataPreview raw={r.context_data} />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  data-testid={`cockpit-pending-review-approve-${r.id}`}
                  onClick={() => resolve(r, 'approved')}
                  disabled={resolvingId === r.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
                >
                  {resolvingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                  {t.overview.cockpit.linked_decisions_approve}
                </button>
                <button
                  type="button"
                  data-testid={`cockpit-pending-review-reject-${r.id}`}
                  onClick={() => resolve(r, 'rejected')}
                  disabled={resolvingId === r.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
                >
                  {resolvingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
                  {t.overview.cockpit.linked_decisions_reject}
                </button>
              </div>
            </RevealItem>
          ))}
        </div>
      )}
    </div>
  );
}
