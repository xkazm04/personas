import { describe, expect, it } from 'vitest';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { QuestionGroup } from '@/features/agents/quick-answer/usePendingInteractions';
import { buildAsks, scopeAsks } from '../needsYouModel';

/* Reviews and held questions are ONE queue now (WP12): tier first, then the longest wait. */

const review = (id: string, persona: string, at: string, over: Partial<PersonaManualReview> = {}): PersonaManualReview =>
  // The binding carries more columns than the queue reads; the ones it reads are set here.
  ({
    id, persona_id: persona, execution_id: null, title: id, description: null, severity: 'medium', context_data: null,
    suggested_actions: null, status: 'pending', reviewer_notes: null, resolved_at: null, created_at: at, updated_at: at,
    use_case_id: null, assignment_id: null, step_id: null, ...over,
  }) as unknown as PersonaManualReview;

const group: QuestionGroup = {
  sessionId: 's1', personaId: 'p3', personaName: 'Blog Drafter', personaIcon: null, personaColor: null,
  questions: [
    { cellKey: 'c1', question: 'Which readers?', options: ['Operators', 'Developers'] },
    { cellKey: 'c2', question: 'Which connector?', options: null, connectorCategory: 'crm' },
  ],
};

describe('buildAsks', () => {
  it('merges reviews and questions into one queue: a held team step first, then the longest wait', () => {
    const asks = buildAsks(
      [
        review('merge', 'p2', '2026-10-16T09:59:00Z'),
        review('publish', 'p1', '2026-10-16T09:55:00Z', { assignment_id: 'asg', step_id: 'st' }),
        review('close', 'p4', '2026-10-16T07:50:00Z'),
      ],
      [group],
    );
    expect(asks.map((a) => a.id)).toEqual(['publish', 'close', 'merge', 's1:c1', 's1:c2']);
    expect(asks.map((a) => a.kind)).toEqual(['review', 'review', 'review', 'question', 'question']);
    expect(asks[0]).toMatchObject({ tier: 1 });
    expect(asks[3]).toMatchObject({ options: ['Operators', 'Developers'], complex: false });
    expect(asks[4]).toMatchObject({ complex: true });
  });

  it('reads a review suggested actions as its branches', () => {
    const [ask] = buildAsks([review('m', 'p2', '2026-10-16T09:59:00Z', { suggested_actions: '["Merge after one more CI run"]' })], []);
    expect(ask).toMatchObject({ kind: 'review', actions: ['Merge after one more CI run'] });
  });

  it('scopes the queue to a team members or one persona; null is the fleet', () => {
    const asks = buildAsks([review('a', 'p1', '2026-10-16T09:00:00Z'), review('b', 'p2', '2026-10-16T09:01:00Z')], [group]);
    expect(scopeAsks(asks, new Set(['p1', 'p3'])).map((a) => a.id)).toEqual(['a', 's1:c1', 's1:c2']);
    expect(scopeAsks(asks, null)).toHaveLength(4);
  });
});
