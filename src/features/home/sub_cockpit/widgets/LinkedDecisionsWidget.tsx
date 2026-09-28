import { useCallback, useEffect, useState } from 'react';

import { listManualReviewsByExecution } from '@/api/overview/reviews';
import { resolveReviewRow } from '@/lib/decisions/rowWrites';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { ContextDataPreview } from '@/features/overview/sub_manual-review/components/ReviewListItem';
import { KitButton, ListRow, Rows, Tile } from '@/features/shared/components/kit';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { reviewTone } from './decisionMarks';

type Verdict = 'approved' | 'rejected';

/**
 * Linked decisions - manual reviews tied to the contextual message's
 * `execution_id`. Mirrors the Section IV behaviour from the message
 * detail modal so the user can resolve from the cockpit too.
 *
 * One kit Tile; each pending review is a row (severity as its Mark, the
 * title emphasised, Approve / Reject in the row's trail). A description every
 * review shares is said once, as the tile's meta, not under each title.
 * Approve is the tile's call to action (primary) when it is the only one.
 *
 * Config:
 *   { executionId: string, personaId: string }
 */
export function LinkedDecisionsWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const c = t.overview.cockpit;
  const executionId = (config?.executionId as string | undefined) ?? '';

  const [reviews, setReviews] = useState<PersonaManualReview[]>([]);
  const [loading, setLoading] = useState(true);
  // A thrown list call used to become `[]`, which rendered the same
  // "no linked decisions" line as a genuinely clean desk - so a down IPC told
  // the user there was nothing to decide while a review sat pending.
  const [error, setError] = useState(false);
  const [resolving, setResolving] = useState<{ id: string; verdict: Verdict } | null>(null);

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

  const resolve = useCallback(async (review: PersonaManualReview, verdict: Verdict) => {
    if (resolving) return;
    setResolving({ id: review.id, verdict });
    try {
      await resolveReviewRow(review, verdict);
      setReviews((rs) => rs.filter((r) => r.id !== review.id));
      reload();
    } catch (err) {
      toastCatch('Failed to update review')(err);
      // A conflict means someone else's verdict is the truth - re-read so the
      // widget stops offering a decision that has already been made.
      reload();
    } finally {
      setResolving(null);
    }
  }, [resolving, reload]);

  const shared = sharedDescription(reviews);
  const cold = reviews.length === 0;
  const verdictButton = (r: PersonaManualReview, verdict: Verdict) => (
    <KitButton
      tone={verdict === 'approved' ? (reviews.length === 1 ? 'primary' : 'default') : 'quiet'}
      testId={`cockpit-pending-review-${verdict === 'approved' ? 'approve' : 'reject'}-${r.id}`}
      onClick={() => resolve(r, verdict)}
      loading={resolving?.id === r.id && resolving.verdict === verdict}
      disabled={resolving?.id === r.id && resolving.verdict !== verdict}
    >
      {verdict === 'approved' ? c.linked_decisions_approve : c.linked_decisions_reject}
    </KitButton>
  );

  return (
    <Tile
      span={span}
      title={title ?? c.linked_decisions_title}
      count={!loading && !error ? reviews.length : undefined}
      meta={shared ?? undefined}
      actions={actions}
      footer={footer}
      testId="cockpit-widget-linked_decisions"
      state={loading && cold ? 'loading' : undefined}
      ghostRows={2}
      error={error && cold ? {
        title: <span role="alert">{c.linked_decisions_error}</span>,
        markLabel: c.linked_decisions_error,
        action: <KitButton onClick={reload}>{t.common.retry}</KitButton>,
      } : undefined}
    >
      <Rows count={reviews.length} empty={{ title: c.linked_decisions_empty }}>
        {reviews.flatMap((r) => {
          const row = (
            <ListRow
              key={r.id}
              testId={`cockpit-pending-review-row-${r.id}`}
              name={r.title}
              meta={shared ? undefined : r.description ?? undefined}
              mark={{ tone: reviewTone(r.severity), label: tokenLabel(t, 'severity', r.severity) }}
              figures={<>{verdictButton(r, 'approved')}{verdictButton(r, 'rejected')}</>}
            />
          );
          // style-deviation: the review's context blob has no fixed height, so it sits under its row
          // rather than in it; only reviews that carry one get the block.
          return r.context_data
            ? [row, <div key={`${r.id}-ctx`} className="k-in py-2"><ContextDataPreview raw={r.context_data} /></div>]
            : [row];
        })}
      </Rows>
    </Tile>
  );
}

/** The description when every review says the same thing (and there is more than one). */
function sharedDescription(reviews: readonly PersonaManualReview[]): string | null {
  if (reviews.length < 2) return null;
  const first = reviews[0]!.description;
  return first && reviews.every((r) => r.description === first) ? first : null;
}
