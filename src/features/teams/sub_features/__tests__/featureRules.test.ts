/**
 * The rules the whole page shares, driven over their CLOSED SETS rather than a
 * sample. Each of these has exactly one right answer and several plausible
 * wrong ones, which is why they live in one module and are tested here instead
 * of being re-derived at four call sites.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COUNCIL_GLYPH_KINDS } from '@/features/plugins/dev-tools/sub_context/councilGlyph';
import { CONTEXT_ROLES } from '@/api/devTools/features';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import {
  FEATURE_MOVES,
  bucketFloor,
  featureCta,
  featureGlyphKind,
  featureMove,
  hasAdvisory,
  sortRows,
  squareTone,
  toContextRole,
  worstInScope,
  type FeatureRow,
} from '../featureRules';

function council(over: Partial<CouncilSubjectState> = {}): CouncilSubjectState {
  return {
    id: 's1', projectId: 'p1', kind: 'use_case', useCaseId: 'f1', slug: 'f1', title: 'F1',
    state: 'ready', tier: 'major', roundNo: 1, latestRunId: 'r1', outcome: 'ready',
    overall: 0.74, coverage: 1, trustState: 'uncalibrated', floorHits: 0, hardFailures: 0,
    drift: 'none', projectName: 'P', registrySubjects: [], runDir: null,
    finishedAt: null, decidedAt: null, rejectionReason: null,
    ...over,
  };
}

function feature(over: Partial<BoardFeature> = {}): BoardFeature {
  return {
    id: 'f1', slug: 'f1', name: 'Feature one', description: null, kind: 'user_flow',
    tier: 'major', contextIds: [], groupIds: [], primaryContextId: null,
    council: council(), verdicts: [], history: [], scenarios: [], envelope: null,
    spend30dUsd: null,
    ...over,
  };
}

function scenario(over: Partial<BoardScenario> = {}): BoardScenario {
  return {
    id: 's', slug: 's', title: 'S', axes: {}, scope: 'must_hold', source: 'operator',
    floor: 0.7, latest: null,
    ...over,
  };
}

describe('the one action', () => {
  it('offers "Open the decision" for ready AND major, and for nothing else', () => {
    const readyMajor = feature({ tier: 'major', council: council({ state: 'ready' }) });
    expect(featureCta('ready', readyMajor)).toBe('open_decision');

    const readyStandard = feature({ tier: 'standard', council: council({ state: 'ready', tier: 'standard' }) });
    expect(featureCta('ready', readyStandard)).toBe('none');

    for (const kind of COUNCIL_GLYPH_KINDS) {
      if (kind === 'ready') continue;
      expect(featureCta(kind, feature({ council: council({ state: kind }) })), kind).not.toBe('open_decision');
    }
  });

  it('a machine pass is not waiting on you - it is settled, and it offers promotion', () => {
    const f = feature({ tier: 'standard', council: council({ state: 'machine_pass', tier: 'standard' }) });
    expect(featureMove('machine_pass', f)).toBe('settled');
    expect(featureMove('machine_pass', f)).not.toBe('waiting');
    expect(featureCta('machine_pass', f)).toBe('promote');
  });

  it('an approval offers no action at all', () => {
    const f = feature({ council: council({ state: 'approved' }) });
    expect(featureCta('approved', f)).toBe('none');
  });

  it('a running council offers no second run', () => {
    const f = feature({ council: council({ state: 'none' }) });
    // The stored state would offer `run`; the live overlay wins and offers
    // nothing, because a second dispatch would be offering a refusal.
    expect(featureCta('none', f)).toBe('run');
    expect(featureGlyphKind(f, true)).toBe('running');
    expect(featureCta('running', f)).toBe('none');
    expect(featureMove('running', f)).toBe('working');
  });

  it('is total over the glyph vocabulary, with an explicit unknown arm', () => {
    for (const kind of COUNCIL_GLYPH_KINDS) {
      expect(FEATURE_MOVES).toContain(featureMove(kind, feature()));
      expect(featureCta(kind, feature())).toBeTruthy();
    }
    // A state this build has never heard of joins the never-councilled band and
    // offers nothing, rather than defaulting into a vocabulary member.
    expect(featureMove(null, feature())).toBe('never');
    expect(featureCta(null, feature())).toBe('none');
  });
});

describe('role colouring', () => {
  it('is total over the closed set and carries an explicit unknown arm', () => {
    for (const role of CONTEXT_ROLES) {
      expect(toContextRole(role)).toBe(role);
      for (const move of [...FEATURE_MOVES, null]) {
        expect(squareTone(toContextRole(role), move)).toBeTruthy();
      }
    }
    expect(toContextRole('shipped')).toBeNull();
    expect(toContextRole(null)).toBeNull();
    expect(squareTone(null, null)).toBe('unknown');
    // A core context whose claimant cannot be resolved IS claimed; it just has
    // no council temperature. It must never read as unclaimed ground.
    expect(squareTone('core', null)).toBe('claimed');
    expect(squareTone('core', null)).not.toBe('unclaimed');
  });
});

describe('a null score is never a zero', () => {
  it('sorts a feature with no overall LAST, not first', () => {
    const rows: FeatureRow[] = [
      { feature: feature({ id: 'a', name: 'A', council: council({ overall: null }) }), kind: 'none', move: 'never', running: false, span: 1 },
      { feature: feature({ id: 'b', name: 'B', council: council({ overall: 0.2 }) }), kind: 'fail', move: 'trouble', running: false, span: 3 },
    ];
    expect(sortRows(rows, 'score').map((r) => r.feature.id)).toEqual(['b', 'a']);
    expect(sortRows(rows, 'span').map((r) => r.feature.id)).toEqual(['b', 'a']);
    expect(sortRows(rows, 'name').map((r) => r.feature.id)).toEqual(['a', 'b']);
  });

  it('leaves an unmeasured scenario out of the worst-in-scope answer', () => {
    const rows = [
      scenario({ slug: 'a', latest: null }),
      scenario({ slug: 'b', latest: { runId: 'r', state: 'unmeasured', score: null, confidence: 'low', n: null, proof: 'claimed', floorHit: false, advisory: false, summary: '' } }),
      scenario({ slug: 'c', latest: { runId: 'r', state: 'measured', score: 0.42, confidence: 'high', n: 10, proof: 'observed', floorHit: true, advisory: false, summary: '' } }),
    ];
    expect(worstInScope(rows)?.slug).toBe('c');
    // Nothing measured at all is NULL, not a zero-scoring branch.
    expect(worstInScope([scenario({ latest: null })])).toBeNull();
  });

  it('holds a tracked branch to the flat default and a must-hold to its own floor', () => {
    expect(bucketFloor(scenario({ scope: 'must_hold', floor: 0.9 }))).toBe(0.9);
    expect(bucketFloor(scenario({ scope: 'tracked', floor: 0.9 }))).toBe(0.5);
  });

  it('says advisory once, and only for a row that actually carries it', () => {
    const plain = scenario({ latest: { runId: 'r', state: 'measured', score: 0.1, confidence: 'high', n: 1, proof: 'observed', floorHit: true, advisory: false, summary: '' } });
    expect(hasAdvisory([plain])).toBe(false);
    expect(hasAdvisory([{ ...plain, latest: { ...plain.latest!, advisory: true } }])).toBe(true);
  });
});

/*
 * The product path renders `BoardFeature.envelope` straight off the board. One
 * fold exists in this language, in the fixture mapper, and only because the
 * fixture has nothing behind it. The test below is the tripwire: if a component
 * ever grows a second fold, it fails.
 */
describe('the envelope is read, never recomputed', () => {
  it('has exactly one fold in the frontend, and it is the fixture mapper', () => {
    const root = join(process.cwd(), 'src/features/teams/sub_features');
    const owners = [
      'fixture/featuresFixture.ts',
      '__tests__/featuresFixture.test.ts',
      '__tests__/featureRules.test.ts',
    ];
    const suspects = [
      'FeaturesPage.tsx',
      'featureRules.ts',
      'featuresModel.ts',
      'scenarios/ScenariosPanel.tsx',
      'scenarios/ScenarioCell.tsx',
      'feature/FeatureTab.tsx',
    ];
    for (const file of suspects) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toContain('foldFixtureEnvelope');
    }
    expect(readFileSync(join(root, owners[0]!), 'utf8')).toContain('export function foldFixtureEnvelope');
  });
});
