import { describe, expect, it } from 'vitest';

import { ESLINT_ERROR, ESLINT_OUTPUT, flakyRuns, slowingRuns } from '../../../../journey/__tests__/gateFixtures';
import { chartModel, STUB } from '../chartModel';
import { firstErrorIndex, parseOutput, searchLines, stepMatch } from '../outputModel';

describe('run output', () => {
  it('splits the labelled sections and numbers each section from 1', () => {
    const p = parseOutput(ESLINT_OUTPUT);
    expect(p.counts).toEqual({ stdout: 4, stderr: 3 });
    expect(p.lines[0]).toEqual({ section: 'stdout', n: 1, text: '> lint' });
    expect(p.lines[4]).toEqual({ section: 'stderr', n: 1, text: ESLINT_ERROR });
  });

  it('reads an unlabelled text as stdout and an empty text as no lines', () => {
    expect(parseOutput('one\ntwo').counts).toEqual({ stdout: 2, stderr: 0 });
    expect(parseOutput('').lines).toHaveLength(0);
  });

  it('finds the first error by the run’s own first-error line, else the first error-like line', () => {
    const p = parseOutput(ESLINT_OUTPUT);
    expect(firstErrorIndex(p.lines, ESLINT_ERROR)).toBe(4);
    expect(p.lines[firstErrorIndex(p.lines, null)]!.text).toBe(ESLINT_ERROR);
    expect(firstErrorIndex(parseOutput('all good').lines, null)).toBe(-1);
  });

  it('searches case-insensitively and steps through matches, wrapping both ways', () => {
    const p = parseOutput(ESLINT_OUTPUT);
    const hits = searchLines(p.lines, 'LINT');
    expect(hits).toEqual([0, 1, 5]);
    expect(searchLines(p.lines, '   ')).toEqual([]);
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
});

describe('run chart geometry', () => {
  it('draws oldest first, tones answered bars by outcome and budget, and stubs a run with no honest time', () => {
    const m = chartModel(slowingRuns(), 60_000);
    expect(m.bars[m.bars.length - 1]!.run.id).toBe('r-tsc-0');
    expect(m.bars.map((b) => b.kind).slice(-3)).toEqual(['over', 'over', 'over']);
    expect(m.bars[0]!.kind).toBe('passed');
    expect(m.budgetAt).toBeGreaterThan(0);
    expect(m.band).not.toBeNull();
    const flaky = chartModel(flakyRuns(), null);
    expect(flaky.budgetAt).toBeNull();
    expect(flaky.bars.some((b) => b.kind === 'failed')).toBe(true);
  });

  it('draws a timeout and a non-run as fixed stubs, never as a speed', () => {
    const [timeout] = chartModel([{ ...slowingRuns()[0]!, outcome: 'timeout', durationMs: 1_200_000 }], 60_000).bars;
    expect(timeout!.kind).toBe('timeout');
    expect(timeout!.height).toBe(STUB);
  });
});
