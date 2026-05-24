import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react';

import { listManualReviews, updateManualReviewStatus } from '@/api/overview/reviews';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import {
  ContextDataPreview,
  SeverityIndicator,
} from '@/features/overview/sub_manual-review/components/ReviewListItem';
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
  const personaId = (config?.personaId as string | undefined) ?? '';

  const [reviews, setReviews] = useState<PersonaManualReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!executionId || !personaId) {
      setReviews([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    listManualReviews(personaId, 'pending')
      .then((rows) => setReviews(rows.filter((r) => r.execution_id === executionId)))
      .catch((err) => {
        silentCatch('LinkedDecisionsWidget:listManualReviews')(err);
        setReviews([]);
      })
      .finally(() => setLoading(false));
  }, [executionId, personaId]);

  useEffect(() => { reload(); }, [reload]);

  const resolve = useCallback(async (review: PersonaManualReview, status: 'approved' | 'rejected') => {
    if (resolvingId) return;
    setResolvingId(review.id);
    try {
      await updateManualReviewStatus(review.id, status);
      reload();
    } catch (err) {
      toastCatch('Failed to update review')(err);
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
        {!loading && (
          <span className="typo-caption text-foreground">{reviews.length}</span>
        )}
      </div>

      {loading ? (
        <div className="flex-1 grid grid-cols-1 gap-2 animate-pulse">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-input bg-foreground/[0.04] h-16" />
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption text-foreground italic">
          {t.overview.cockpit.linked_decisions_empty}
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto min-h-0">
          {reviews.map((r) => (
            <div
              key={r.id}
              data-testid={`cockpit-pending-review-row-${r.id}`}
              className="rounded-input border border-foreground/10 bg-background/40 px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <SeverityIndicator severity={r.severity} />
                <div className="min-w-0 flex-1">
                  <p className="typo-body font-medium text-foreground/95 truncate">{r.title}</p>
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
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption font-semibold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
                >
                  {resolvingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsUp className="w-3 h-3" />}
                  {t.overview.cockpit.linked_decisions_approve}
                </button>
                <button
                  type="button"
                  data-testid={`cockpit-pending-review-reject-${r.id}`}
                  onClick={() => resolve(r, 'rejected')}
                  disabled={resolvingId === r.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input typo-caption font-semibold bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
                >
                  {resolvingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ThumbsDown className="w-3 h-3" />}
                  {t.overview.cockpit.linked_decisions_reject}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
