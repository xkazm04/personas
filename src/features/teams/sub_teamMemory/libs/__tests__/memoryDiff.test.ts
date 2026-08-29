import { describe, it, expect } from 'vitest';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { computeMemoryDiff } from '../memoryDiff';
import {
  IMPORTANCE_MIN,
  IMPORTANCE_MAX,
  IMPORTANCE_DOTS,
  importanceToDots,
  dotsToImportance,
} from '../memoryConstants';

function mem(id: string, category: string, importance: number): TeamMemory {
  return {
    id,
    team_id: 'team-1',
    run_id: 'run-1',
    member_id: null,
    persona_id: null,
    title: `title ${id}`,
    content: `content ${id}`,
    category,
    importance,
    tags: 'auto',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('computeMemoryDiff', () => {
  it('aligns on content: what only B has is added, what only A has is removed', () => {
    const a = [mem('1', 'decision', 5), mem('2', 'context', 5)];
    const b = [mem('2', 'context', 5), mem('3', 'learning', 5)];

    const diff = computeMemoryDiff(a, b);

    expect(diff.added.map((m) => m.id)).toEqual(['3']);
    expect(diff.removed.map((m) => m.id)).toEqual(['1']);
    expect(diff.totalA).toBe(2);
    expect(diff.totalB).toBe(2);
  });

  it('reports no change for two runs holding the same learnings under fresh ids', () => {
    // Every memory row carries exactly one `run_id` and a freshly minted uuid,
    // so run A's id set and run B's id set are disjoint BY CONSTRUCTION. Under
    // id alignment this pair rendered as 2 new learnings plus 2 lost ones —
    // knowledge creation and loss that never happened.
    const a = [mem('a1', 'decision', 5), mem('a2', 'context', 7)];
    const b = [
      { ...mem('b1', 'decision', 5), title: 'title a1', content: 'content a1' },
      { ...mem('b2', 'context', 7), title: 'title a2', content: 'content a2' },
    ];

    const diff = computeMemoryDiff(a, b);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('reports a category present on one side only as a COUNT change', () => {
    const diff = computeMemoryDiff([], [mem('1', 'learning', 8)]);

    const learning = diff.categoryDiffs.find((c) => c.category === 'learning');
    expect(learning).toEqual({ category: 'learning', countA: 0, countB: 1, delta: 1 });
  });

  it('never claims an importance shift for a category that exists on one side only', () => {
    // The regression this pins: `avgImportance([])` returns 0, so a category
    // that first appeared in run B used to render as "0.0 -> 8.0, rising" —
    // an averaged claim about a set that was never compared.
    const appeared = computeMemoryDiff([], [mem('1', 'learning', 8)]);
    expect(appeared.importanceShifts).toEqual([]);

    const disappeared = computeMemoryDiff([mem('1', 'learning', 8)], []);
    expect(disappeared.importanceShifts).toEqual([]);
  });

  it('reports an importance shift only where both sides have members', () => {
    const a = [mem('1', 'decision', 2), mem('2', 'decision', 4)];
    const b = [mem('3', 'decision', 8), mem('4', 'decision', 10)];

    const diff = computeMemoryDiff(a, b);

    expect(diff.importanceShifts).toHaveLength(1);
    expect(diff.importanceShifts[0]).toMatchObject({ category: 'decision', avgA: 3, avgB: 9, delta: 6 });
  });

  it('orders both change lists by magnitude, largest first', () => {
    const a = [mem('1', 'small', 5), mem('2', 'big', 5), mem('3', 'big', 5), mem('4', 'big', 5)];
    const b = [mem('5', 'small', 5), mem('6', 'small', 5)];

    const diff = computeMemoryDiff(a, b);

    expect(diff.categoryDiffs.map((c) => c.category)).toEqual(['big', 'small']);
  });

  it('an empty pair is an empty diff, not a crash', () => {
    const diff = computeMemoryDiff([], []);
    expect(diff).toEqual({
      added: [],
      removed: [],
      categoryDiffs: [],
      importanceShifts: [],
      totalA: 0,
      totalB: 0,
    });
  });
});

describe('importance dot mapping', () => {
  it('maps the whole 1-10 importance range into 1-5 dots', () => {
    for (let i = IMPORTANCE_MIN; i <= IMPORTANCE_MAX; i++) {
      const dots = importanceToDots(i);
      expect(dots).toBeGreaterThanOrEqual(1);
      expect(dots).toBeLessThanOrEqual(IMPORTANCE_DOTS);
    }
    expect(importanceToDots(IMPORTANCE_MAX)).toBe(IMPORTANCE_DOTS);
  });

  it('clamps out-of-range importance rather than producing a dot count nothing renders', () => {
    expect(importanceToDots(0)).toBe(1);
    expect(importanceToDots(999)).toBe(IMPORTANCE_DOTS);
  });

  it('round-trips a dot click back to a value that lands on the same dot', () => {
    for (let dotIndex = 0; dotIndex < IMPORTANCE_DOTS; dotIndex++) {
      const importance = dotsToImportance(dotIndex);
      expect(importance).toBeGreaterThanOrEqual(IMPORTANCE_MIN);
      expect(importance).toBeLessThanOrEqual(IMPORTANCE_MAX);
      expect(importanceToDots(importance)).toBe(dotIndex + 1);
    }
  });
});
