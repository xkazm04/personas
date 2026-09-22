/**
 * The fixture mapper, driven against the REAL checked-in reference file.
 *
 * It exists because the file is snake_case where the product binding is
 * camelCase, and a fixture typed as the product shape has already crashed one
 * page in this repo. So the test reads the actual bytes on disk, maps them, and
 * asserts that every list the page iterates is a list - never `undefined`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SCENARIO_DEFAULT_FLOOR } from '@/api/devTools/features';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';

import { foldFixtureEnvelope, mapFixtureProject } from '../fixture/featuresFixture';

/** `window.NAME = { … };` -> the object, the same way the loader does it. */
function readAssignment(file: string, name: string): unknown {
  const source = readFileSync(join(process.cwd(), 'docs/design/features-reference/data', file), 'utf8');
  const start = source.indexOf(`window.${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(open, i + 1));
    }
  }
  throw new Error('unbalanced');
}

// The two casts cross a data boundary and are safe for one named reason: the
// shapes are fixed by `docs/design/features-reference/data/SCHEMA.md`, the files
// are checked in beside it, and `JSON.parse` above throws before anything
// downstream sees a malformed one.
const bundle = readAssignment('features.js', 'FEATURES') as {
  projects: Parameters<typeof mapFixtureProject>[0][];
};
const scenarios = readAssignment('scenarios.js', 'SCENARIOS') as Parameters<typeof mapFixtureProject>[1];

describe('the fixture mapper', () => {
  it('maps every checked-in project without yielding an undefined list', () => {
    expect(bundle.projects.length).toBeGreaterThan(0);
    for (const project of bundle.projects) {
      const board = mapFixtureProject(project, scenarios);
      expect(Array.isArray(board.groups)).toBe(true);
      expect(Array.isArray(board.contexts)).toBe(true);
      expect(Array.isArray(board.features)).toBe(true);
      expect(board.features.length).toBeGreaterThan(0);
      for (const f of board.features) {
        // Every list the page iterates. `undefined` here is a crash at render.
        for (const list of [f.contextIds, f.groupIds, f.verdicts, f.history, f.scenarios]) {
          expect(Array.isArray(list), f.slug).toBe(true);
        }
        // `spend30dUsd` is null everywhere in the product, so the fixture
        // matches the product rather than the file: the page draws nothing.
        expect(f.spend30dUsd, f.slug).toBeNull();
      }
      for (const c of board.contexts) expect(Array.isArray(c.featureSlugs), c.name).toBe(true);
    }
  });

  it('translates snake_case to camelCase and resolves feature titles to slugs', () => {
    const board = mapFixtureProject(bundle.projects[0]!, scenarios);
    const claimed = board.contexts.filter((c) => c.role === 'core');
    expect(claimed.length).toBeGreaterThan(0);
    const knownSlugs = new Set(board.features.map((f) => f.slug));
    for (const c of claimed) {
      for (const slug of c.featureSlugs) expect(knownSlugs.has(slug), `${c.name}:${slug}`).toBe(true);
    }
    const councilled = board.features.find((f) => f.council != null);
    expect(councilled?.council?.roundNo).not.toBeUndefined();
    expect(councilled?.council?.trustState).not.toBeUndefined();
  });

  it('gives a feature with no declared branches NO envelope, not an empty one', () => {
    const board = mapFixtureProject(bundle.projects[0]!, scenarios);
    const withNone = board.features.find((f) => f.scenarios.length === 0);
    expect(withNone).toBeDefined();
    expect(withNone?.envelope).toBeNull();
    const withSome = board.features.find((f) => f.scenarios.length > 0);
    expect(withSome?.envelope).not.toBeNull();
  });

  it('counts the totals from the contexts it actually mapped', () => {
    const board = mapFixtureProject(bundle.projects[0]!, scenarios);
    const { core, platform, tests, unclaimed, contexts } = board.totals;
    expect(core + platform + tests + unclaimed).toBe(contexts);
    expect(board.totals.waitingOnYou).toBe(
      board.features.filter((f) => f.council?.state === 'ready' && f.tier === 'major').length,
    );
  });
});

describe('the fold (S6, S7, S8)', () => {
  const row = (over: Partial<BoardScenario>): BoardScenario => ({
    id: 'x', slug: 'x', title: 'X', axes: {}, scope: 'must_hold', source: 'operator', floor: 0.7,
    latest: null, ...over,
  });
  const measured = (score: number) => ({
    runId: 'r', state: 'measured', score, confidence: 'high', n: 3, proof: 'observed',
    floorHit: false, advisory: false, summary: '',
  });

  it('puts every scenario in exactly one bucket', () => {
    const rows = [
      row({ slug: 'a', scope: 'must_hold', floor: 0.7, latest: measured(0.8) }),
      row({ slug: 'b', scope: 'must_hold', floor: 0.7, latest: measured(0.6) }),
      row({ slug: 'c', scope: 'tracked', floor: 0.9, latest: measured(0.6) }),
      row({ slug: 'd', scope: 'tracked', latest: null }),
      row({ slug: 'e', scope: 'out_of_scope' }),
      row({ slug: 'f', scope: 'proposed' }),
    ];
    const env = foldFixtureEnvelope(rows);
    // `c` is tracked at 0.6 against the FLAT default of 0.5, so it holds even
    // though its declared floor is 0.9: a tracked branch is watched, not
    // governed by a declared floor.
    expect(SCENARIO_DEFAULT_FLOOR).toBe(0.5);
    expect(env.holds).toEqual(['a', 'c']);
    expect(env.weak).toEqual(['b']);
    expect(env.unmeasured).toEqual(['d']);
    expect(env.outOfScope).toEqual(['e']);
    expect(env.proposed).toEqual(['f']);
    const all = [...env.holds, ...env.weak, ...env.unmeasured, ...env.outOfScope, ...env.proposed];
    expect(all).toHaveLength(rows.length);
    expect(new Set(all).size).toBe(rows.length);
  });

  it('never buckets a measured-but-scoreless row as a score', () => {
    const env = foldFixtureEnvelope([
      row({ slug: 'a', latest: { ...measured(0), score: null } }),
    ]);
    expect(env.unmeasured).toEqual(['a']);
    expect(env.weak).toEqual([]);
  });

  it('marks a proposed branch proposed even when a run measured it', () => {
    const env = foldFixtureEnvelope([row({ slug: 'p', scope: 'proposed', latest: measured(0.95) })]);
    expect(env.proposed).toEqual(['p']);
    expect(env.holds).toEqual([]);
  });
});
