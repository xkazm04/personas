// The Overview → Decision Deck doors: the focus ids each row hands the deck
// must be the ids the roster's adapters actually give that row (a mismatch
// opens the deck on the wrong card, silently), and the re-read hook must fire
// on a close and only on a close.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_TRIAGE_COPY,
  ideaToTriage,
  reviewToTriage,
  type TriageReviewRow,
} from '@/features/agents/quick-answer/triage/triageAdapters';
import { closeDecisionDeck, openDecisionDeck, useDecisionDeckStore } from '@/features/decision-center/deck/deckStore';
import { DEFAULT_DECISION_COPY } from '@/features/decision-center/roster/decisionCopy';
import { incidentToDecision, reportToDecision } from '@/features/decision-center/roster/decisionAdapters';
import { incidentRow, reportRow } from '@/features/decision-center/__tests__/rosterFixtures';
import type { BacklogIdea } from '../../components/backlog/backlogModel';

import {
  ideaDecisionId,
  incidentDecisionId,
  openChipDeck,
  reportDecisionId,
  reviewDecisionId,
  useReloadOnDeckClose,
} from '../decisionDeckDoors';

const review: TriageReviewRow = {
  id: 'rev-9',
  persona_id: 'p1',
  execution_id: 'exec-1',
  review_type: '',
  content: 'x',
  severity: 'high',
  status: 'pending',
  reviewer_notes: null,
  context_data: null,
  suggested_actions: null,
  title: 'Approve it',
  created_at: '2026-02-01T00:00:00.000Z',
  resolved_at: null,
};

const idea: BacklogIdea = {
  id: 'idea-9',
  title: 'Cache it',
  description: 'd',
  reasoning: '',
  category: 'performance',
  origin: null,
  scanType: 'code',
  projectId: 'proj-1',
  projectName: 'Personas',
  effort: 3,
  impact: 8,
  risk: 2,
  priority: null,
  status: 'pending',
  evidence: null,
  verifyState: null,
  createdAt: '2026-02-01T00:00:00.000Z',
};

afterEach(() => {
  act(() => closeDecisionDeck());
  useDecisionDeckStore.setState({ closedReturnTo: null });
});

describe('focus ids match the roster adapters', () => {
  it('review, idea, incident and report rows map to the adapted item id', () => {
    expect(reviewDecisionId(review.id)).toBe(reviewToTriage(review, DEFAULT_TRIAGE_COPY).id);
    expect(ideaDecisionId(idea.id)).toBe(ideaToTriage(idea, DEFAULT_TRIAGE_COPY).id);
    const inc = incidentRow({ id: 'inc-9' });
    expect(incidentDecisionId(inc.id)).toBe(incidentToDecision(inc, DEFAULT_DECISION_COPY).id);
    const rep = reportRow({ id: 'rep-9' });
    expect(reportDecisionId(rep.id)).toBe(reportToDecision(rep, null, DEFAULT_DECISION_COPY).id);
  });
});

describe('openChipDeck', () => {
  it('opens the chip scope with the focus id and the element rect as origin', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ x: 4, y: 8, width: 100, height: 20 }) as DOMRect;
    openChipDeck('backlog', 'idea:idea-9', el);
    expect(useDecisionDeckStore.getState().request).toEqual({
      scope: { kind: 'chip', chip: 'backlog' },
      focusId: 'idea:idea-9',
      origin: { x: 4, y: 8, width: 100, height: 20 },
    });
  });

  it('opens without a focus or origin when none is given', () => {
    openChipDeck('gates');
    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope).toEqual({ kind: 'chip', chip: 'gates' });
    expect(req?.focusId).toBeUndefined();
    expect(req?.origin).toBeNull();
  });
});

describe('useReloadOnDeckClose', () => {
  it('re-reads once when the deck closes, never on open or on mount', () => {
    const reload = vi.fn();
    renderHook(() => useReloadOnDeckClose(reload));
    expect(reload).not.toHaveBeenCalled();
    act(() => openDecisionDeck({ scope: { kind: 'all' } }));
    expect(reload).not.toHaveBeenCalled();
    act(() => closeDecisionDeck());
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
