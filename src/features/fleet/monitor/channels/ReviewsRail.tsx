import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { listManualReviewsPage } from '@/api/overview/reviews';
import { resolveReviewRow } from '@/lib/decisions/rowWrites';
import { QuickAnswerReviewCard } from '@/features/agents/quick-answer/QuickAnswerReviewCard';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { extractMessage, silentCatch, toastCatch } from '@/lib/silentCatch';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { ChannelMember } from '@/features/teams/sub_collab/collabRender';

/* ----------------------------------------------------------------------------
 * REVIEWS RAIL — the human gate.
 *
 * When a step hits `awaiting_review`, work STOPS until a person answers. That's
 * the single most time-critical thing a team channel can be telling you, and in
 * the old Collab pane it lived in a tray above the conversation.
 *
 * It moves to the rail rather than the timeline for the same reason the
 * deliberation controls did: a decision surface is not a message. But it stays
 * one click from the conversation that produced it.
 *
 * Deliberately lean (30s poll of pending reviews, scoped to this team's members)
 * — it is NOT worth `useMonitorData`'s heavier cadence just to badge a tray.
 * -------------------------------------------------------------------------- */

const POLL_MS = 30_000;

export function ReviewsRail({ members }: { members: ChannelMember[] }) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const [reviews, setReviews] = useState<ManualReviewItem[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * Loading and failing are not "nothing waiting".
   *
   * This rail's own header calls a held step "the single most time-critical
   * thing a team channel can be telling you" — and its fetch ended in
   * `silentCatch`, so an unreadable queue rendered the same reassuring
   * "Nothing is waiting on you." as an empty one. Two flags, three states.
   */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const memberIds = useMemo(() => new Set(members.map((m) => m.personaId)), [members]);

  const refresh = useCallback(() => {
    const ids = [...memberIds];
    if (ids.length === 0) {
      setError(null);
      setReviews([]);
      setLoading(false);
      return;
    }
    Promise.all(ids.map((personaId) => listManualReviewsPage({ personaId, status: 'pending', limit: 40 })))
      .then((pages) => {
        setError(null);
        const rows = pages.flatMap((p) => p.rows);
        setReviews(
          rows.map((r): ManualReviewItem => {
            const p = personaIndex.get(r.persona_id);
            return {
              id: r.id,
              persona_id: r.persona_id,
              execution_id: r.execution_id,
              review_type: '',
              content: r.description ?? '',
              severity: r.severity,
              status: r.status,
              reviewer_notes: r.reviewer_notes,
              context_data: r.context_data,
              suggested_actions: r.suggested_actions,
              title: r.title,
              created_at: r.created_at,
              resolved_at: r.resolved_at,
              persona_name: p?.name?.replace(/^T: /, '') ?? undefined,
              persona_icon: p?.icon ?? undefined,
              persona_color: p?.color ?? undefined,
            };
          }),
        );
      })
      .catch((e) => {
        setError(extractMessage(e));
        silentCatch('conversation:pendingReviews')(e);
      })
      .finally(() => setLoading(false));
  }, [memberIds, personaIndex]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (id: string, status: ManualReviewStatus, notes?: string) => {
    setBusy(true);
    try {
      // One door for the row type; local-only here (this rail lists local rows).
      await resolveReviewRow({ id, execution_id: '', source: 'local' }, status, notes);
      setReviews((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      // Was `silentCatch`: a failed verdict left the card on screen with no
      // explanation, and work stayed blocked on a step the reviewer believed
      // they had unblocked. A held team step is the most time-critical thing
      // this rail shows — it does not get to fail quietly.
      toastCatch('conversation:resolveReview')(e);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Rendered ABOVE whatever did load rather than instead of it: a partial
          read is still worth showing, and hiding the rows to display the
          failure would trade one silence for another. */}
      {error ? (
        <InlineErrorBanner
          severity="error"
          message={t.monitor.reviews_error}
          onRetry={refresh}
          compact
        />
      ) : null}
      {reviews.length === 0 && loading && !error ? (
        <div className="space-y-2" aria-busy="true" aria-label={t.monitor.reviews_loading}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              aria-hidden
              className="rounded-card bg-secondary/20 h-16 animate-fade-in"
              style={{ animationDelay: '150ms' }}
            />
          ))}
        </div>
      ) : null}
      {reviews.length === 0 && !loading && !error ? (
        <p className="typo-caption text-foreground opacity-45 p-2">{t.monitor.reviews_empty}</p>
      ) : null}
      {reviews.map((r) => (
        <QuickAnswerReviewCard key={r.id} review={r} busy={busy} onAction={act} />
      ))}
    </div>
  );
}
