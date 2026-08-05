// usePendingInteractions — data layer for the Quick Answer popover.
//
// Fuses the two things that block on the user into one actionable queue:
//   • build/adoption pending questions — read straight from matrixBuildSlice
//     (live globally via the eventBridge fallback even when the matrix surface
//     is unmounted, see eventBridge.ts), so a question raised while the user is
//     elsewhere shows up here.
//   • human reviews — reused from the Monitor's self-contained data layer
//     (handles local + cloud + inline action), mounted only while the popover
//     is open.
//
// Mount only when the popover is open — useMonitorData polls reviews.

import { useMemo, useCallback } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useMonitorData, type MonitorReviewItem } from '@/features/fleet/monitor/useMonitorData';
import { answerBuildQuestion } from '@/api/agents/buildSession';
import { buildBatchedAnswerPayload } from '@/lib/build/answerPayload';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

export interface QuestionGroup {
  sessionId: string;
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  questions: BuildQuestion[];
}

export interface QuickAnswerData {
  questionGroups: QuestionGroup[];
  /** Carries the resume-loop link (`assignment_id`/`step_id`) the deck needs to
   *  tell a held team step from an advisory review. */
  reviews: MonitorReviewItem[];
  /** Why {@link reviews} is short, when it is short because the read failed —
   *  see `useMonitorData#reviewsError`. Null while the last read succeeded. */
  reviewsError: string | null;
  /** True when the capped read left rows behind it — the deck reports it as a
   *  capped source rather than calling the queue finished. */
  reviewsHasMore: boolean;
  questionCount: number;
  reviewCount: number;
  total: number;
  loading: boolean;
  isProcessing: boolean;
  /** Submit a persona's collected answers as one CLI batch (route-independent). */
  submitQuestionAnswers: (sessionId: string, answers: Record<string, string>) => Promise<void>;
  handleReviewAction: (id: string, status: ManualReviewStatus, notes?: string) => Promise<void>;
  /** Phase 4 — choose a suggested action: resolves + dispatches a follow-up run. */
  handleDispatchAction: (id: string, action: string) => Promise<void>;
}

/** A question that needs the full builder UI (file/URL attach or connector
 *  picker) rather than a plain inline answer. The Quick Answer popover defers
 *  these to "Open in builder" — the C-ready deep-link seam. */
export function isComplexQuestion(q: BuildQuestion): boolean {
  return !!(q.connectorCategory || q.acceptsReference || q.acceptsWebhookSource);
}

/**
 * What this surface can actually render.
 *
 * Neither unread messages nor persona health summaries appear anywhere in this
 * hook's return type, so neither gets a poller. Before this, opening Quick
 * Answer started a `list_messages(300)` query and a `fetchPersonaSummaries()`
 * every 30 seconds for the entire time it was open, and threw both away.
 *
 * A module constant, not an inline literal: it is a hook argument, and a fresh
 * object per render is exactly the kind of churn the rest of this pass removes.
 */
/**
 * The pending-review working set this surface deals from.
 *
 * `list_manual_reviews` takes no limit, so the deck's 30-second poll re-read and
 * re-shaped EVERY pending row on every tick. This is a working set, not an
 * archive — the same posture the ideas keyset page has always had — and the cap
 * is reported (`reviewsHasMore` → the queue's `backlog.capped`) so a truncated
 * read can never be presented as a finished queue.
 *
 * 100 rather than the command's default 40: a reviewer who opens the deck to
 * clear a backlog should get the whole backlog in one deal on any realistic
 * install, and the cap exists to bound a pathological queue rather than to page
 * a normal one.
 */
const DECK_REVIEW_LIMIT = 100;

const DECK_FEEDS = {
  messages: false,
  personaHealth: false,
  reviewLimit: DECK_REVIEW_LIMIT,
} as const;

export function usePendingInteractions(): QuickAnswerData {
  const buildSessions = useAgentStore((s) => s.buildSessions);
  const personas = useAgentStore((s) => s.personas);
  const applyPendingAnswers = useAgentStore((s) => s.applyPendingAnswers);

  const {
    reviews,
    reviewsError,
    reviewsHasMore,
    loading,
    isProcessing,
    handleReviewAction,
    handleDispatchAction,
  } = useMonitorData(DECK_FEEDS);

  const questionGroups = useMemo<QuestionGroup[]>(() => {
    const personaById = new Map(personas.map((p) => [p.id, p]));
    const groups: QuestionGroup[] = [];
    for (const sess of Object.values(buildSessions)) {
      if (sess.phase !== 'awaiting_input') continue;
      if (!sess.pendingQuestions || sess.pendingQuestions.length === 0) continue;
      const p = personaById.get(sess.personaId);
      groups.push({
        sessionId: sess.sessionId,
        personaId: sess.personaId,
        personaName: p?.name ?? 'Untitled agent',
        personaIcon: p?.icon ?? null,
        personaColor: p?.color ?? null,
        questions: sess.pendingQuestions,
      });
    }
    return groups;
  }, [buildSessions, personas]);

  const submitQuestionAnswers = useCallback(
    async (sessionId: string, answers: Record<string, string>) => {
      if (Object.keys(answers).length === 0) return;
      const payload = buildBatchedAnswerPayload(answers);
      // WRITE FIRST, then clear.
      //
      // This used to call `applyPendingAnswers` before awaiting, which was a
      // one-way optimistic mutation with no rollback: on a rejected write the
      // questions were already gone from `buildSessions`, so the card could not
      // be re-derived from anything. The CLI stayed halted at `awaiting_input`
      // and the answer the user had just typed was unrecoverable from this
      // surface — the one failure mode where being optimistic costs data rather
      // than latency.
      //
      // Nothing perceptible is lost: the triage deck already resolves its card
      // the moment the reviewer decides and restores it on rejection, so the
      // deck's responsiveness never depended on this store write landing early.
      // The popover simply keeps showing the questions until the CLI has them.
      await answerBuildQuestion(sessionId, '_batch', payload);
      // The CLI confirms via cell_update / session_status events through the
      // global eventBridge; this keeps the popover in step without waiting for
      // the first event to land.
      applyPendingAnswers(sessionId, answers);
    },
    [applyPendingAnswers],
  );

  const questionCount = useMemo(
    () => questionGroups.reduce((n, g) => n + g.questions.length, 0),
    [questionGroups],
  );

  // Memoised: `useUnifiedTriage` derives its injected write ports from this
  // object, and every card in the deck ultimately takes its `onCommit` from
  // those. A fresh object per render made all three stacked cards re-render (and
  // re-parse their markdown) on every keystroke in the answer box.
  return useMemo(
    () => ({
      questionGroups,
      reviews,
      reviewsError,
      reviewsHasMore,
      questionCount,
      reviewCount: reviews.length,
      total: questionCount + reviews.length,
      loading,
      isProcessing,
      submitQuestionAnswers,
      handleReviewAction,
      handleDispatchAction,
    }),
    [
      questionGroups,
      reviews,
      reviewsError,
      reviewsHasMore,
      questionCount,
      loading,
      isProcessing,
      submitQuestionAnswers,
      handleReviewAction,
      handleDispatchAction,
    ],
  );
}
