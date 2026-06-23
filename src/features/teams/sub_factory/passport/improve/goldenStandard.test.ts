import { describe, it, expect } from 'vitest';
import { scoreAgainstRubric, RUBRIC } from './goldenStandard';
import type { AppPassport, Archetype } from '../passportModel';

// Minimal passport factory — only the fields the rubric reads.
function mk(over: { archetype?: Archetype; full?: boolean } = {}): AppPassport {
  const full = over.full ?? false;
  return {
    passport: 'app-passport', passportVersion: '0',
    identity: { name: 'x', slug: 'x', purpose: '', archetype: over.archetype ?? 'team', lifecycle: 'alpha', criticality: 'internal' },
    stack: { languages: [], frameworks: [], persistence: [], monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null }, integrations: [] },
    automationReadiness: {
      level: 'L1', score: 0,
      artifacts: { agentInstructions: full ? ['x'] : [], contextGraph: full ? 'full' : 'none', memory: false, manifest: full, evals: full ? 'full' : 'none', skills: full },
      selfVerify: { build: full, test: full, lint: full, typecheck: full },
      aiInWorkflow: full, blockers: [],
    },
    productionReadiness: {
      band: 'prototype', score: 0,
      ci: { level: full ? 'delivery' : 'none' },
      tests: { level: full ? 'comprehensive' : 'none' },
      security: { level: full ? 'supply-chain' : 'none' },
      observability: { level: full ? 'tracing' : 'none' },
      delivery: { migrations: full ? 'versioned' : 'none', iac: false, rollback: false },
      blockers: [],
    },
  };
}

describe('goldenStandard rubric', () => {
  it('a fully-instrumented project meets 100% of every archetype standard', () => {
    for (const a of ['solo', 'team', 'org'] as Archetype[]) {
      const r = scoreAgainstRubric(mk({ archetype: a, full: true }));
      expect(r.goldenPct).toBe(100);
      expect(r.belowTarget).toHaveLength(0);
    }
  });

  it('an empty project is below the team standard on the weighted dimensions', () => {
    const r = scoreAgainstRubric(mk({ archetype: 'team', full: false }));
    expect(r.goldenPct).toBeLessThan(20);
    // every dim with a team target > 0 is below
    const expectedBelow = RUBRIC.filter((d) => d.target.team > 0).length;
    expect(r.belowTarget.length).toBe(expectedBelow);
  });

  it('targets scale with archetype — solo bar is easier than org', () => {
    const empty = mk({ full: false });
    const solo = scoreAgainstRubric({ ...empty, identity: { ...empty.identity, archetype: 'solo' } });
    const org = scoreAgainstRubric({ ...empty, identity: { ...empty.identity, archetype: 'org' } });
    // a solo project is held to fewer/lower targets, so an empty solo app
    // scores no worse — and generally better — than the same app judged as org.
    expect(solo.goldenPct).toBeGreaterThanOrEqual(org.goldenPct);
    expect(solo.belowTarget.length).toBeLessThanOrEqual(org.belowTarget.length);
  });

  it('belowTarget is sorted weakest-progress first', () => {
    const r = scoreAgainstRubric(mk({ archetype: 'org', full: false }));
    for (let i = 1; i < r.belowTarget.length; i++) {
      expect(r.belowTarget[i]!.progress).toBeGreaterThanOrEqual(r.belowTarget[i - 1]!.progress);
    }
  });
});
