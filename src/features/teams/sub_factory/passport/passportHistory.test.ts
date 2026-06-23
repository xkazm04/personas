import { describe, it, expect, beforeEach } from 'vitest';
import { recordSnapshot, getHistory, trendDelta } from './passportHistory';
import type { AppPassport } from './passportModel';

// In-memory localStorage stub so the test is independent of the JS env.
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

function mk(slug: string, auto: number, prod: number): AppPassport {
  return {
    passport: 'app-passport', passportVersion: '0',
    identity: { name: slug, slug, purpose: '', archetype: 'team', lifecycle: 'alpha', criticality: 'internal' },
    stack: { languages: [], frameworks: [], persistence: [], monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null }, integrations: [] },
    automationReadiness: { level: 'L1', score: auto, artifacts: { agentInstructions: [], contextGraph: 'none', memory: false, manifest: false, evals: 'none', skills: false }, selfVerify: { build: false, test: false, lint: false, typecheck: false }, aiInWorkflow: false, blockers: [] },
    productionReadiness: { band: 'prototype', score: prod, ci: { level: 'none' }, tests: { level: 'none' }, security: { level: 'none' }, observability: { level: 'none' }, delivery: { migrations: 'none', iac: false, rollback: false }, blockers: [] },
  };
}

describe('passportHistory', () => {
  it('records a first snapshot', () => {
    recordSnapshot([mk('a', 30, 20)], 1000);
    expect(getHistory('a')).toHaveLength(1);
  });

  it('dedupes unchanged readings — no new point when nothing moved', () => {
    recordSnapshot([mk('a', 30, 20)], 1000);
    recordSnapshot([mk('a', 30, 20)], 2000);
    expect(getHistory('a')).toHaveLength(1);
  });

  it('appends a point when a reading changes', () => {
    recordSnapshot([mk('a', 30, 20)], 1000);
    recordSnapshot([mk('a', 45, 20)], 2000);
    const h = getHistory('a');
    expect(h).toHaveLength(2);
    expect(h[1]!.auto).toBe(45);
  });

  it('trendDelta reports the move vs the previous snapshot, null when single', () => {
    recordSnapshot([mk('a', 30, 20)], 1000);
    expect(trendDelta('a')).toBeNull();
    recordSnapshot([mk('a', 50, 28)], 2000);
    const d = trendDelta('a')!;
    expect(d.auto).toBe(20);
    expect(d.prod).toBe(8);
  });
});
