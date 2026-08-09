import { describe, expect, it } from 'vitest';

import type { SkillLessonRow, SkillRevisionRow } from '@/api/devTools/devTools';

import {
  buildSkillTree, buildTraceMatrix, driftOf, HEAT_HALF_LIFE_DAYS, heatTier, mergeFleetRuns, parseVersion, rawHeat, traceKey,
} from '../traceModel';
import type { TraceProject } from '../traceTypes';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

describe('rawHeat', () => {
  it('is zero without invokes or timestamp', () => {
    expect(rawHeat(0, NOW, NOW)).toBe(0);
    expect(rawHeat(5, null, NOW)).toBe(0);
  });

  it('halves exactly at the half-life', () => {
    const fresh = rawHeat(9, NOW, NOW);
    const aged = rawHeat(9, NOW - HEAT_HALF_LIFE_DAYS * DAY, NOW);
    expect(fresh).toBeCloseTo(3, 10); // sqrt dampening: sqrt(9) = 3
    expect(aged).toBeCloseTo(fresh / 2, 10);
  });

  it('dampens volume by sqrt — 100 invokes is 10x, not 100x', () => {
    expect(rawHeat(100, NOW, NOW)).toBeCloseTo(10 * rawHeat(1, NOW, NOW), 10);
  });

  it('clamps future timestamps to zero age instead of amplifying', () => {
    expect(rawHeat(4, NOW + DAY, NOW)).toBeCloseTo(2, 10);
  });
});

describe('heatTier', () => {
  it('distinguishes adopted-cold from absent at zero heat', () => {
    expect(heatTier(0, true)).toBe('cold');
    expect(heatTier(0, false)).toBe('absent');
  });

  it('applies the tier boundaries', () => {
    expect(heatTier(0.1, true)).toBe('cool');
    expect(heatTier(0.2, true)).toBe('warm');
    expect(heatTier(0.55, true)).toBe('hot');
    expect(heatTier(1, false)).toBe('hot');
  });
});

describe('parseVersion / driftOf', () => {
  it('treats null and malformed as implicit 1.0', () => {
    expect(parseVersion(null)).toEqual([1, 0]);
    expect(parseVersion('garbage')).toEqual([1, 0]);
    expect(parseVersion('2.3')).toEqual([2, 3]);
  });

  it('computes drift verdicts by version, tie-broken by syncState', () => {
    expect(driftOf('1.0', '1.1', 'in_sync')).toBe('behind');
    expect(driftOf('2.0', '1.9', 'in_sync')).toBe('ahead');
    expect(driftOf('1.10', '1.9', 'in_sync')).toBe('ahead'); // numeric, not lexical
    expect(driftOf('1.2', '1.2', 'diverged')).toBe('customized');
    expect(driftOf('1.2', '1.2', 'in_sync')).toBe('in_sync');
    expect(driftOf(null, null, 'local_only')).toBe('unversioned');
    // null = implicit 1.0, so a 1.1 library reads as ahead of an unversioned copy.
    expect(driftOf(null, '1.1', 'in_sync')).toBe('behind');
  });
});

const projects: TraceProject[] = [
  { id: 'p1', name: 'alpha', rootPath: '/a' },
  { id: 'p2', name: 'beta', rootPath: '/b' },
];

function inputs(overrides?: Partial<Parameters<typeof buildTraceMatrix>[1]>) {
  return {
    projects,
    installedByProject: new Map([
      ['p1', new Map([['scan', { version: '1.1' as string | null, syncState: 'in_sync' }]])],
      ['p2', new Map()],
    ]),
    usageByKey: new Map([
      [traceKey('p1', 'scan'), { invokes30d: 16, lastInvokedAt: NOW }],
    ]),
    now: NOW,
    ...overrides,
  };
}

describe('buildTraceMatrix', () => {
  it('normalizes against the matrix max and rolls up per skill', () => {
    const m = buildTraceMatrix(['scan'], inputs());
    const cells = m.cells.get('scan')!;
    expect(cells[0].heat).toBe(1);
    expect(cells[0].tier).toBe('hot');
    expect(cells[0].installedVersion).toBe('1.1');
    expect(cells[1].tier).toBe('absent');
    expect(m.rollup.get('scan')).toEqual({ totalHeat: 1, adoptedCount: 1, totalInvokes: 16 });
  });

  it('handles the all-zero matrix without dividing by zero', () => {
    const m = buildTraceMatrix(['scan'], inputs({ usageByKey: new Map() }));
    const cells = m.cells.get('scan')!;
    expect(cells[0].heat).toBe(0);
    expect(cells[0].tier).toBe('cold'); // adopted but unused
    expect(cells[1].tier).toBe('absent');
  });
});

