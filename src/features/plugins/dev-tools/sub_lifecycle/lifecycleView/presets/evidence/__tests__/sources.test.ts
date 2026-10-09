import { describe, expect, it } from 'vitest';

import { commitHistory, landHistory, snapshotOver } from '../../../../journey/__tests__/evidenceFixtures';
import { evidenceRowsFor } from '../../../blocks/evidenceRows';
import { stepEvidenceRows, wholeChange } from '../evidenceModel';
import { sourceBreakdown, sourceContrast } from '../sources';

describe('sourceBreakdown', () => {
  it('splits Land by source: commits skip it, tasks and pull requests keep it', () => {
    const slices = sourceBreakdown(evidenceRowsFor('land', landHistory()), 5);
    expect(slices.map((s) => s.kind)).toEqual(['task', 'commit', 'pr']);
    const by = Object.fromEntries(slices.map((s) => [s.kind, s]));
    expect(by.pr).toMatchObject({ ratePct: 100, judged: true });
    expect(by.commit!.ratePct!).toBeLessThan(30);
    expect(by.task!.ratePct!).toBeGreaterThan(60);
    expect(slices.reduce((n, s) => n + s.total, 0)).toBe(60);
    const c = sourceContrast(slices)!;
    expect(c.low.kind).toBe('commit');
    expect(c.high.kind).toBe('pr');
  });

  it('names no contrast when the sources agree, or fewer than two can be judged', () => {
    expect(sourceContrast(sourceBreakdown(evidenceRowsFor('commit', commitHistory()), 5))).toBeNull();
    expect(sourceContrast(sourceBreakdown(evidenceRowsFor('land', landHistory(6)), 5))).toBeNull();
  });
});

describe('stepEvidenceRows', () => {
  it('joins the detail with the snapshot window once per change, newest first', () => {
    const detail = landHistory();
    const snap = snapshotOver(detail);
    const rows = stepEvidenceRows('land', detail, snap.evidence);
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((r) => r.key)).size).toBe(60);
    expect(rows[0]!.item.occurredAt > rows[59]!.item.occurredAt).toBe(true);
    // Before the detail answers, the snapshot's window is on screen.
    expect(stepEvidenceRows('land', [], snap.evidence)).toHaveLength(20);
    // A change the snapshot holds carries every step's outcome; an older one is only this step's.
    expect(wholeChange(rows[0]!, snap.evidence)!.outcomes.map((o) => o.stepId)).toEqual(['isolate', 'gate', 'land', 'record']);
    expect(wholeChange(rows[40]!, snap.evidence)).toBeNull();
  });
});
