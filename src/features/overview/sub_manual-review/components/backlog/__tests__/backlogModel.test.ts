// @vitest-environment node
import { describe, it, expect } from 'vitest';

import type { DevIdea } from '@/lib/bindings/DevIdea';
import {
  backlogGroupPath,
  backlogHaystack,
  compareBacklog,
  isOriginSegment,
  nextQueueIndex,
  prettyEvidence,
  toBacklogIdea,
  triageValueScore,
  type BacklogIdea,
  selectionAfterSelectAll,
  applyBacklogSort,
  FULL_LEVEL_RANGE,
  hasLevelFilter,
  lensMvps,
  parseScoreParts,
  splitReserve,
  vetoOpen,
} from '../backlogModel';

function devIdea(over: Partial<DevIdea> = {}): DevIdea {
  return {
    id: 'i1',
    project_id: 'p1',
    context_id: null,
    scan_type: 'idea_scanner',
    category: 'technical',
    title: 'Cache the config read',
    description: null,
    reasoning: null,
    status: 'pending',
    effort: null,
    impact: null,
    risk: null,
    priority: null,
    provider: null,
    model: null,
    rejection_reason: null,
    origin: null,
    use_case_id: null,
    evidence: null,
    dedup_key: null,
    goal_id: null,
    verify_state: null,
    verify_checked_at: null,
    verify_evidence: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...over,
  };
}

const names = (id: string | null) => (id === 'p1' ? 'Personas' : '');

function view(over: Partial<BacklogIdea> = {}): BacklogIdea {
  return { ...toBacklogIdea(devIdea(), names), ...over };
}

describe('toBacklogIdea', () => {
  it('applies the midpoint (3 of the 1-5 scale, not the ceiling) to unset effort/impact/risk', () => {
    const v = toBacklogIdea(devIdea(), names);
    expect([v.effort, v.impact, v.risk]).toEqual([3, 3, 3]);
  });

  it('keeps real levels and nullable prose as empty strings', () => {
    const v = toBacklogIdea(
      devIdea({ effort: 2, impact: 9, risk: 1, description: 'why', reasoning: null }),
      names,
    );
    expect([v.effort, v.impact, v.risk]).toEqual([2, 9, 1]);
    expect(v.description).toBe('why');
    expect(v.reasoning).toBe('');
  });

  it('resolves the project name through the injected lookup', () => {
    expect(toBacklogIdea(devIdea(), names).projectName).toBe('Personas');
    expect(toBacklogIdea(devIdea({ project_id: null }), names).projectName).toBe('');
  });

  it('falls back to technical for a blank category', () => {
    expect(toBacklogIdea(devIdea({ category: '' }), names).category).toBe('technical');
  });
});

describe('triageValueScore', () => {
  it('rewards impact and charges for effort + risk', () => {
    expect(triageValueScore({ impact: 9, effort: 2, risk: 1 })).toBe(15);
    expect(triageValueScore({ impact: 1, effort: 9, risk: 9 })).toBe(-16);
  });
});

describe('backlogGroupPath', () => {
  it('nests a finding under its origin', () => {
    expect(backlogGroupPath(view({ category: 'technical', origin: 'sentry_spike' })))
      .toBe('technical/sentry_spike');
  });

  it('leaves a scanner idea on the category node', () => {
    expect(backlogGroupPath(view({ category: 'business', origin: null }))).toBe('business');
  });
});

describe('isOriginSegment', () => {
  it('distinguishes a depth-1 origin path from a category path', () => {
    expect(isOriginSegment('technical')).toBe(false);
    expect(isOriginSegment('technical/llm_cost')).toBe(true);
  });
});

describe('backlogHaystack', () => {
  it('searches title, description and reasoning', () => {
    expect(backlogHaystack(view({ title: 't', description: 'd', reasoning: 'r' })))
      .toEqual(['t', 'd', 'r']);
  });
});

describe('compareBacklog', () => {
  const low = view({ id: 'a', impact: 1, effort: 9, risk: 9, createdAt: '2026-01-01' });
  const high = view({ id: 'b', impact: 9, effort: 1, risk: 1, createdAt: '2026-06-01' });

  it('sorts by value score descending by default direction', () => {
    expect([low, high].sort((a, b) => compareBacklog(a, b, 'value', 'desc'))[0]!.id).toBe('b');
  });

  it('sorts by created date', () => {
    expect([low, high].sort((a, b) => compareBacklog(a, b, 'created', 'asc'))[0]!.id).toBe('a');
  });

  it('sorts titles alphabetically', () => {
    const x = view({ id: 'x', title: 'Zebra' });
    const y = view({ id: 'y', title: 'Alpha' });
    expect([x, y].sort((a, b) => compareBacklog(a, b, 'title', 'asc'))[0]!.id).toBe('y');
  });
});

