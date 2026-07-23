import { describe, it, expect } from 'vitest';
import type { DevProject } from '@/lib/bindings/DevProject';
import { buildKpiSimPrompt, kpiSimDispatchKey } from '../kpiSimPrompt';

const project = { id: 'p1', name: 'Proj', root_path: 'C:/x' } as DevProject;

describe('kpiSimPrompt', () => {
  it('keys dispatches per project', () => {
    expect(kpiSimDispatchKey('p1')).toBe('kpi-sim:p1');
  });

  it('carries the full self-contained doctrine (skill-less repos)', () => {
    const p = buildKpiSimPrompt(project, 'l1');
    // The three epistemic classes + the ingester contract markers. These are
    // load-bearing: kpi_sim.rs parses result.json by exactly these shapes.
    expect(p).toContain('kpi-sim/snapshot.json');
    expect(p).toContain('CLASS 1');
    expect(p).toContain('CLASS 2');
    expect(p).toContain('CLASS 3');
    expect(p).toContain('result.json');
    expect(p).toContain('"measurements"');
    expect(p).toContain('"proposals"');
    expect(p).toContain('"findings"');
    expect(p).toContain('adopt_measure_config');
    expect(p).toContain('adjust_target');
    expect(p).toContain('NEVER invent a number');
    // Env guardrail: sims never claim production.
    expect(p).toMatch(/"local"\|"test"/);
  });

  it('gates L2 behind the mode flag', () => {
    expect(buildKpiSimPrompt(project, 'l1')).toContain('L2 (live) is DISABLED');
    const l2 = buildKpiSimPrompt(project, 'l1l2');
    expect(l2).toContain('L2 (LIVE simulation) IS ENABLED');
    expect(l2).toContain('Playwright');
  });

  it('is skill-aware, not skill-dependent', () => {
    const p = buildKpiSimPrompt(project, 'l1');
    expect(p).toContain('.claude/skills/');
    expect(p).toContain('uat/');
    expect(p).toContain('do NOT install anything');
  });
});
