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
// Mount only when the popover is open — useMonitorData polls reviews/messages.

import { useMemo, useCallback } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useMonitorData } from '@/features/shared/components/layout/monitor/useMonitorData';
import { answerBuildQuestion } from '@/api/agents/buildSession';
import { buildBatchedAnswerPayload } from '@/lib/build/answerPayload';
import type { BuildQuestion } from '@/lib/types/buildTypes';
import type { ManualReviewItem } from '@/lib/types/types';
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
  reviews: ManualReviewItem[];
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

export function usePendingInteractions(): QuickAnswerData {
  const buildSessions = useAgentStore((s) => s.buildSessions);
  const personas = useAgentStore((s) => s.personas);
  const applyPendingAnswers = useAgentStore((s) => s.applyPendingAnswers);

  const { reviews, loading, isProcessing, handleReviewAction, handleDispatchAction } = useMonitorData();

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
      // Optimistic: clear the answered questions immediately so the popover
      // updates without waiting for the backend round-trip. The CLI confirms
      // via cell_update / session_status events through the global eventBridge.
      applyPendingAnswers(sessionId, answers);
      await answerBuildQuestion(sessionId, '_batch', payload);
    },
    [applyPendingAnswers],
  );

  const questionCount = useMemo(
    () => questionGroups.reduce((n, g) => n + g.questions.length, 0),
    [questionGroups],
  );

  return {
    questionGroups,
    reviews,
    questionCount,
    reviewCount: reviews.length,
    total: questionCount + reviews.length,
    loading,
    isProcessing,
    submitQuestionAnswers,
    handleReviewAction,
    handleDispatchAction,
  };
}
