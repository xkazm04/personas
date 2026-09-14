// coverageModel — the view doctrine under test: absence is not signal,
// "in sync" is earned, and the staleness clock is null-safe.
import { describe, expect, it } from 'vitest';

import type { CoverageTile } from '@/lib/bindings/CoverageTile';
import type { RegistryMapState } from '@/lib/bindings/RegistryMapState';

import { buildTileView, maxIso } from '../coverageModel';

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

describe('buildTileView — absence is not signal', () => {
  it('no forgedFrom means no extraction signal', () => {
    const v = buildTileView(
      makeTile({ presence: { inRegistry: true, domains: [], forgedFrom: false } }),
    );
    expect(v.extractionSignal).toBe(false);
  });

  it('forgedFrom carries the extraction signal', () => {
    expect(buildTileView(makeTile()).extractionSignal).toBe(true);
  });

  it('applied has no signal with zero skills and no map', () => {
    const v = buildTileView(
      makeTile({
        applied: { skillsAdopted: 0, skillsBehind: 0, skillsDetail: [], registryMap: null },
      }),
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
    );
    expect(v.appliedSignal).toBe(false);
  });

  it('adopted skills alone carry the applied signal', () => {
    const v = buildTileView(
      makeTile({
        applied: { skillsAdopted: 1, skillsBehind: 0, skillsDetail: [], registryMap: null },
      }),
    );
    expect(v.appliedSignal).toBe(true);
  });
});

describe('buildTileView — the staleness clock', () => {
  it('is null when no clock carries a date', () => {
    const v = buildTileView(
      makeTile({ staleness: { projectLastAction: null, registryLastMove: null } }),
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
    );
    expect(v.freshness).toBe('behind');
  });

  it('a project clock without a registry clock is not freshness signal', () => {
    const v = buildTileView(
      makeTile({
        staleness: { projectLastAction: '2026-08-01T00:00:00Z', registryLastMove: null },
      }),
    );
    expect(v.freshness).toBe('synced');
    expect(v.freshnessSignal).toBe(false);
    expect(v.inSync).toBe(false);
  });
});

describe('buildTileView — earned in-sync (plan D5)', () => {
  it('grants in-sync only with zero debts and all four signals', () => {
    const v = buildTileView(makeTile());
    expect(v.presenceSignal).toBe(true);
    expect(v.extractionSignal).toBe(true);
    expect(v.appliedSignal).toBe(true);
    expect(v.freshnessSignal).toBe(true);
    expect(v.inSync).toBe(true);
  });

  it('zero debts with a missing signal is NOT in-sync', () => {
    const v = buildTileView(
      makeTile({
        applied: { skillsAdopted: 0, skillsBehind: 0, skillsDetail: [], registryMap: null },
      }),
    );
    expect(v.tile.debts).toHaveLength(0);
    expect(v.inSync).toBe(false);
  });

  it('any debt blocks in-sync even with all four signals', () => {
    const v = buildTileView(
      makeTile({ debts: [{ kind: 'skills-behind', detail: '1 skill behind' }] }),
    );
    expect(v.inSync).toBe(false);
  });

  it('behind freshness blocks in-sync', () => {
    const v = buildTileView(
      makeTile({
        staleness: {
          projectLastAction: '2026-08-01T00:00:00Z',
          registryLastMove: '2026-08-25T00:00:00Z',
        },
      }),
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
    const v = buildTileView(makeTile({ debts }));
    expect(v.tile.debts).toEqual(debts);
  });
});
