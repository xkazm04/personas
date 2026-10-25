// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import { rawSteps, runsOf, sessionById, stationKinds, waitBins } from './detail';

const reading = {
  kinds: ['read', 'edit', 'interrupt', 'wait', 'verify'],
  phases: { read: 'explore', edit: 'edit', interrupt: 'interrupt', wait: 'wait', verify: 'verify' },
  source: { scanned: 2, parsed: 2, cached: 2 },
  sessions: [
    { id: 'a', project: 'p', wt: 0, mode: 'interactive', model: null, effort: null, start: '2026-10-01T10:00:00Z', dur: 0, active: 0,
      prompts: 1, interrupts: 1, compactions: 0, errors: 1, commits: 0, skills: [],
      steps: [[0, 2, 0, 0, 10], [1, 3, 1, 10, 20], [2, 1, 0, 2000, 0], [1, 1, 0, 2000, 5]] },
    { id: 'b', project: 'p', wt: 0, mode: 'interactive', model: null, effort: null, start: '2026-10-02T10:00:00Z', dur: 0, active: 0,
      prompts: 1, interrupts: 0, compactions: 0, errors: 0, commits: 1, skills: [],
      steps: [[1, 4, 0, 0, 8], [4, 1, 0, 8, 2]] },
  ],
} as unknown as CuratorProcess; // a hand-built fixture: only the fields detail.ts reads

describe('survey sheet detail', () => {
  it('counts raw kinds inside a station once per session', () => {
    const rows = stationKinds(reading, ['a', 'b'], ['edit']);
    expect(rows).toEqual([{ kind: 'edit', steps: 8, sessions: 2, errors: 1, errSessions: 1, time: 33 }]);
  });

  it('puts steps on the active clock, capping idle gaps at ten minutes', () => {
    const steps = rawSteps(reading, sessionById(reading, 'a')!);
    expect(steps.map((s) => s.t)).toEqual([0, 10, 630, 630]);
  });

  it('folds runs and bins waits', () => {
    expect(runsOf(rawSteps(reading, sessionById(reading, 'a')!)).map((r) => r.kind)).toEqual(['read', 'edit', 'interrupt', 'edit']);
    expect(waitBins([1, 3, 3, 70, 1000])).toEqual([1, 2, 0, 0, 1, 0, 1]);
  });
});
