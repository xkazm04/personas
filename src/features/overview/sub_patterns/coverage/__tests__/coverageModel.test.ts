// coverageModel — the join/merge doctrine under test: absence is not signal,
// "in sync" is earned, and the merged staleness clock is null-safe.
import { describe, expect, it } from 'vitest';

import type { CoverageTile } from '@/lib/bindings/CoverageTile';
import type { RegistryMapState } from '@/lib/bindings/RegistryMapState';
import type { WorkspaceHarvestCoverage } from '@/lib/bindings/WorkspaceHarvestCoverage';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';

import {
  buildTileView,
  maxIso,
  rollupHarvest,
  rollupPractices,
  type HarvestRollup,
  type PracticeRollup,
} from '../coverageModel';

function makeTile(overrides: Partial<CoverageTile> = {}): CoverageTile {
  return {
    projectId: 'p1',
    projectName: 'personas',
    slug: 'personas',
    presence: { inRegistry: true, domains: ['forge'], forgedFrom: true },
    extraction: null,
    applied: {
      skillsAdopted: 2,
      skillsBehind: 0,
      skillsDetail: [],
      registryMap: makeMap(),
    },
    staleness: {
      projectLastAction: '2026-08-20T10:00:00Z',
      registryLastMove: '2026-08-19T10:00:00Z',
    },
    debts: [],
    ...overrides,
  };
}

function makeMap(overrides: Partial<RegistryMapState> = {}): RegistryMapState {
  return {
    exists: true,
    mtime: '2026-08-20T10:00:00Z',
    conformant: 3,
    deviation: 1,
    notApplicable: 0,
    unknown: 0,
    digestStale: false,
    ...overrides,
  };
}

