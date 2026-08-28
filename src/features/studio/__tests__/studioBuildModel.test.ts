import { describe, expect, it } from 'vitest';
import { MOCK_PHASES, phaseProgress, tabDotClass } from '../studioBuildModel';
import type { TabDotState } from '../studioBuildModel';

// The Studio context shipped with zero tests. These pin the two properties the
// build plan's honesty rests on: the placeholder plan claims no completed work,
// and the progress rollup the plan button / tab picker render is derived from
// the phase list rather than from a parallel counter.
describe('MOCK_PHASES (the pre-plan placeholder)', () => {
  it('claims no completed or in-flight work', () => {
    // Regression guard: this list once shipped two `done` phases and one
    // `active`, so a brand-new project's plan button read "2/6" and the drawer
    // showed a finished Vision before anything had been built.
    expect(MOCK_PHASES.every((p) => p.status === 'pending')).toBe(true);
    expect(phaseProgress(MOCK_PHASES).done).toBe(0);
  });

  it('asserts nothing about what the user asked for', () => {
    // The notes used to describe one specific portfolio site, verbatim, for
    // every project regardless of its vision.
    expect(MOCK_PHASES.every((p) => p.note === null)).toBe(true);
  });

  it('has unique phase ids — they are React keys in the stepper', () => {
    expect(new Set(MOCK_PHASES.map((p) => p.id)).size).toBe(MOCK_PHASES.length);
  });
});

describe('phaseProgress', () => {
  it('reports 0/0 with no active phase for an empty plan', () => {
    expect(phaseProgress([])).toEqual({ done: 0, total: 0, active: undefined });
  });

  it('counts only `done` toward progress and surfaces the active phase', () => {
    const { done, total, active } = phaseProgress([
      { id: 'a', title: 'A', status: 'done', note: null },
      { id: 'b', title: 'B', status: 'active', note: 'in flight' },
      { id: 'c', title: 'C', status: 'pending', note: null },
    ]);
    expect({ done, total }).toEqual({ done: 1, total: 3 });
    expect(active?.id).toBe('b');
  });

  it('reports done === total only when every phase is done (the autonomous stop condition)', () => {
    const all = phaseProgress([
      { id: 'a', title: 'A', status: 'done', note: null },
      { id: 'b', title: 'B', status: 'done', note: null },
    ]);
    expect(all.done).toBe(all.total);
    expect(all.active).toBeUndefined();
  });
});

describe('tabDotClass (the tab strip is peripheral vision)', () => {
  const dot = (over: Partial<TabDotState> = {}): string =>
    tabDotClass({ question: null, autonomous: false, busy: false, phase: 'idle', ...over });

  it('never animates a steady state — including a whole autonomous run', () => {
    // Regression guard: the dot used to carry `animate-pulse` for the entire
    // `busy || autonomous` state, and an autonomous run is up to AUTO_MAX_TURNS
    // chained turns — many minutes of continuous motion in the one region
    // visible from every Studio screen.
    for (const steady of [
      dot({ autonomous: true }),
      dot({ busy: true }),
      dot({ autonomous: true, busy: true, phase: 'live' }),
      dot({ phase: 'live' }),
      dot({ phase: 'error' }),
      dot(),
    ]) {
      expect(steady).not.toContain('animate-');
    }
  });

  it('animates only the one actionable state — a build halted on a question', () => {
    expect(dot({ question: 'Which brand colour?' })).toContain('animate-pulse');
  });

  it('lets a pending question outrank the building hue, since it is what stopped it', () => {
    expect(dot({ question: 'pick one', autonomous: true, busy: true })).toBe(
      dot({ question: 'pick one' }),
    );
  });

  it('tells every steady state apart by hue alone — animation carries no state', () => {
    const steady = [
      dot({ autonomous: true }),
      dot({ phase: 'live' }),
      dot({ phase: 'error' }),
      dot(),
    ];
    expect(new Set(steady).size).toBe(steady.length);
  });
});
