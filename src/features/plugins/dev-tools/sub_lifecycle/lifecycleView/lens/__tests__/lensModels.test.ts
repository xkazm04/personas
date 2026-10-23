import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { evidenceItem, healthyMix, soloV0 } from '../../../journey/__tests__/fixtures';
import { LENS_TRANSITIONS, lensDepth, lensReducer, type LensRoute } from '../model/lensRoute';
import { columnFoot, columnLede, columnTitle, countsSentence } from '../model/lensWords';
import { buildPortfolio, weakestStep } from '../model/portfolioModel';

// The Lens's pure half: the portfolio counted from snapshots (honesty rules:
// absence stays absent, unmeasured is never low), the route as a table, and
// the sentences the header says.

const dl = en.plugins.dev_lifecycle;
const tx = interpolate as (t: string, v: Record<string, string | number>) => string;
const NOW = Date.parse('2026-10-16T12:00:00Z');

function dev(id: string, name: string, github_url: string | null = null): DevProject {
  return { id, name, github_url } as DevProject;
}

function landAt(snap: LifecycleSnapshot, health: 'red' | 'green', reason: string | null = null): LifecycleSnapshot {
  return { ...snap, health: snap.health.map((h) => (h.stepId === 'land' ? { ...h, health, reason } : h)) };
}

describe('buildPortfolio', () => {
  it('ranks a measured failure in a changing project first, and the blind last', () => {
    const active = landAt(healthyMix({ evidence: [evidenceItem('c1', '2026-10-15T10:00:00Z', [])] }), 'red', 'done in 40%');
    const quiet = landAt(healthyMix({ evidence: Array.from({ length: 6 }, (_, i) => evidenceItem(`q${i}`, '2026-09-01T10:00:00Z', [])) }), 'green');
    const blind = { ...soloV0(), evidence: [] };
    const p = buildPortfolio(
      [dev('b', 'Blind'), dev('q', 'Quiet'), dev('a', 'Active')],
      new Map([['a', active], ['q', quiet], ['b', blind]]),
      NOW,
    );
    expect(p.projects.map((x) => [x.id, x.band])).toEqual([['a', 'act'], ['q', 'quiet'], ['b', 'blind']]);
    expect(p.projects[0]!.lastChangeDays).toBe(1);
    expect(p.projects[2]!.lastChangeAt).toBeNull();
    expect(p.faultStepId).toBe('land');
  });

  it('puts the worst project at the foot of each column, and counts each verdict', () => {
    const p = buildPortfolio(
      [dev('g', 'Green'), dev('r', 'Red')],
      new Map([['g', landAt(healthyMix(), 'green')], ['r', landAt(healthyMix(), 'red')]]),
      NOW,
    );
    const land = p.columns.find((c) => c.id === 'land')!;
    expect(land.rows.map((r) => r.project.id)).toEqual(['r', 'g']);
    expect(land.counts.red).toBe(1);
    expect(land.counts.green).toBe(1);
  });

  it('leaves a project with no snapshot out instead of guessing it, and tells same-named projects apart', () => {
    const p = buildPortfolio(
      [dev('p1', 'personas', 'https://github.com/xkazm04/personas'), dev('p2', 'personas'), dev('p3', 'Unread')],
      new Map([['p1', healthyMix()], ['p2', healthyMix()]]),
      NOW,
    );
    expect(p.projects.map((x) => x.id).sort()).toEqual(['p1', 'p2']);
    expect(p.projects.find((x) => x.id === 'p1')!.qualifier).toBe('xkazm04/personas');
    expect(p.projects.find((x) => x.id === 'p2')!.qualifier).toBe('p2');
  });

  it('counts no Measure when no project has one, and no fault when nothing fails', () => {
    const p = buildPortfolio([dev('s', 'Solo')], new Map([['s', soloV0()]]), NOW);
    expect(p.measured).toBe(0);
    expect(p.faultStepId).toBeNull();
  });

  it('never names an instructed step the weakest', () => {
    const p = buildPortfolio([dev('s', 'Solo')], new Map([['s', soloV0()]]), NOW);
    expect(weakestStep(p.projects[0]!.steps)?.health).not.toBe('instructed');
  });
});

describe('the words', () => {
  const p = buildPortfolio(
    [dev('r', 'Alpha'), dev('g', 'Beta')],
    new Map([['r', landAt(healthyMix(), 'red', 'done in 40% of recent changes.')], ['g', landAt(healthyMix(), 'green')]]),
    NOW,
  );
  const land = p.columns.find((c) => c.id === 'land')!;

  it('heads a failing step with its count and starts with the worst project', () => {
    expect(columnTitle(dl, land)).toEqual({ template: dl.lens_title_red_one, count: 1, health: 'red' });
    expect(columnFoot(dl, tx, land)).toEqual({ text: '1 failing', health: 'red' });
    expect(columnLede(dl, tx, land)).toMatch(/^Start with Alpha: done in 40% of recent changes\. 1 failing, 1 healthy\./);
  });

  it('says the verdict mix worst first, never a low score for the unmeasured', () => {
    const solo = buildPortfolio([dev('s', 'Solo')], new Map([['s', soloV0()]]), NOW);
    const gate = solo.columns.find((c) => c.id === 'gate')!;
    expect(countsSentence(dl, tx, gate)).toBe('1 not measured.');
    expect(columnLede(dl, tx, gate)).toContain(dl.lens_lede_not_low);
  });
});

describe('the route', () => {
  const portfolio: LensRoute = { plane: 'portfolio', stepId: 'docs' };

  it('opens a project on the lit step, and Esc lands on the portfolio on that step', () => {
    const project = lensReducer(portfolio, { type: 'openProject', projectId: 'p1' });
    expect(project).toEqual({ plane: 'project', projectId: 'p1', stepId: 'docs' });
    const moved = lensReducer(project, { type: 'select', stepId: 'gate' });
    expect(lensReducer(moved, { type: 'back' })).toEqual({ plane: 'portfolio', stepId: 'gate' });
  });

  it('opens a step across the portfolio as a leaf, and its rows open projects', () => {
    const across = lensReducer(portfolio, { type: 'openStepAcross', stepId: 'docs' });
    expect(across).toEqual({ plane: 'portfolioStep', stepId: 'docs' });
    expect(lensReducer(across, { type: 'openProject', projectId: 'p2' })).toEqual({ plane: 'project', projectId: 'p2', stepId: 'docs' });
    expect(lensReducer(across, { type: 'back' })).toEqual({ plane: 'portfolio', stepId: 'docs' });
  });

  it('ignores a move a plane does not list', () => {
    expect(lensReducer(portfolio, { type: 'back' })).toBe(portfolio);
    expect(LENS_TRANSITIONS.project.openStepAcross).toBeUndefined();
  });

  it('counts depth: portfolio 0, a leaf or a project 1, an open step 2', () => {
    expect(lensDepth(portfolio, false)).toBe(0);
    expect(lensDepth({ plane: 'portfolioStep', stepId: 'docs' }, false)).toBe(1);
    expect(lensDepth({ plane: 'project', projectId: 'p', stepId: null }, false)).toBe(1);
    expect(lensDepth({ plane: 'project', projectId: 'p', stepId: null }, true)).toBe(2);
  });
});
