import { describe, it, expect } from 'vitest';

import { deriveScene, type KpiRollup } from '../lib/deriveScene';
import type { DimKey, DimStatus, Island } from '../lib/types';
import { makePassport, type PassportOverrides } from './passportFactory';

/** Derive a single island from one passport override and pull out one dim. */
function dim(key: DimKey, o: PassportOverrides, kpi?: Map<string, KpiRollup>): { status: DimStatus; detail: string | null } {
  const p = makePassport({ slug: 's', ...o });
  const scene = deriveScene([p], null, false, kpi);
  const node = scene.islands[0].nodes.find((n) => n.key === key)!;
  return { status: node.status, detail: node.detail };
}

describe('deriveScene — dimension status derivations', () => {
  it('db: none→absent, no-migrations→partial, migrated→solid', () => {
    expect(dim('db', { persistence: [{ kind: 'none' }] }).status).toBe('absent');
    expect(dim('db', { persistence: [{ kind: 'relational' }] }).status).toBe('partial');
    expect(dim('db', { persistence: [{ kind: 'relational', engine: 'Postgres', migrations: 'versioned' }] }).status).toBe('solid');
  });

  it('db detail names the engine', () => {
    expect(dim('db', { persistence: [{ kind: 'relational', engine: 'Postgres', migrations: 'versioned' }] }).detail).toBe('Postgres');
  });

  it('monitoring: none→absent, logs→partial, errors→solid', () => {
    expect(dim('monitoring', { observabilityLevel: 'none' }).status).toBe('absent');
    expect(dim('monitoring', { observabilityLevel: 'logs' }).status).toBe('partial');
    expect(dim('monitoring', { observabilityLevel: 'errors' }).status).toBe('solid');
  });

  it('monitoring: a named tool alone lifts it off absent', () => {
    expect(dim('monitoring', { observabilityLevel: 'none', monitoring: { errorTracking: 'Sentry' } }).status).toBe('partial');
  });

  it('ci: none→absent, build→partial, gated→solid', () => {
    expect(dim('ci', { ciLevel: 'none' }).status).toBe('absent');
    expect(dim('ci', { ciLevel: 'build' }).status).toBe('partial');
    expect(dim('ci', { ciLevel: 'gated', ciProvider: 'GitHub Actions' }).status).toBe('solid');
    expect(dim('ci', { ciLevel: 'gated', ciProvider: 'GitHub Actions' }).detail).toBe('GitHub Actions');
  });

  it('tests: none→absent, smoke→risk, partial→partial, substantial→solid', () => {
    expect(dim('tests', { testsLevel: 'none' }).status).toBe('absent');
    expect(dim('tests', { testsLevel: 'smoke' }).status).toBe('risk');
    expect(dim('tests', { testsLevel: 'partial' }).status).toBe('partial');
    expect(dim('tests', { testsLevel: 'substantial' }).status).toBe('solid');
  });

  it('tests detail prefers coverage %', () => {
    expect(dim('tests', { testsLevel: 'substantial', testsCoverage: 81 }).detail).toBe('81% cov');
  });

  it('security: none→absent, policy→partial, scanning→solid', () => {
    expect(dim('security', { securityLevel: 'none' }).status).toBe('absent');
    expect(dim('security', { securityLevel: 'policy' }).status).toBe('partial');
    expect(dim('security', { securityLevel: 'scanning', securityTools: ['Snyk'] }).status).toBe('solid');
  });

  it('hosting/auth: presence toggles solid vs absent', () => {
    expect(dim('hosting', { hosting: null }).status).toBe('absent');
    expect(dim('hosting', { hosting: 'Vercel' }).status).toBe('solid');
    expect(dim('auth', { auth: null }).status).toBe('absent');
    expect(dim('auth', { auth: 'Clerk' }).status).toBe('solid');
  });

  it('agents: L1→risk, L3→partial, L4→solid (never absent)', () => {
    expect(dim('agents', { automationLevel: 'L1' }).status).toBe('risk');
    expect(dim('agents', { automationLevel: 'L3' }).status).toBe('partial');
    expect(dim('agents', { automationLevel: 'L4' }).status).toBe('solid');
  });

  it('skills/llm: boolean presence toggles solid vs absent', () => {
    expect(dim('skills', { skills: false }).status).toBe('absent');
    expect(dim('skills', { skills: true }).status).toBe('solid');
    expect(dim('llm', { llmTracking: null }).status).toBe('absent');
    expect(dim('llm', { llmTracking: 'connected' }).status).toBe('solid');
  });
});

describe('deriveScene — KPI rollup states', () => {
  const kpiMap = (r: KpiRollup | undefined) => {
    const m = new Map<string, KpiRollup>();
    if (r) m.set('s', r);
    return m;
  };

  it('absent when no rollup or zero total', () => {
    expect(dim('kpi', {}, kpiMap(undefined)).status).toBe('absent');
    expect(dim('kpi', {}, kpiMap({ total: 0, off: 0 })).status).toBe('absent');
  });

  it('alert when any KPI is off-track', () => {
    const r = dim('kpi', {}, kpiMap({ total: 4, off: 2 }));
    expect(r.status).toBe('alert');
    expect(r.detail).toBe('2 off-track');
  });

  it('solid when all KPIs on track', () => {
    const r = dim('kpi', {}, kpiMap({ total: 4, off: 0 }));
    expect(r.status).toBe('solid');
    expect(r.detail).toBe('4 on track');
  });
});

describe('deriveScene — scene shape', () => {
  it('every island carries all 12 dimensions', () => {
    const scene = deriveScene([makePassport({ slug: 'a' })], null, false);
    const keys = scene.islands[0].nodes.map((n) => n.key);
    expect(keys).toHaveLength(12);
    expect(new Set(keys)).toEqual(
      new Set<DimKey>(['db', 'monitoring', 'ci', 'tests', 'security', 'hosting', 'auth', 'agents', 'skills', 'llm', 'kpi', 'ideas']),
    );
  });

  it('real passports → demo:false; empty+not-loading → demo scene', () => {
    expect(deriveScene([makePassport()], null, false).demo).toBe(false);
    const demo = deriveScene([], null, false);
    expect(demo.demo).toBe(true);
    expect(demo.islands.length).toBeGreaterThan(0);
    // Demo islands also carry the full 12-dim shape.
    for (const isl of demo.islands) expect(isl.nodes).toHaveLength(12);
  });

  it('empty + loading → blank scene (no demo flash)', () => {
    const s = deriveScene([], null, true);
    expect(s).toEqual({ islands: [], edges: [], demo: false });
  });

  it('island state derives from the worst of the two readiness scores', () => {
    const healthy = deriveScene([makePassport({ autoScore: 90, prodScore: 85 })], null, false).islands[0];
    const critical = deriveScene([makePassport({ autoScore: 90, prodScore: 20 })], null, false).islands[0];
    expect(healthy.state).toBe<Island['state']>('healthy');
    expect(critical.state).toBe<Island['state']>('critical');
  });
});
