// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { computeWinnerScore } from '../arenaWinnerScore';

function row(modelId: string, ta: number | null, oq: number | null, pc: number | null): LabArenaResult {
  return {
    modelId,
    toolAccuracyScore: ta,
    outputQualityScore: oq,
    protocolCompliance: pc,
  } as LabArenaResult; // test fixture: only the score fields are read
}

describe('computeWinnerScore - an unscored metric is not a worst-on-scale 0', () => {
  it('regression: a sandbox run that never scored tool accuracy keeps it null', () => {
    const s = computeWinnerScore([row('haiku', null, 80, 90), row('haiku', null, 70, 90)]);
    expect(s).not.toBeNull();
    expect(s!.ta).toBeNull();
    expect(s!.oq).toBe(75);
    expect(s!.pc).toBe(90);
  });

  it('a genuine 0 stays 0', () => {
    const s = computeWinnerScore([row('haiku', 0, 50, 50)]);
    expect(s!.ta).toBe(0);
  });

  it('picks the model with the best composite', () => {
    const s = computeWinnerScore([row('haiku', 10, 10, 10), row('sonnet', 90, 90, 90)]);
    expect(s!.comp).toBeGreaterThan(50);
    expect(s!.ta).toBe(90);
  });

  it('returns null when nothing was scored', () => {
    expect(computeWinnerScore([row('haiku', null, null, null)])).toBeNull();
    expect(computeWinnerScore([])).toBeNull();
  });
});
