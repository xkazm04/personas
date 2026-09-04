import { useCallback, useEffect, useState } from 'react';
import { getReportDeliveries } from '@/api/overview/reports';
import {
  createMemory, updateMemoryContent, listMemoriesByExecution,
} from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import { resolveReviewRow } from '@/lib/decisions/rowWrites';
import { useAgentStore } from '@/stores/agentStore';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaReport } from '@/lib/types/types';
import type { PersonaReportDelivery } from '@/lib/bindings/PersonaReportDelivery';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { buildFeedbackInstruction, buildFeedbackChatTitle } from './feedbackInstruction';

type T = ReturnType<typeof useTranslation>['t'];
type Tx = ReturnType<typeof useTranslation>['tx'];

/**
 * Tag stamped on every rating-derived memory. Lets the upsert path find
 * the existing row for an (execution, persona) pair on a re-rate without
 * scanning all memories for substring matches.
 */
const RATING_MEMORY_TAG = 'message_rating';

/**
 * Memory category used for ratings. `learned` = "Insights the agent derived
 * from past executions" — semantically correct, and persists across persona
 * runs via the standard memory-injection pipeline.
 */
const RATING_MEMORY_CATEGORY = 'learned';

/** Channel deliveries for one report. */
export function useReportDeliveries(msgId: string) {
  const [deliveries, setDeliveries] = useState<PersonaReportDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(true);

  useEffect(() => {
    setDeliveriesLoading(true);
    getReportDeliveries(msgId)
      .then(setDeliveries)
      .catch((err) => {
        silentCatch('ReportDetailModal:getReportDeliveries')(err);
        setDeliveries([]);
      })
      .finally(() => setDeliveriesLoading(false));
  }, [msgId]);

  return { deliveries, deliveriesLoading };
}

/**
 * The report's star rating, stored as a persona memory rather than a column.
 *
 * Hydrates from the existing memory (if any) on mount and whenever the message
 * changes, so a row's current rating survives closing and reopening the modal;
 * a re-rate UPDATES that row rather than appending a second one, which is what
 * the `message_rating` tag is for.
 */
export function useReportRating(message: PersonaReport, t: T, tx: Tx) {
  const [rating, setRating] = useState<number>(0);
  const [ratingMemoryId, setRatingMemoryId] = useState<string | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

  useEffect(() => {
    setRating(0);
    setRatingMemoryId(null);
    if (!message.execution_id) return;
    let cancelled = false;
    listMemoriesByExecution(message.execution_id)
      .then((memories: PersonaMemory[]) => {
        if (cancelled) return;
        const existing = memories.find((m) =>
          m.persona_id === message.persona_id &&
          (m.tags ?? []).includes(RATING_MEMORY_TAG),
        );
        if (existing) {
          setRatingMemoryId(existing.id);
          // Importance 1..5 maps directly onto the star value.
          setRating(existing.importance);
        }
      })
      .catch(silentCatch('ReportDetailModal:listMemoriesByExecution'));
    return () => { cancelled = true; };
  }, [message.execution_id, message.persona_id]);

  const rate = useCallback(async (stars: number) => {
    if (!message.execution_id || ratingSaving) return;
    if (stars < 1 || stars > 5) return;

    setRatingSaving(true);
    const title = tx(t.overview.reports_view.rating_memory_title, { stars });
    const contentKey =
      stars >= 4 ? t.overview.reports_view.rating_memory_content_good :
      stars >= 3 ? t.overview.reports_view.rating_memory_content_neutral :
      t.overview.reports_view.rating_memory_content_poor;
    const content = tx(contentKey, { stars });

    try {
      if (ratingMemoryId) {
        await updateMemoryContent(
          ratingMemoryId, title, content, stars, [RATING_MEMORY_TAG],
        );
      } else {
        const created = await createMemory({
          persona_id: message.persona_id,
          title,
          content,
          category: RATING_MEMORY_CATEGORY,
          source_execution_id: message.execution_id,
          importance: stars,
          tags: [RATING_MEMORY_TAG],
          use_case_id: null,
        });
        setRatingMemoryId(created.id);
      }
      setRating(stars);
    } catch (err) {
      toastCatch('Failed to save rating')(err);
    } finally {
      setRatingSaving(false);
    }
  }, [message.execution_id, message.persona_id, ratingMemoryId, ratingSaving, t, tx]);

  return { rating, ratingSaving, rate };
}

/** Pending manual reviews raised by the same execution as this report. */
export function useLinkedReviews(message: PersonaReport) {
  const [linkedReviews, setLinkedReviews] = useState<PersonaManualReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [resolvingReviewId, setResolvingReviewId] = useState<string | null>(null);

  const reloadReviews = useCallback(() => {
    if (!message.execution_id || !message.persona_id) {
      setLinkedReviews([]);
      setReviewsLoading(false);
      return;
    }
    setReviewsLoading(true);
    listManualReviews(message.persona_id, 'pending')
      .then((rows) => {
        setLinkedReviews(rows.filter((r) => r.execution_id === message.execution_id));
      })
      .catch((err) => {
        silentCatch('ReportDetailModal:listManualReviews')(err);
        setLinkedReviews([]);
      })
      .finally(() => setReviewsLoading(false));
  }, [message.execution_id, message.persona_id]);

  useEffect(() => {
    reloadReviews();
  }, [reloadReviews]);

  const resolveReview = useCallback(async (
    review: PersonaManualReview,
    status: 'approved' | 'rejected',
  ) => {
    if (resolvingReviewId) return;
    setResolvingReviewId(review.id);
    try {
      await resolveReviewRow(review, status);
      reloadReviews();
    } catch (err) {
      toastCatch('Failed to update review')(err);
      reloadReviews();
    } finally {
      setResolvingReviewId(null);
    }
  }, [resolvingReviewId, reloadReviews]);

  return { linkedReviews, reviewsLoading, resolvingReviewId, resolveReview };
}

/**
 * The "what could be better" panel: free-form feedback that opens a dedicated
 * chat with the persona rather than filing a note nobody reads.
 */
export function useReportFeedback(message: PersonaReport) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [improving, setImproving] = useState<'idle' | 'loading' | 'sent'>('idle');
  const startFeedbackChat = useAgentStore((s) => s.startFeedbackChat);

  const reset = useCallback(() => {
    setShowFeedback(false);
    setFeedbackText('');
    setImproving('idle');
  }, []);

  const improve = useCallback(async () => {
    if (!feedbackText.trim() || improving === 'loading') return;
    setImproving('loading');
    try {
      const personas = useAgentStore.getState().personas;
      const persona = personas.find((p) => p.id === message.persona_id);
      const instruction = buildFeedbackInstruction(message, feedbackText);
      const title = buildFeedbackChatTitle(message);

      await startFeedbackChat({
        personaId: message.persona_id,
        personaName: persona?.name ?? message.persona_name ?? undefined,
        sourceMessageId: message.id,
        instruction,
        title,
      });

      setImproving('sent');
    } catch {
      setImproving('idle');
    }
  }, [feedbackText, improving, message, startFeedbackChat]);

  return {
    showFeedback, setShowFeedback,
    feedbackText, setFeedbackText,
    improving, improve, reset,
  };
}
