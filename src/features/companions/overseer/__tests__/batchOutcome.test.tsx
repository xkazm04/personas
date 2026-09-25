/**
 * Run All must surface what the cycle did. Three report fields
 * (evaluatedPersonas / verdictsEmitted / skippedUnchangedPersonas) used to be
 * discarded, so a freshness-skipped no-op and a budget-spending coaching cycle
 * were indistinguishable.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { describeBatchOutcome, cappedSkippedNames } from '../batchOutcome';
import { BatchOutcomeLine } from '../components/BatchOutcomeLine';
import type { DirectorReport } from '@/api/director';

const report = (over: Partial<DirectorReport> = {}): DirectorReport => ({
  evaluatedPersonas: 0,
  verdictsEmitted: 0,
  personasSkippedNoExecutions: 0,
  personasSkippedUnchanged: 0,
  skippedUnchangedPersonas: [],
  generatedAt: '2026-09-17T00:00:00Z',
  ...over,
});

describe('describeBatchOutcome', () => {
  it('classifies a cycle that evaluated somebody as reviewed', () => {
    const o = describeBatchOutcome(
      report({ evaluatedPersonas: 3, verdictsEmitted: 2, personasSkippedUnchanged: 1, skippedUnchangedPersonas: ['Scribe'] }),
    );
    expect(o.kind).toBe('reviewed');
    expect(o.evaluated).toBe(3);
    expect(o.verdicts).toBe(2);
    expect(o.skippedUnchanged).toBe(1);
    expect(o.skippedUnchangedNames).toEqual(['Scribe']);
  });

  it('classifies an all-skipped cycle as nothing-to-review, not a success', () => {
    const o = describeBatchOutcome(
      report({ personasSkippedUnchanged: 2, skippedUnchangedPersonas: ['Scribe', 'Scout'] }),
    );
    expect(o.kind).toBe('nothing-to-review');
    expect(o.evaluated).toBe(0);
  });

  it('keeps the no-runs skip separate from the freshness skip', () => {
    const o = describeBatchOutcome(report({ personasSkippedNoExecutions: 4 }));
    expect(o.skippedNoRuns).toBe(4);
    expect(o.skippedUnchanged).toBe(0);
  });

  it('tolerates a missing name list', () => {
    const o = describeBatchOutcome({ ...report(), skippedUnchangedPersonas: undefined as unknown as string[] });
    expect(o.skippedUnchangedNames).toEqual([]);
  });
});

describe('cappedSkippedNames', () => {
  it('caps the list and counts the remainder', () => {
    expect(cappedSkippedNames(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 });
  });

  it('elides nothing when the list fits', () => {
    expect(cappedSkippedNames(['a'])).toEqual({ shown: ['a'], more: 0 });
  });
});

describe('BatchOutcomeLine', () => {
  it('renders evaluated, verdict and skipped counts plus the skipped names', () => {
    render(
      <BatchOutcomeLine
        outcome={describeBatchOutcome(
          report({ evaluatedPersonas: 3, verdictsEmitted: 2, personasSkippedUnchanged: 1, skippedUnchangedPersonas: ['Scribe'] }),
        )}
      />,
    );
    const line = screen.getByTestId('director-batch-outcome').textContent ?? '';
    expect(line).toContain('3');
    expect(line).toContain('2');
    expect(line).toContain('Scribe');
  });

  it('says nothing to review rather than a fake success when all were skipped', () => {
    render(
      <BatchOutcomeLine
        outcome={describeBatchOutcome(
          report({ personasSkippedUnchanged: 2, skippedUnchangedPersonas: ['Scribe', 'Scout'] }),
        )}
      />,
    );
    const line = screen.getByTestId('director-batch-outcome').textContent ?? '';
    expect(line).toContain('Nothing to review');
    expect(line).toContain('Scout');
  });
});
