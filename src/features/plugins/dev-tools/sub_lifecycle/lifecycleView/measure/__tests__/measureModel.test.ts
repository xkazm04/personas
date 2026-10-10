import { describe, expect, it } from 'vitest';

import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { DEFAULT_RULES, healthyMix } from '../../../journey/__tests__/fixtures';
import {
  changedVerdicts, elapsedMs, finalCommands, isOver, measureChange, measureEta, measuringSteps, segmentTone, tally,
} from '../measureModel';
import { nextState, phaseOf } from '../measureSession';
import { ago, cmd, midMeasure, NOW, progress } from './progressFixtures';

describe('measure progress model', () => {
  it('tones each segment by where its command stands', () => {
    const p = midMeasure();
    expect(p.commands.map((c) => segmentTone(c, NOW))).toEqual(['success', 'error', 'running', 'pending', 'pending']);
    // A timeout is the warning tone; a run that never happened is neutral (an open segment), not an error.
    expect(segmentTone(cmd({ commandId: 'x', kind: 'check', state: 'done', outcome: 'timeout' }), NOW)).toBe('warning');
    expect(segmentTone(cmd({ commandId: 'x', kind: 'check', state: 'done', outcome: 'did_not_run' }), NOW)).toBe('neutral');
  });

  it('counts x of n', () => {
    expect(tally(midMeasure())).toEqual({ done: 2, total: 5 });
    expect(tally(null)).toEqual({ done: 0, total: 0 });
  });

  it('turns a running command over 1.5x its median to the warning tone, and never without a median', () => {
    const at = (s: number, medianMs: number | null) => cmd({ commandId: 'v', kind: 'test', state: 'running', startedAt: ago(s), medianMs });
    expect(elapsedMs(at(40, 60_000), NOW)).toBe(40_000);
    expect(isOver(at(89, 60_000), NOW)).toBe(false);
    expect(isOver(at(91, 60_000), NOW)).toBe(true);
    expect(segmentTone(at(91, 60_000), NOW)).toBe('over');
    expect(isOver(at(9_000, null), NOW)).toBe(false);
  });

  it('sums what is left from the medians and counts the commands with none', () => {
    // vitest: 60 - 40 = 20 s left; check: 90 s; coverage: no median.
    expect(measureEta(midMeasure(), NOW)).toEqual({ remainingMs: 110_000, unknown: 1, open: 3 });
    // Past its median a running command adds nothing (never a negative).
    const late = progress([cmd({ commandId: 'v', kind: 'test', state: 'running', startedAt: ago(200), medianMs: 60_000 })]);
    expect(measureEta(late, NOW)).toEqual({ remainingMs: 0, unknown: 0, open: 1 });
    // First run of everything: no estimate at all.
    const first = progress([cmd({ commandId: 'a', kind: 'lint', state: 'pending' }), cmd({ commandId: 'b', kind: 'test', state: 'pending' })]);
    expect(measureEta(first, NOW)).toEqual({ remainingMs: 0, unknown: 2, open: 2 });
  });

  it('knows which rail steps the Measure is measuring, with their own tally', () => {
    const steps = measuringSteps(midMeasure(), DEFAULT_RULES);
    expect(steps.get('gate')).toEqual({ done: 2, total: 3 });
    expect(steps.get('tests')).toEqual({ done: 0, total: 2 });
    // While the plan resolves, every command step is measuring with an unknown tally.
    expect([...measuringSteps(null, DEFAULT_RULES).keys()]).toEqual(['gate', 'tests']);
  });

  it('completes the last progress from the Measure history column, or as not run when cancelled', () => {
    const column = { measureId: 'm-live', runs: [{ commandId: 'vitest', kind: 'test', outcome: 'passed', durationMs: 58_000, valuePct: null }] } as unknown as LifecycleMeasureColumn;
    const out = finalCommands(midMeasure(), column, true);
    expect(out.map((c) => [c.commandId, c.state, c.outcome])).toEqual([
      ['tsc', 'done', 'passed'], ['eslint', 'done', 'failed'], ['vitest', 'done', 'passed'],
      ['check', 'done', 'did_not_run'], ['coverage', 'done', 'did_not_run'],
    ]);
    // Not cancelled and not in the column yet: left as it was seen.
    expect(finalCommands(midMeasure(), null, false)[2]!.state).toBe('running');
  });
});

describe('measure summary', () => {
  const ids = ['gate', 'tests'];
  const before = healthyMix();
  const recovered = () => {
    const after = healthyMix();
    after.health = after.health.map((h) => (h.stepId === 'gate'
      ? { ...h, health: 'green', metrics: [{ key: 'median_ms', value: 50_000, samples: 10 }, { key: 'pass_rate', value: 100, samples: 10 }] }
      : h.stepId === 'tests'
        ? { ...h, metrics: [{ key: 'coverage_pct', value: 65, samples: 2 }, { key: 'median_ms', value: 170_000, samples: 10 }, { key: 'pass_rate', value: 100, samples: 10 }] }
        : h));
    return after;
  };

  it('says the verdict that changed first, then the figures that moved, against the snapshot before', () => {
    const fragments = measureChange(before, recovered(), ids);
    expect(fragments.map((f) => f.kind)).toEqual(['verdict', 'coverage', 'pass']);
    expect(fragments[0]).toMatchObject({ kind: 'verdict', stepId: 'gate', from: 'amber', to: 'green', tone: 'good' });
    expect(changedVerdicts(before, recovered(), ids)).toEqual(new Set(['gate']));
  });

  it('says nothing moved when nothing did', () => {
    expect(measureChange(before, healthyMix(), ids)).toEqual([]);
    expect(changedVerdicts(before, healthyMix(), ids).size).toBe(0);
  });

  it('falls back to the backend earlier measure when the page opened mid-Measure', () => {
    // healthyMix carries gate's previous as green: Gate Healthy -> At risk.
    expect(measureChange(null, healthyMix(), ids)[0]).toMatchObject({ kind: 'verdict', stepId: 'gate', from: 'green', to: 'amber', tone: 'bad' });
  });
});

describe('measure session', () => {
  const idle = healthyMix();
  const IDLE = { active: false, measureId: null, before: null, progress: null, after: null, cancelAsked: false, dismissed: false };

  it('walks preparing -> running -> cancelling -> ended, keeping before, the last progress and after', () => {
    let s = nextState(IDLE, { ...idle, measuring: true, progress: null }, idle);
    expect(phaseOf(s)).toBe('preparing');
    expect(s.before).toBe(idle);
    s = nextState(s, { ...idle, measuring: true, progress: midMeasure() }, idle);
    expect(phaseOf(s)).toBe('running');
    s = nextState(s, { ...idle, measuring: true, progress: midMeasure({ cancelling: true }) }, idle);
    expect(phaseOf(s)).toBe('cancelling');
    const after = healthyMix();
    s = nextState(s, after, idle);
    expect(phaseOf(s)).toBe('ended');
    expect(s.after).toBe(after);
    expect(s.progress?.measureId).toBe('m-live');
    // A new Measure starts a new session.
    s = nextState(s, { ...after, measuring: true, progress: midMeasure({ measureId: 'm-next' }) }, after);
    expect(phaseOf(s)).toBe('running');
    expect(s.measureId).toBe('m-next');
    expect(s.after).toBeNull();
  });
});
