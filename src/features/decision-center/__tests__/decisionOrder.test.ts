import { describe, expect, it } from 'vitest';

import { compareDecision, decisionTier } from '../model/decisionOrder';
import { item } from './rosterFixtures';

describe('decisionTier — the tier law', () => {
  it('puts approvals, critical/high incidents and held team steps in tier 1', () => {
    expect(decisionTier(item({ id: 'approval:a', kind: 'approval' }))).toBe(1);
    expect(decisionTier(item({ id: 'incident:c', kind: 'incident', severity: 'critical' }))).toBe(1);
    expect(decisionTier(item({ id: 'incident:h', kind: 'incident', severity: 'HIGH' }))).toBe(1);
    expect(
      decisionTier(item({ id: 'review:held', kind: 'review', payload: { assignmentId: 'as-1' } })),
    ).toBe(1);
    expect(
      decisionTier(item({ id: 'review:step', kind: 'review', payload: { stepId: 'st-1' } })),
    ).toBe(1);
  });

  it('puts messages and reports in tier 3', () => {
    expect(decisionTier(item({ id: 'message:t', kind: 'message' }))).toBe(3);
    expect(decisionTier(item({ id: 'report:r', kind: 'report' }))).toBe(3);
  });

  it('puts everything else in tier 2', () => {
    expect(decisionTier(item({ id: 'incident:m', kind: 'incident', severity: 'medium' }))).toBe(2);
    expect(decisionTier(item({ id: 'incident:n', kind: 'incident' }))).toBe(2);
    expect(decisionTier(item({ id: 'review:advisory', kind: 'review', payload: {} }))).toBe(2);
    for (const kind of ['idea', 'question', 'policy', 'evolution', 'goal', 'council'] as const) {
      expect(decisionTier(item({ id: `${kind}:x`, kind }))).toBe(2);
    }
  });
});

describe('compareDecision — tier first, then the deck law', () => {
  it('orders by tier before weight', () => {
    const heavyReport = item({ id: 'report:r', kind: 'report', weight: 999 });
    const lightApproval = item({ id: 'approval:a', kind: 'approval', weight: 1 });
    const council = item({ id: 'council:c', kind: 'council', weight: 70 });
    const sorted = [heavyReport, council, lightApproval].sort(compareDecision);
    expect(sorted.map((i) => i.id)).toEqual(['approval:a', 'council:c', 'report:r']);
  });

  it('inside a tier: weight desc, then oldest first, then id', () => {
    const a = item({ id: 'idea:b', kind: 'idea', weight: 40, createdAt: '2026-10-01T10:00:00Z' });
    const b = item({ id: 'idea:a', kind: 'idea', weight: 40, createdAt: '2026-10-01T10:00:00Z' });
    const c = item({ id: 'idea:c', kind: 'idea', weight: 40, createdAt: '2026-09-30T10:00:00Z' });
    const d = item({ id: 'idea:d', kind: 'idea', weight: 60, createdAt: '2026-10-05T10:00:00Z' });
    expect([a, b, c, d].sort(compareDecision).map((i) => i.id)).toEqual([
      'idea:d',
      'idea:c',
      'idea:a',
      'idea:b',
    ]);
  });

  it('is a total order: stable under insertion and input permutation', () => {
    const base = [
      item({ id: 'goal:1', kind: 'goal', weight: 45 }),
      item({ id: 'goal:2', kind: 'goal', weight: 45 }),
      item({ id: 'message:x', kind: 'message', weight: 50 }),
      item({ id: 'incident:1', kind: 'incident', severity: 'critical', weight: 120 }),
    ];
    const once = [...base].sort(compareDecision).map((i) => i.id);
    const reversed = [...base].reverse().sort(compareDecision).map((i) => i.id);
    expect(reversed).toEqual(once);

    // A refresh that adds a row must not reorder the rows already there.
    const inserted = item({ id: 'goal:15', kind: 'goal', weight: 45 });
    const after = [inserted, ...base].sort(compareDecision).map((i) => i.id);
    expect(after.filter((id) => id !== 'goal:15')).toEqual(once);
    expect(compareDecision(base[0]!, base[0]!)).toBe(0);
  });
});
