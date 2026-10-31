// @vitest-environment jsdom
/**
 * A question raised by a build session whose persona is not in the roster yet
 * (the roster loads on another clock) is labelled from the translation tree,
 * not from a hardcoded English literal. The mocked label is deliberately not
 * the English words, so only a hook that reads the tree can produce it.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const agentState = {
  buildSessions: {
    s1: {
      sessionId: 's1',
      personaId: 'ghost',
      phase: 'awaiting_input',
      pendingQuestions: [{ cellKey: 'k', question: 'Which?' }],
    },
  },
  personas: [] as unknown[],
  applyPendingAnswers: vi.fn(),
};

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: typeof agentState) => unknown) => sel(agentState),
}));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { monitor: { triage_untitled_agent: '«label from tree»' } } }),
}));
vi.mock('@/features/fleet/monitor/monitorDataContext', () => ({
  useSharedMonitorData: () => ({
    reviews: [],
    reviewsError: null,
    reviewsHasMore: false,
    loading: false,
    isProcessing: false,
    handleReviewAction: vi.fn(),
    handleDispatchAction: vi.fn(),
  }),
}));
vi.mock('@/features/fleet/monitor/useMonitorData', () => ({
  MONITOR_REVIEW_LIMIT: 50,
  useMonitorData: () => ({
    reviews: [],
    reviewsError: null,
    reviewsHasMore: false,
    loading: false,
    isProcessing: false,
    handleReviewAction: vi.fn(),
    handleDispatchAction: vi.fn(),
  }),
}));
vi.mock('@/api/agents/buildSession', () => ({ answerBuildQuestion: vi.fn() }));

import { usePendingInteractions } from '../usePendingInteractions';

describe('usePendingInteractions persona fallback', () => {
  it('names an unresolved persona from the translation tree', () => {
    const { result } = renderHook(() => usePendingInteractions());
    expect(result.current.questionGroups).toHaveLength(1);
    expect(result.current.questionGroups[0].personaName).toBe('«label from tree»');
  });
});
