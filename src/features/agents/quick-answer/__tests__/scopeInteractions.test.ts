/**
 * The Quick Answer deck is fleet-wide by design — the titlebar popover IS the
 * global inbox. The Conversations rail is not: the Reviews tab beside it has
 * always scoped itself to the open team's members, so a Quick tab listing
 * another team's held question was a global inbox wearing a team's label.
 *
 * `scopeInteractions` is that predicate. The counts are checked with it,
 * because a narrowed list under an unnarrowed total is the same lie in a
 * smaller font.
 */
import { describe, it, expect } from 'vitest';
import type { QuestionGroup } from '../usePendingInteractions';
import type { MonitorReviewItem } from '@/features/fleet/monitor/useMonitorData';
import { scopeInteractions } from '../QuickAnswerBody';

const group = (personaId: string, n: number): QuestionGroup => ({
  sessionId: `s-${personaId}`,
  personaId,
  personaName: personaId,
  personaIcon: null,
  personaColor: null,
  questions: Array.from({ length: n }, (_, i) => ({ id: `${personaId}-q${i}` })),
} as unknown as QuestionGroup);

const review = (personaId: string, id: string): MonitorReviewItem =>
  ({ id, persona_id: personaId } as unknown as MonitorReviewItem);

type Deck = Parameters<typeof scopeInteractions>[0];

function deck(): Deck {
  return {
    questionGroups: [group('alpha1', 2), group('beta1', 3)],
    reviews: [review('alpha1', 'r1'), review('beta1', 'r2'), review('beta2', 'r3')],
    reviewsError: null,
    reviewsHasMore: false,
    questionCount: 5,
    reviewCount: 3,
    total: 8,
    loading: false,
    isProcessing: false,
    submitQuestionAnswers: async () => {},
    handleReviewAction: async () => {},
    handleDispatchAction: async () => {},
  } as unknown as Deck;
}

describe('scopeInteractions', () => {
  it('returns the fleet-wide deck untouched when no scope is given', () => {
    const d = deck();
    expect(scopeInteractions(d, null)).toBe(d);
  });

  it('keeps only the scoped personas rows', () => {
    const out = scopeInteractions(deck(), new Set(['alpha1']));
    expect(out.questionGroups.map((g) => g.personaId)).toEqual(['alpha1']);
    expect(out.reviews.map((r) => r.id)).toEqual(['r1']);
  });

  it('recounts every total from the rows it kept', () => {
    const out = scopeInteractions(deck(), new Set(['beta1', 'beta2']));
    // 3 questions on beta1, plus reviews r2 and r3.
    expect(out.questionCount).toBe(3);
    expect(out.reviewCount).toBe(2);
    expect(out.total).toBe(5);
  });

  it('reports a clear team as empty rather than falling back to the fleet', () => {
    const out = scopeInteractions(deck(), new Set(['nobody']));
    expect(out.total).toBe(0);
    expect(out.questionGroups).toHaveLength(0);
    expect(out.reviews).toHaveLength(0);
  });

  it('carries the read-failure signal through, so a scope cannot hide an error', () => {
    const d = { ...deck(), reviewsError: 'boom', reviewsHasMore: true } as Deck;
    const out = scopeInteractions(d, new Set(['alpha1']));
    expect(out.reviewsError).toBe('boom');
    expect(out.reviewsHasMore).toBe(true);
  });
});