describe('prettyEvidence', () => {
  it('formats valid JSON', () => {
    expect(prettyEvidence('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns null for absent or malformed evidence', () => {
    expect(prettyEvidence(null)).toBeNull();
    expect(prettyEvidence('   ')).toBeNull();
    expect(prettyEvidence('{not json')).toBeNull();
  });
});

describe('nextQueueIndex', () => {
  const all = () => true;

  it('steps forward and back', () => {
    expect(nextQueueIndex(['a', 'b', 'c'], 0, 1, all)).toBe(1);
    expect(nextQueueIndex(['a', 'b', 'c'], 2, -1, all)).toBe(1);
  });

  it('returns null past either end so the caller closes instead of clamping', () => {
    expect(nextQueueIndex(['a', 'b'], 1, 1, all)).toBeNull();
    expect(nextQueueIndex(['a', 'b'], 0, -1, all)).toBeNull();
  });

  it('skips ids whose row has disappeared', () => {
    const alive = (id: string) => id !== 'b' && id !== 'c';
    expect(nextQueueIndex(['a', 'b', 'c', 'd'], 0, 1, alive)).toBe(3);
  });

  it('returns null when every remaining id is gone', () => {
    expect(nextQueueIndex(['a', 'b', 'c'], 0, 1, (id) => id === 'a')).toBeNull();
  });

  it('handles a single-item queue', () => {
    expect(nextQueueIndex(['a'], 0, 1, all)).toBeNull();
    expect(nextQueueIndex(['a'], 0, -1, all)).toBeNull();
  });
});

describe('selectionAfterSelectAll', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  it('replaces the selection with exactly the rows the reviewer sees', () => {
    expect([...selectionAfterSelectAll(new Set(['x', 'y']), rows)].sort()).toEqual(['a', 'b']);
  });
  it('clears when every seen row was already selected', () => {
    expect(selectionAfterSelectAll(new Set(['a', 'b']), rows).size).toBe(0);
  });
  it('is a no-op on an empty narrowed set', () => {
    expect(selectionAfterSelectAll(new Set(['x']), []).size).toBe(1);
  });
});


describe('scan-finding/1 view fields', () => {
  it('maps absent contract fields to null, never 0', () => {
    const v = toBacklogIdea(devIdea(), names);
    expect(v.score).toBeNull();
    expect(v.band).toBe('ranked');
    expect(v.mvp).toBe(false);
  });

  it('parses the score breakdown and drops a malformed one', () => {
    expect(parseScoreParts('{"impact":8,"formula":"scan-score/1","nested":{}}')).toEqual({
      impact: 8,
      formula: 'scan-score/1',
    });
    expect(parseScoreParts('not json')).toBeNull();
    expect(parseScoreParts('[1,2]')).toBeNull();
    expect(parseScoreParts(null)).toBeNull();
  });

  it('default sort is the stored score, highest first, unscored after every scored row', () => {
    const rows = [
      view({ id: 'u', score: null }),
      view({ id: 'lo', score: 6.9 }),
      view({ id: 'hi', score: 95 }),
      view({ id: 'mid', score: 40.5 }),
    ];
    expect(applyBacklogSort(rows, 'default').map((r) => r.id)).toEqual(['hi', 'mid', 'lo', 'u']);
    // Ascending still keeps the unscored row last: unmeasured is not a low score.
    expect([...rows].sort((a, b) => compareBacklog(a, b, 'score', 'asc')).map((r) => r.id))
      .toEqual(['lo', 'mid', 'hi', 'u']);
  });

  it('keeps the old value sort selectable', () => {
    const rows = [view({ id: 'a', impact: 1, effort: 5, risk: 5 }), view({ id: 'b', impact: 5, effort: 1, risk: 1 })];
    expect(applyBacklogSort(rows, 'value').map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('splits reserve rows out of the ranked list, order preserved', () => {
    const { ranked, reserve } = splitReserve([
      view({ id: 'a' }),
      view({ id: 'r1', band: 'reserve' }),
      view({ id: 'b' }),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b']);
    expect(reserve.map((r) => r.id)).toEqual(['r1']);
  });

  it('picks one MVP per lens: the flagged row of the latest run, else the top score', () => {
    const rows = [
      view({ id: 'old-mvp', lens: 'perf', mvp: true, sweepRunId: 'run1', score: 90, createdAt: '2026-10-01' }),
      view({ id: 'new-mvp', lens: 'perf', mvp: true, sweepRunId: 'run2', score: 30, createdAt: '2026-10-02' }),
      view({ id: 'ux-top', lens: 'ux', score: 50, createdAt: '2026-10-01' }),
      view({ id: 'ux-low', lens: 'ux', score: 10, createdAt: '2026-10-03' }),
      view({ id: 'done', lens: 'docs', status: 'rejected', score: 99 }),
      view({ id: 'no-lens', score: 99 }),
    ];
    expect(lensMvps(rows).map((r) => r.id)).toEqual(['ux-top', 'new-mvp']);
  });

  it('the level filter spans the stored 1-5 scale', () => {
    expect(FULL_LEVEL_RANGE).toEqual([1, 5]);
    expect(hasLevelFilter(FULL_LEVEL_RANGE, FULL_LEVEL_RANGE)).toBe(false);
    expect(hasLevelFilter([1, 2], FULL_LEVEL_RANGE)).toBe(true);
  });

  it('a veto window is open only for a machine decision before its deadline', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(vetoOpen({ decidedBy: 'machine:scan-sweep', vetoUntil: '2026-10-31T12:00:00Z' }, now)).toBe(true);
    expect(vetoOpen({ decidedBy: 'machine:scan-sweep', vetoUntil: '2026-10-29T12:00:00Z' }, now)).toBe(false);
    expect(vetoOpen({ decidedBy: 'Human', vetoUntil: '2026-10-31T12:00:00Z' }, now)).toBe(false);
  });
});
