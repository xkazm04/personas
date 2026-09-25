import { describe, expect, it } from 'vitest';

import {
  MAX_DOTS, buildLanes, installInFlight, missingBindings, skipRate, strongestState, weakest,
} from '../journeyModel';
import { evidenceItem, soloV0, stepView } from './fixtures';

describe('buildLanes', () => {
  it('splits steps into before and after lanes in document order', () => {
    const { before, after } = buildLanes(soloV0());
    expect(before.map((n) => n.id)).toEqual(['frame', 'recall', 'isolate', 'sync']);
    expect(after.map((n) => n.id)).toEqual(['gate', 'tests', 'docs', 'commit', 'land', 'record']);
  });

  it('draws a node by its strongest binding', () => {
    const snap = soloV0({
      steps: [stepView('gate', 'after', [['hook', 'missing'], ['ci', 'live']])],
    });
    expect(buildLanes(snap).after[0]!.strongestState).toBe('live');
  });

  it('orders dots newest last and caps them', () => {
    const evidence = Array.from({ length: 12 }, (_, i) =>
      // newest first, as the backend sends it
      evidenceItem(`c${i}`, `2026-09-${String(25 - i).padStart(2, '0')}T10:00:00Z`, [['gate', i === 0 ? 'failed' : 'done']]),
    );
    const gate = buildLanes(soloV0({ evidence })).after.find((n) => n.id === 'gate')!;
    expect(gate.dots).toHaveLength(MAX_DOTS);
    expect(gate.dots[MAX_DOTS - 1]!.sourceRef).toBe('c0');
    expect(gate.lastOutcomes[MAX_DOTS - 1]).toBe('failed');
    expect(gate.dots[0]!.sourceRef).toBe('c7');
  });

  it('reads a change with no outcome for the step as unknown, not skipped', () => {
    const evidence = [evidenceItem('c1', '2026-09-25T10:00:00Z', [['gate', 'done']])];
    const tests = buildLanes(soloV0({ evidence })).after.find((n) => n.id === 'tests')!;
    expect(tests.lastOutcomes).toEqual(['unknown']);
  });

  it('shows missing bindings as pending while the install task runs', () => {
    const snap = soloV0({
      installTaskId: 't1',
      installTaskStatus: 'running',
      steps: [stepView('gate', 'after', [['hook', 'missing']])],
    });
    expect(buildLanes(snap).after[0]!.strongestState).toBe('pending');
    expect(buildLanes({ ...snap, installTaskStatus: 'completed' }).after[0]!.strongestState).toBe('missing');
    expect(buildLanes({ ...snap, installTaskId: null }, true).after[0]!.strongestState).toBe('pending');
  });
});

describe('strongestState / installInFlight / skipRate', () => {
  it('ranks live > detected > pending > missing > advisory', () => {
    expect(strongestState(['advisory', 'missing'])).toBe('missing');
    expect(strongestState(['missing', 'pending'])).toBe('pending');
    expect(strongestState(['pending', 'detected'])).toBe('detected');
    expect(strongestState(['detected', 'live'])).toBe('live');
    expect(strongestState([])).toBe('advisory');
  });

  it('treats an unknown status of a dispatched install as in flight', () => {
    expect(installInFlight({ installTaskId: 't', installTaskStatus: null })).toBe(true);
    expect(installInFlight({ installTaskId: 't', installTaskStatus: 'failed' })).toBe(false);
    expect(installInFlight({ installTaskId: null, installTaskStatus: null })).toBe(false);
  });

  it('never counts unknown as a skip', () => {
    expect(skipRate({ done: 0, skipped: 0, unknown: 9, failed: 0 })).toBe(0);
    expect(skipRate({ done: 1, skipped: 1, unknown: 9, failed: 0 })).toBe(0.5);
  });
});

describe('weakest', () => {
  it('picks the lowest strength first, then the highest skip rate', () => {
    const snap = soloV0({
      evidence: Array.from({ length: 20 }, (_, i) => evidenceItem(`c${i}`, `2026-09-01T00:00:${String(i).padStart(2, '0')}Z`, [])),
      steps: [
        stepView('gate', 'after', [['hook', 'live']], { skipped: 18, done: 2 }),
        stepView('tests', 'after', [['advisory', 'advisory']], { skipped: 14, done: 6 }),
        stepView('docs', 'after', [['advisory', 'advisory']], { skipped: 2, done: 18 }),
      ],
    });
    const w = weakest(snap)!;
    expect(w.node.id).toBe('tests');
    expect(w.skipped).toBe(14);
    expect(w.total).toBe(20);
  });

  it('breaks full ties by journey order', () => {
    const w = weakest(soloV0())!;
    // tests and docs are both advisory with no evidence; tests comes first.
    expect(w.node.id).toBe('tests');
    expect(w.total).toBe(0);
  });

  it('is null when every step is live and followed', () => {
    const snap = soloV0({
      steps: [stepView('gate', 'after', [['hook', 'live']], { done: 3 }), stepView('land', 'after', [['app', 'live']])],
    });
    expect(weakest(snap)).toBeNull();
  });
});

describe('missingBindings', () => {
  it('lists every missing binding in journey order', () => {
    const snap = soloV0({
      steps: [
        stepView('recall', 'before', [['claude_md', 'missing']]),
        stepView('gate', 'after', [['hook', 'live'], ['ci', 'missing']]),
      ],
    });
    expect(missingBindings(snap)).toEqual([
      { stepId: 'recall', label: null, kind: 'claude_md' },
      { stepId: 'gate', label: null, kind: 'ci' },
    ]);
    expect(missingBindings(soloV0())).toEqual([]);
  });
});
