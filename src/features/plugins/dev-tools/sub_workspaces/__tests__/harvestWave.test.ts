import { describe, expect, it } from 'vitest';

import { coverageRatio, selectHarvestWave } from '../harvestWave';
import type { WorkspaceHarvestCoverage } from '@/lib/bindings/WorkspaceHarvestCoverage';

const scope = (
  scope_id: string,
  last_harvested_at: string | null = null,
): WorkspaceHarvestCoverage => ({
  project_id: 'p1',
  scope_id,
  scope_label: scope_id,
  kind: 'group',
  file_count: 100,
  last_harvested_at,
  last_run_dir: null,
  items_found: 0,
  run_count: last_harvested_at ? 1 : 0,
  updated_at: '2026-07-27T00:00:00Z',
});

const none = () => false;

describe('selectHarvestWave', () => {
  it('dispatches a bounded wave and reports what is left unread', () => {
    const coverage = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => scope(id));
    const { wave, remaining, running } = selectHarvestWave(coverage, none, 4);
    expect(wave.map((w) => w.scope_id)).toEqual(['a', 'b', 'c', 'd']);
    // The number that stops a partial pass reading as a complete one.
    expect(remaining).toBe(2);
    expect(running).toBe(0);
  });

  it('preserves the backend ordering instead of re-deriving staleness', () => {
    // Backend already sorts never-harvested first; two places computing
    // "stalest" independently is how they drift.
    const coverage = [scope('never'), scope('old', '2026-01-01T00:00:00Z')];
    expect(selectHarvestWave(coverage, none, 1).wave[0]!.scope_id).toBe('never');
  });

  it('skips territories already in flight rather than double-dispatching', () => {
    const coverage = ['a', 'b', 'c'].map((id) => scope(id));
    const { wave, running } = selectHarvestWave(coverage, (id) => id === 'a', 4);
    expect(wave.map((w) => w.scope_id)).toEqual(['b', 'c']);
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
    expect(coverageRatio(rows)).toEqual({ done: 1, total: 3 });
  });

  it('is null when there is nothing to report, so the UI can stay silent', () => {
    expect(coverageRatio([])).toBeNull();
    expect(coverageRatio(undefined)).toBeNull();
  });
});