describe('mergeFleetRuns', () => {
  const run = (skill: string, projectId: string, startedAt: number) => ({
    skill, projectId, startedAt, lastActivityAt: startedAt + 60_000,
  });

  it('takes max per key instead of summing (transcript miner counts the same runs)', () => {
    const db = new Map([[traceKey('p1', 'scan'), { invokes30d: 5, lastInvokedAt: NOW - DAY }]]);
    const { merged, usedNames } = mergeFleetRuns(db, [
      run('scan', 'p1', NOW - 2 * DAY),
      run('scan', 'p1', NOW - 3 * DAY),
    ], NOW);
    // DB already counted 5 ≥ 2 fleet runs → keep 5; timestamp takes the max.
    expect(merged.get(traceKey('p1', 'scan'))).toEqual({ invokes30d: 5, lastInvokedAt: NOW - DAY });
    expect(usedNames.has('scan')).toBe(true);
  });

  it('fills keys the DB has never seen and drops runs outside 30 days', () => {
    const { merged } = mergeFleetRuns(new Map(), [
      run('sweep', 'p2', NOW - DAY),
      run('sweep', 'p2', NOW - 2 * DAY),
      run('sweep', 'p2', NOW - 40 * DAY), // outside the window
    ], NOW);
    const cell = merged.get(traceKey('p2', 'sweep'))!;
    expect(cell.invokes30d).toBe(2);
    expect(cell.lastInvokedAt).toBe(NOW - DAY + 60_000);
  });

  it('leaves untouched DB keys intact', () => {
    const db = new Map([[traceKey('p1', 'other'), { invokes30d: 1, lastInvokedAt: NOW }]]);
    const { merged } = mergeFleetRuns(db, [], NOW);
    expect(merged.get(traceKey('p1', 'other'))).toEqual({ invokes30d: 1, lastInvokedAt: NOW });
  });
});

describe('buildSkillTree', () => {
  const lesson = (over: Partial<SkillLessonRow>): SkillLessonRow => ({
    skill: 'scan', scope: 'project', project_id: 'p1', project_name: 'alpha',
    version: '1.1', date: '2026-08-07', lesson: 'anchor on exports', is_redesign: false,
    ...over,
  });

  it('builds weight-sorted branches with drift and per-project lessons', () => {
    const installed = new Map([
      ['p1', new Map([['scan', { version: '1.0' as string | null, syncState: 'in_sync' }]])],
      ['p2', new Map([['scan', { version: '1.1' as string | null, syncState: 'diverged' }]])],
    ]);
    const usage = new Map([
      [traceKey('p1', 'scan'), { invokes30d: 4, lastInvokedAt: NOW }],
      [traceKey('p2', 'scan'), { invokes30d: 16, lastInvokedAt: NOW }],
    ]);
    const m = buildTraceMatrix(['scan'], inputs({ installedByProject: installed, usageByKey: usage }));
    const timeline: SkillRevisionRow[] = [
      { rev: 1, content_hash: 'a', changed_at: '2026-07-01', version: null },
      { rev: 2, content_hash: 'b', changed_at: '2026-08-01', version: '1.1' },
    ];
    const tree = buildSkillTree('scan', projects, m.cells.get('scan')!, '1.1', timeline, [
      lesson({}),
      lesson({ scope: 'global', project_id: null, project_name: null }),
    ]);

    expect(tree.branches.map((b) => b.project.id)).toEqual(['p2', 'p1']); // weight desc
    expect(tree.branches[0].weight).toBe(1);
    expect(tree.branches[0].drift).toBe('customized'); // 1.1 vs 1.1, hash diverged
    expect(tree.branches[1].drift).toBe('behind'); // 1.0 vs 1.1
    expect(tree.branches[1].lessons).toHaveLength(1);
    expect(tree.workspaceLessons).toHaveLength(1);
    expect(tree.timeline.map((r) => r.rev)).toEqual([2, 1]); // newest first
    expect(tree.totalInvokes).toBe(20);
  });
});