function harvestRow(overrides: Partial<WorkspaceHarvestCoverage> = {}): WorkspaceHarvestCoverage {
  return {
    projectId: 'p1',
    scopeId: 'repo-global',
    scopeLabel: 'Repo global',
    kind: 'global',
    fileCount: 10n,
    lastHarvestedAt: null,
    lastRunDir: null,
    itemsFound: 0n,
    runCount: 0n,
    filesRead: null,
    filesTotal: null,
    estimatedPct: null,
    unreadPockets: null,
    coverageNote: null,
    updatedAt: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

function adoptionRow(
  overrides: Partial<WorkspacePracticeAdoption> = {},
): WorkspacePracticeAdoption {
  return {
    practice_id: 'k1',
    project_id: 'p1',
    state: 'adopted',
    fleet_key: null,
    note: null,
    last_verified_at: null,
    updated_at: '2026-08-20T10:00:00Z',
    ...overrides,
  };
}

const FULL_HARVEST: HarvestRollup = {
  lastHarvestedAt: '2026-08-18T00:00:00Z',
  itemsFound: 12,
  runCount: 3,
  scopesHarvested: 2,
  scopesTotal: 4,
};

const FULL_PRACTICES: PracticeRollup = {
  adopted: 2,
  diverged: 0,
  dispatched: 0,
  total: 2,
  lastVerifiedAt: '2026-08-17T00:00:00Z',
};

describe('maxIso', () => {
  it('is null-safe and ignores unparseable values', () => {
    expect(maxIso(null, undefined)).toBeNull();
    expect(maxIso('not-a-date', null)).toBeNull();
    expect(maxIso(null, '2026-01-01T00:00:00Z', 'garbage')).toBe('2026-01-01T00:00:00Z');
  });

  it('compares as instants across offsets, not lexically', () => {
    // +02:00 noon is 10:00Z — lexically "12:00" sorts after "11:00Z" but is
    // the earlier instant.
    expect(maxIso('2026-01-01T12:00:00+02:00', '2026-01-01T11:00:00Z')).toBe(
      '2026-01-01T11:00:00Z',
    );
  });
});

describe('rollupHarvest', () => {
  it('returns null for no rows — no ledger is no signal, not zero', () => {
    expect(rollupHarvest([])).toBeNull();
  });

  it('distinguishes "scoped but never harvested" from signal', () => {
    const r = rollupHarvest([harvestRow(), harvestRow({ scopeId: 's2' })]);
    expect(r).not.toBeNull();
    expect(r?.scopesHarvested).toBe(0);
    expect(r?.lastHarvestedAt).toBeNull();
  });

  it('rolls up max date + summed items across harvested scopes', () => {
    const r = rollupHarvest([
      harvestRow({ lastHarvestedAt: '2026-08-01T00:00:00Z', itemsFound: 5n, runCount: 1n }),
      harvestRow({
        scopeId: 's2',
        lastHarvestedAt: '2026-08-10T00:00:00Z',
        itemsFound: 7n,
        runCount: 2n,
      }),
      harvestRow({ scopeId: 's3' }),
    ]);
    expect(r).toEqual({
      lastHarvestedAt: '2026-08-10T00:00:00Z',
      itemsFound: 12,
      runCount: 3,
      scopesHarvested: 2,
      scopesTotal: 3,
    });
  });
});

describe('rollupPractices', () => {
  it('returns null when the project has no rows', () => {
    expect(rollupPractices([adoptionRow({ project_id: 'other' })], 'p1')).toBeNull();
  });

  it('counts states and takes the max verification clock', () => {
    const r = rollupPractices(
      [
        adoptionRow({ state: 'adopted', last_verified_at: '2026-08-01T00:00:00Z' }),
        adoptionRow({ practice_id: 'k2', state: 'diverged', last_verified_at: '2026-08-05T00:00:00Z' }),
        adoptionRow({ practice_id: 'k3', state: 'dispatched' }),
        adoptionRow({ practice_id: 'k4', state: 'proposed' }),
      ],
      'p1',
    );
    expect(r).toEqual({
      adopted: 1,
      diverged: 1,
      dispatched: 1,
      total: 4,
      lastVerifiedAt: '2026-08-05T00:00:00Z',
    });
  });
});

describe('buildTileView — absence is not signal', () => {
  it('null harvest gives no extraction signal unless forged', () => {
    const v = buildTileView(
      makeTile({ presence: { inRegistry: true, domains: [], forgedFrom: false } }),
      null,
      FULL_PRACTICES,
    );
    expect(v.extractionSignal).toBe(false);
  });

  it('a zero-harvested rollup is still not extraction signal', () => {
    const v = buildTileView(
      makeTile({ presence: { inRegistry: true, domains: [], forgedFrom: false } }),
      { lastHarvestedAt: null, itemsFound: 0, runCount: 0, scopesHarvested: 0, scopesTotal: 3 },
      FULL_PRACTICES,
    );
    expect(v.extractionSignal).toBe(false);
  });

  it('forgedFrom alone carries the extraction signal (registry half)', () => {
    const v = buildTileView(makeTile(), null, FULL_PRACTICES);
    expect(v.extractionSignal).toBe(true);
  });

  it('applied has no signal with zero skills, no map, no practice rows', () => {
    const v = buildTileView(
      makeTile({
        applied: { skillsAdopted: 0, skillsBehind: 0, skillsDetail: [], registryMap: null },
      }),
      FULL_HARVEST,
      null,
    );
    expect(v.appliedSignal).toBe(false);
  });

  it('a never-mapped registry map ({exists:false}) is not applied signal', () => {
    const v = buildTileView(
      makeTile({
        applied: {
          skillsAdopted: 0,
          skillsBehind: 0,
          skillsDetail: [],
          registryMap: makeMap({ exists: false, mtime: null, conformant: 0, deviation: 0 }),
        },
      }),
      FULL_HARVEST,
      null,
    );
    expect(v.appliedSignal).toBe(false);
  });

  it('practice rollup rows alone carry the applied signal', () => {
    const v = buildTileView(
      makeTile({
        applied: { skillsAdopted: 0, skillsBehind: 0, skillsDetail: [], registryMap: null },
      }),
      FULL_HARVEST,
      FULL_PRACTICES,
    );
    expect(v.appliedSignal).toBe(true);
  });
});

describe('buildTileView — the merged staleness clock', () => {
  it('merges the Rust clock with harvest and adoption clocks (null-safe max)', () => {
    const v = buildTileView(
      makeTile({
        staleness: { projectLastAction: '2026-08-01T00:00:00Z', registryLastMove: null },
      }),
      { ...FULL_HARVEST, lastHarvestedAt: '2026-08-15T00:00:00Z' },
      { ...FULL_PRACTICES, lastVerifiedAt: '2026-08-20T00:00:00Z' },
    );
    expect(v.projectLastAction).toBe('2026-08-20T00:00:00Z');
  });

  it('is null when no clock carries a date', () => {
    const v = buildTileView(
      makeTile({ staleness: { projectLastAction: null, registryLastMove: null } }),
      { ...FULL_HARVEST, lastHarvestedAt: null },
      { ...FULL_PRACTICES, lastVerifiedAt: null },
    );
    expect(v.projectLastAction).toBeNull();
    expect(v.freshness).toBe('never');
    expect(v.freshnessSignal).toBe(false);
  });

  it('derives behind when the registry moved after the last project action', () => {
    const v = buildTileView(
      makeTile({
        staleness: {
          projectLastAction: '2026-08-01T00:00:00Z',
          registryLastMove: '2026-08-10T00:00:00Z',
        },
      }),
      null,
      null,
    );
    expect(v.freshness).toBe('behind');
  });

  it('a DB clock newer than the registry move flips behind back to synced', () => {
    const v = buildTileView(
      makeTile({
        staleness: {
          projectLastAction: '2026-08-01T00:00:00Z',
          registryLastMove: '2026-08-10T00:00:00Z',
        },
      }),
      { ...FULL_HARVEST, lastHarvestedAt: '2026-08-12T00:00:00Z' },
      null,
    );
    expect(v.freshness).toBe('synced');
  });

  it('a project clock without a registry clock is not freshness signal', () => {
    const v = buildTileView(
      makeTile({
        staleness: { projectLastAction: '2026-08-01T00:00:00Z', registryLastMove: null },
      }),
      null,
      null,
    );
    expect(v.freshness).toBe('synced');
    expect(v.freshnessSignal).toBe(false);
    expect(v.inSync).toBe(false);
  });
});

describe('buildTileView — earned in-sync (plan D5)', () => {
  it('grants in-sync only with zero debts and all four signals', () => {
    const v = buildTileView(makeTile(), FULL_HARVEST, FULL_PRACTICES);
    expect(v.presenceSignal).toBe(true);
    expect(v.extractionSignal).toBe(true);
    expect(v.appliedSignal).toBe(true);
    expect(v.freshnessSignal).toBe(true);
    expect(v.inSync).toBe(true);
  });

  it('zero debts with a missing signal is NOT in-sync', () => {
    // Applied dimension silent: no skills, no map, no practice rows.
    const v = buildTileView(
      makeTile({
        applied: { skillsAdopted: 0, skillsBehind: 0, skillsDetail: [], registryMap: null },
      }),
      FULL_HARVEST,
      null,
    );
    expect(v.tile.debts).toHaveLength(0);
    expect(v.inSync).toBe(false);
  });

  it('any debt blocks in-sync even with all four signals', () => {
    const v = buildTileView(
      makeTile({ debts: [{ kind: 'skills-behind', detail: '1 skill behind' }] }),
      FULL_HARVEST,
      FULL_PRACTICES,
    );
    expect(v.inSync).toBe(false);
  });

  it('behind freshness blocks in-sync', () => {
    const v = buildTileView(
      makeTile({
        staleness: {
          projectLastAction: '2026-08-01T00:00:00Z',
          // Later than every DB clock in the fixtures — the merged project
          // clock still trails, so the tile is genuinely behind.
          registryLastMove: '2026-08-25T00:00:00Z',
        },
      }),
      FULL_HARVEST,
      FULL_PRACTICES,
    );
    expect(v.freshness).toBe('behind');
    expect(v.inSync).toBe(false);
  });
});

describe('buildTileView — debt pass-through', () => {
  it('passes the Rust debt list through verbatim', () => {
    const debts = [
      { kind: 'never-mapped', detail: 'no .ai/registry-map.json' },
      { kind: 'map-stale', detail: 'digest moved' },
    ];
    const v = buildTileView(makeTile({ debts }), FULL_HARVEST, FULL_PRACTICES);
    expect(v.tile.debts).toEqual(debts);
  });
});
