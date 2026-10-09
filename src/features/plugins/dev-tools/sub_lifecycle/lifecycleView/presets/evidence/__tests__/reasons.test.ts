import { describe, expect, it } from 'vitest';

import { LAND_NOTES, landHistory } from '../../../../journey/__tests__/evidenceFixtures';
import { commonSkipReason } from '../../../layer2/next/nextEvidence';
import { clusterReasons, maskIdentifiers, normaliseReason } from '../reasons';

describe('normaliseReason', () => {
  it('drops case, shas, ids, paths, file names, numbers and punctuation, and a plural s', () => {
    expect(normaliseReason('Pushed 3 commits straight to main at 9f8e7d6')).toBe('pushed commit straight to main at');
    expect(normaliseReason('pushed 1 commit straight to MAIN')).toBe('pushed commit straight to main');
    expect(normaliseReason('task-42 skipped: see src/features/vault/VaultPage.tsx')).toBe('skipped see');
    expect(normaliseReason('PR #118 was reverted (merge 0a1b2c3d4e)')).toBe('pr was reverted merge');
    expect(normaliseReason('Docs in README.md are stale')).toBe('doc in are stale');
    expect(normaliseReason('id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed')).toBe('id failed');
  });

  it('keeps a word that only looks like hex', () => {
    expect(normaliseReason('deadbeef added')).toBe('deadbeef added');
  });
});

describe('clusterReasons', () => {
  it('groups identical and near-identical notes, biggest first, with the note as written most', () => {
    const s = clusterReasons([
      { outcome: 'skipped', detail: 'Pushed straight to main at abc1234' },
      { outcome: 'skipped', detail: 'No PR' },
      { outcome: 'failed', detail: 'pushed straight to main at 9f8e7d6' },
      { outcome: 'skipped', detail: 'Pushed straight to main at abc1234' },
      { outcome: 'skipped', detail: 'Pushed 2 commits straight to main' },
      { outcome: 'done', detail: 'Pushed straight to main' },
      { outcome: 'skipped', detail: null },
    ]);
    expect(s.missed).toBe(6);
    expect(s.unexplained).toBe(1);
    expect(s.clusters.map((c) => [c.label, c.count])).toEqual([
      ['Pushed straight to main at abc1234', 4],
      ['No PR', 1],
    ]);
    expect(s.clusters[0]).toMatchObject({ skipped: 3, failed: 1, newest: 0 });
    expect(s.clusters[0]!.examples).toEqual([
      'Pushed straight to main at abc1234', 'pushed straight to main at 9f8e7d6', 'Pushed 2 commits straight to main',
    ]);
  });

  it('a reason every change wrote with its own sha reads with the sha masked; its examples keep theirs', () => {
    const s = clusterReasons(['abc1234', '9f8e7d6', '0a1b2c3'].map((sha) => ({ outcome: 'skipped' as const, detail: `Pushed straight to main at ${sha}` })));
    expect(s.clusters).toHaveLength(1);
    expect(s.clusters[0]!.label).toBe('Pushed straight to main at …');
    expect(s.clusters[0]!.examples[0]).toBe('Pushed straight to main at abc1234');
    expect(maskIdentifiers('task-42 and PR #118 reverted 3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('… and PR … reverted …');
  });

  it('never merges short notes on overlap alone', () => {
    const s = clusterReasons([{ outcome: 'skipped', detail: 'No PR' }, { outcome: 'skipped', detail: 'No PR opened' }]);
    expect(s.clusters).toHaveLength(2);
  });

  it('a tie goes to the reason with the newer change', () => {
    const s = clusterReasons([
      { outcome: 'skipped', detail: 'B' }, { outcome: 'skipped', detail: 'A' }, { outcome: 'skipped', detail: 'A' }, { outcome: 'skipped', detail: 'B' },
    ]);
    expect(s.clusters.map((c) => c.label)).toEqual(['B', 'A']);
  });

  it('the Land fixture: pushed straight to main leads, merged locally next, reviewer last', () => {
    const rows = landHistory().map((e) => e.outcomes[0]!);
    const s = clusterReasons(rows);
    expect(s.clusters[0]!.label.startsWith('Pushed straight to main at')).toBe(true);
    expect(s.clusters.map((c) => c.key)).toHaveLength(3);
    expect(s.clusters[1]!.label).toBe(LAND_NOTES.local);
    expect(s.clusters[2]!.label).toBe(LAND_NOTES.reviewer);
    expect(s.unexplained).toBeGreaterThan(0);
  });
});

describe('the Next panel reads the same clustering', () => {
  it('commonSkipReason is the top cluster: its note as written and its count', () => {
    const top = clusterReasons(landHistory().map((e) => e.outcomes[0]!)).clusters[0]!;
    expect(commonSkipReason(landHistory(), 'land')).toEqual({ reason: top.label, count: top.count });
  });
});
