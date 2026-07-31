// Unit tests for the Crew Foundry brief compiler — pure logic, no I/O.
import { describe, expect, it } from 'vitest';

import type { AppPassport, AutomationReadiness, ProductionReadiness } from '../passport/passportModel';
import {
  MAX_BRIEF_CHARS,
  compileCrewBrief,
  derivePassportGaps,
  directiveLines,
  type CrewBriefInput,
} from './briefCompiler';

// derivePassportGaps only reads productionReadiness + automationReadiness
// .artifacts; the rest of the passport is irrelevant to this unit.
function passportWith(
  prod: Partial<ProductionReadiness>,
  artifacts: Partial<AutomationReadiness['artifacts']> = {},
): AppPassport {
  const productionReadiness: ProductionReadiness = {
    band: 'beta',
    score: 50,
    ci: { level: 'gated' },
    tests: { level: 'substantial' },
    security: { level: 'scanning' },
    observability: { level: 'metrics' },
    delivery: { migrations: 'versioned', iac: false, rollback: false },
    blockers: [],
    ...prod,
  };
  const automationReadiness = {
    level: 'L3',
    score: 50,
    selfVerify: { build: true, test: true, lint: true, typecheck: true },
    aiInWorkflow: true,
    blockers: [],
    artifacts: {
      agentInstructions: [],
      contextGraph: 'full',
      memory: 'curated',
      docs: 'structured',
      manifest: true,
      evals: 'partial',
      skills: true,
      ...artifacts,
    },
  } as AutomationReadiness;
  return { productionReadiness, automationReadiness } as AppPassport;
}

function baseInput(overrides: Partial<CrewBriefInput> = {}): CrewBriefInput {
  return {
    projectName: 'Acme Ledger',
    summary: 'Bookkeeping SaaS',
    pulse: null,
    contexts: [],
    passportGaps: [],
    offTrackKpis: [],
    ...overrides,
  };
}

describe('derivePassportGaps', () => {
  it('surfaces only bottom-half dimensions, weakest first, with human labels', () => {
    const gaps = derivePassportGaps(
      passportWith({ tests: { level: 'smoke' }, ci: { level: 'build' } }, { docs: 'none' }),
    );
    // Severity = depth below the top of each scale: docs none = 1.0,
    // ci build = 0.8 (6-rung scale), tests smoke = 0.75 (5-rung scale).
    expect(gaps.map((g) => g.dimension)).toEqual(['Docs', 'CI', 'Tests']);
    expect(gaps[0]?.level).toBe('None');
    expect(gaps[1]?.level).toBe('Build only');
    expect(gaps[2]?.level).toBe('Smoke');
    // Healthy dimensions (security=scanning, observability=metrics, …) are absent.
    expect(gaps.find((g) => g.dimension === 'Security')).toBeUndefined();
  });

  it('returns empty for a healthy passport — no invented deficits', () => {
    expect(derivePassportGaps(passportWith({}))).toEqual([]);
  });
});

describe('compileCrewBrief', () => {
  it('maps incident heat to a Reliability directive anchored to the hottest contexts', () => {
    const out = compileCrewBrief(baseInput({
      contexts: [
        { name: 'checkout', errorCount: 34, goalCount: 0 },
        { name: 'auth', errorCount: 2, goalCount: 0 },
        { name: 'quiet', errorCount: 0, goalCount: 0 },
      ],
    }));
    const rel = out.roleDirectives.find((d) => d.role === 'Reliability');
    expect(rel).toBeDefined();
    expect(rel?.focus).toContain('checkout (34 errors)');
    expect(rel?.focus).not.toContain('quiet');
    // Hottest first in the anchor list.
    expect(rel!.focus.indexOf('checkout')).toBeLessThan(rel!.focus.indexOf('auth'));
    expect(out.deficits.some((d) => d.startsWith('Incident heat'))).toBe(true);
  });

  it('maps off-track KPIs and passport gaps to named specialist directives', () => {
    const out = compileCrewBrief(baseInput({
      offTrackKpis: [{ name: 'p95 latency', contextName: 'api', current: 900, target: 300, unit: 'ms' }],
      passportGaps: [
        { dimension: 'Docs', level: 'README only', severity: 0.9 },
        { dimension: 'Tests', level: 'Smoke', severity: 0.75 },
      ],
    }));
    const roles = out.roleDirectives.map((d) => d.role);
    expect(roles).toContain('KPI driver');
    expect(roles).toContain('Docs');
    expect(roles).toContain('QA');
    expect(out.roleDirectives.find((d) => d.role === 'KPI driver')?.focus)
      .toContain('p95 latency at 900/300 ms in api');
    expect(out.roleDirectives.find((d) => d.role === 'Docs')?.focus).toContain('README only');
  });

  it('always ends with an Implementer anchored to the goal-bearing contexts', () => {
    const out = compileCrewBrief(baseInput({
      contexts: [
        { name: 'billing', errorCount: null, goalCount: 3 },
        { name: 'idle', errorCount: null, goalCount: 0 },
      ],
    }));
    const impl = out.roleDirectives.find((d) => d.role === 'Implementer');
    expect(impl?.focus).toContain('billing (3 goals)');
    expect(impl?.focus).not.toContain('idle');
  });

  it('is honest when telemetry is thin: no invented deficits, minimal crew', () => {
    const out = compileCrewBrief(baseInput());
    expect(out.deficits).toEqual([]);
    // Only the implementer remains — never generic filler roles.
    expect(out.roleDirectives.map((d) => d.role)).toEqual(['Implementer']);
    expect(out.brief).toContain('none detected');
  });

  it('caps directives at five, keeping highest-signal ones plus the implementer', () => {
    const out = compileCrewBrief(baseInput({
      contexts: [{ name: 'hot', errorCount: 9, goalCount: 1 }],
      offTrackKpis: [{ name: 'k', contextName: null, current: 1, target: 2, unit: 'x' }],
      passportGaps: [
        { dimension: 'Docs', level: 'None', severity: 1 },
        { dimension: 'Security', level: 'None', severity: 1 },
        { dimension: 'CI', level: 'None', severity: 0.9 },
      ],
    }));
    expect(out.roleDirectives.length).toBeLessThanOrEqual(5);
    // Only the top-2 passport gaps produce directives.
    expect(out.roleDirectives.map((d) => d.role)).toEqual(
      ['Reliability', 'KPI driver', 'Docs', 'Security', 'Implementer'],
    );
  });

  it('includes pulse tensions and trims the narrative to stay under the server cap', () => {
    const out = compileCrewBrief(baseInput({
      pulse: {
        narrativeMd: 'x'.repeat(5000),
        tensions: ['refactor debt vs feature pressure'],
        directions: [],
      },
    }));
    expect(out.brief).toContain('refactor debt vs feature pressure');
    expect(out.brief.length).toBeLessThanOrEqual(MAX_BRIEF_CHARS);
    // Narrative made it in (trimmed), signalled by the section header.
    expect(out.brief).toContain('Pulse:');
  });

  it('directiveLines yields one wire line per directive', () => {
    const out = compileCrewBrief(baseInput({
      contexts: [{ name: 'core', errorCount: 5, goalCount: 2 }],
    }));
    expect(directiveLines(out)).toEqual(out.roleDirectives.map((d) => d.focus));
  });
});
