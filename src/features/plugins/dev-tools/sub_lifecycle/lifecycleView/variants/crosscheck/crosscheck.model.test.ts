import { describe, expect, it } from 'vitest';

import { buildLanes } from '../../../journey/journeyModel';
import { evidenceItem, soloV0, stepView } from '../../../journey/__tests__/fixtures';
import { crosscheckMatrix } from './crosscheck.model';

function order(snap = soloV0()) {
  const lanes = buildLanes(snap);
  return [...lanes.before, ...lanes.after];
}

describe('crosscheckMatrix', () => {
  it('puts the oldest change in the first column, matching the dot convention', () => {
    const snap = soloV0({
      evidence: [
        evidenceItem('new', '2026-09-26T10:00:00Z', [['gate', 'done']]),
        evidenceItem('old', '2026-09-25T10:00:00Z', [['gate', 'skipped']]),
      ],
    });
    const m = crosscheckMatrix(order(snap), snap.evidence);
    expect(m.columns.map((c) => c.item.sourceRef)).toEqual(['old', 'new']);
    const gate = m.rows.find((r) => r.node.id === 'gate');
    expect(gate?.cells).toEqual(['skipped', 'done']);
  });

  it('reads a change that recorded nothing for a step as unknown, not as a skip', () => {
    const snap = soloV0({ evidence: [evidenceItem('c1', '2026-09-25T10:00:00Z', [['gate', 'done']])] });
    const m = crosscheckMatrix(order(snap), snap.evidence);
    const docs = m.rows.find((r) => r.node.id === 'docs');
    expect(docs?.cells).toEqual(['unknown']);
    expect(docs?.observed).toBe(0);
    expect(docs?.kept).toBe(0);
  });

  it('counts observed over done, skipped and failed only', () => {
    const snap = soloV0({
      steps: [stepView('gate', 'after', [['hook', 'live']])],
      evidence: [
        evidenceItem('a', '2026-09-21T10:00:00Z', [['gate', 'done']]),
        evidenceItem('b', '2026-09-22T10:00:00Z', [['gate', 'skipped']]),
        evidenceItem('c', '2026-09-23T10:00:00Z', [['gate', 'failed']]),
        evidenceItem('d', '2026-09-24T10:00:00Z', []),
      ],
    });
    const m = crosscheckMatrix(order(snap), snap.evidence);
    expect(m.rows[0]?.observed).toBe(3);
    expect(m.rows[0]?.kept).toBe(1);
    expect(m.rows[0]?.cells).toHaveLength(4);
  });

  it('splits the lanes and keeps journey order across both', () => {
    const snap = soloV0();
    const m = crosscheckMatrix(order(snap), snap.evidence);
    expect(m.before.map((r) => r.node.id)).toEqual(['frame', 'recall', 'isolate', 'sync']);
    expect(m.after).toHaveLength(6);
    expect(m.rows).toHaveLength(10);
    expect(m.columns).toHaveLength(0);
  });
});
