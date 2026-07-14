import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { listManualReviews, updateManualReviewStatus } from '@/api/overview/reviews';
import { QuickAnswerReviewCard } from '@/features/agents/quick-answer/QuickAnswerReviewCard';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { silentCatch } from '@/lib/silentCatch';
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

  const memberIds = useMemo(() => new Set(members.map((m) => m.personaId)), [members]);

  const refresh = useCallback(() => {
    listManualReviews(undefined, 'pending')
      .then((rows) => {
        setReviews(
          rows
            .filter((r) => memberIds.has(r.persona_id))
            .map((r): ManualReviewItem => {
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
      .catch(silentCatch('conversation:pendingReviews'));
  }, [memberIds, personaIndex]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (id: string, status: ManualReviewStatus, notes?: string) => {
    setBusy(true);
    try {
      await updateManualReviewStatus(id, status, notes);
      setReviews((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      silentCatch('conversation:resolveReview')(e);
    } finally {
      setBusy(false);
    }
  };

  if (reviews.length === 0) {
    return (
      <p className="typo-caption text-foreground opacity-45 p-2">{t.monitor.reviews_empty}</p>
    );
  }

  return (
    <div className="space-y-2">
      {reviews.map((r) => (
        <QuickAnswerReviewCard key={r.id} review={r} busy={busy} onAction={act} />
      ))}
    </div>
  );
}
