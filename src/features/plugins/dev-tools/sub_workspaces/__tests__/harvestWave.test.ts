import { describe, expect, it } from 'vitest';

import { coverageRatio, selectHarvestWave } from '../harvestWave';
import type { WorkspaceHarvestCoverage } from '@/lib/bindings/WorkspaceHarvestCoverage';

const scope = (
  scopeId: string,
  lastHarvestedAt: string | null = null,
  depth: { pct?: number | null; files?: number } = {},
): WorkspaceHarvestCoverage => ({
  projectId: 'p1',
  scopeId,
  scopeLabel: scopeId,
  kind: 'group',
  fileCount: BigInt(depth.files ?? 100) as unknown as number,
  lastHarvestedAt,
  lastRunDir: null,
  itemsFound: 0,
  runCount: lastHarvestedAt ? 1 : 0,
  filesRead: null,
  filesTotal: null,
  estimatedPct: (depth.pct ?? null) as unknown as number | null,
  unreadPockets: null,
  coverageNote: null,
  updatedAt: '2026-07-27T00:00:00Z',
});

const none = () => false;

describe('selectHarvestWave', () => {
  it('dispatches a bounded wave and reports what is left unread', () => {
    const coverage = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => scope(id));
    const { wave, remaining, running } = selectHarvestWave(coverage, none, 4);
    expect(wave.map((w) => w.scopeId)).toEqual(['a', 'b', 'c', 'd']);
    // The number that stops a partial pass reading as a complete one.
    expect(remaining).toBe(2);
    expect(running).toBe(0);
  });

  it('preserves the backend ordering instead of re-deriving staleness', () => {
    // Backend already sorts never-harvested first; two places computing
    // "stalest" independently is how they drift.
    const coverage = [scope('never'), scope('old', '2026-01-01T00:00:00Z')];
    expect(selectHarvestWave(coverage, none, 1).wave[0]!.scopeId).toBe('never');
  });

  it('skips territories already in flight rather than double-dispatching', () => {
    const coverage = ['a', 'b', 'c'].map((id) => scope(id));
    const { wave, running } = selectHarvestWave(coverage, (id) => id === 'a', 4);
    expect(wave.map((w) => w.scopeId)).toEqual(['b', 'c']);
    expect(running).toBe(1);
  });

  it('returns an empty wave when every scope is in flight', () => {
    const coverage = ['a', 'b'].map((id) => scope(id));
    const { wave, remaining } = selectHarvestWave(coverage, () => true, 4);
    expect(wave).toEqual([]);
    expect(remaining).toBe(0);
  });

  it('never returns a negative wave size', () => {
    expect(selectHarvestWave([scope('a')], none, -1).wave).toEqual([]);
  });
});

describe('coverageRatio', () => {
  it('counts a harvested scope by its timestamp, not by its yield', () => {
    // "Read and found nothing" is covered; only never-read is not.
    const rows = [scope('a', '2026-07-01T00:00:00Z'), scope('b'), scope('c')];
    expect(coverageRatio(rows)).toEqual({ done: 1, total: 3, pct: null });
  });

  it('weights read-depth by territory size, not by scope count', () => {
    // 100% of a small territory must not cancel out 10% of a large one —
    // that averaging is how "visited everywhere, read nowhere" looks finished.
    const rows = [
      scope('big', '2026-07-01T00:00:00Z', { pct: 10, files: 900 }),
      scope('small', '2026-07-01T00:00:00Z', { pct: 100, files: 100 }),
    ];
    expect(coverageRatio(rows)!.pct).toBe(19);
  });

  it('reports null depth rather than assuming scopes that never estimated', () => {
    const rows = [
      scope('measured', '2026-07-01T00:00:00Z', { pct: 40, files: 100 }),
      scope('silent', '2026-07-01T00:00:00Z', { pct: null, files: 900 }),
    ];
    // The silent scope is excluded from the mean, not counted as 0 or 100.
    expect(coverageRatio(rows)!.pct).toBe(40);
    expect(coverageRatio([scope('silent', '2026-07-01T00:00:00Z')])!.pct).toBeNull();
  });

  it('is null when there is nothing to report, so the UI can stay silent', () => {
    expect(coverageRatio([])).toBeNull();
    expect(coverageRatio(undefined)).toBeNull();
  });
});
