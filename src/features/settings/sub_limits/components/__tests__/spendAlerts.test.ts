/**
 * The ceiling used to be a quiet progress bar: `LimitsSettings` computed the
 * 80% and 100% crossings and only coloured a bar with them, so the operator
 * learned about a cap after the month closed. What this pins is the rule that
 * makes the alert bearable — exactly one durable alert per threshold per
 * calendar month, and none at all without a ceiling.
 */
import { describe, it, expect } from 'vitest';
import {
  decideSpendAlert,
  bandsRetiredBy,
  readSentBands,
  recordSentBand,
  SPEND_WARNING_RATIO,
} from '../spendAlerts';

const MONTH = '2026-09';

describe('decideSpendAlert', () => {
  it('warns once at the 80% shoulder', () => {
    expect(
      decideSpendAlert({ monthKey: MONTH, spend: 8, ceiling: 10, alreadySent: [] }),
    ).toBe('approaching');
    expect(SPEND_WARNING_RATIO).toBe(0.8);
  });

  it('escalates once at the ceiling', () => {
    expect(
      decideSpendAlert({
        monthKey: MONTH,
        spend: 10,
        ceiling: 10,
        alreadySent: ['approaching'],
      }),
    ).toBe('over');
  });

  it('stays quiet below the shoulder', () => {
    expect(
      decideSpendAlert({ monthKey: MONTH, spend: 5, ceiling: 10, alreadySent: [] }),
    ).toBeNull();
  });

  it('stays quiet with no ceiling set', () => {
    expect(
      decideSpendAlert({ monthKey: MONTH, spend: 500, ceiling: 0, alreadySent: [] }),
    ).toBeNull();
  });

  it('does not repeat a threshold already alerted this month', () => {
    // A third crossing in the same month — a re-fetch, a re-mount, more spend.
    expect(
      decideSpendAlert({ monthKey: MONTH, spend: 9, ceiling: 10, alreadySent: ['approaching'] }),
    ).toBeNull();
    expect(
      decideSpendAlert({
        monthKey: MONTH,
        spend: 14,
        ceiling: 10,
        alreadySent: ['approaching', 'over'],
      }),
    ).toBeNull();
  });

  it('emits only the over band when the shoulder is jumped', () => {
    expect(
      decideSpendAlert({ monthKey: MONTH, spend: 20, ceiling: 10, alreadySent: [] }),
    ).toBe('over');
    // …and records the shoulder as spent, so it cannot fire retroactively.
    expect(bandsRetiredBy('over')).toEqual(['approaching', 'over']);
  });
});

describe('the sent ledger', () => {
  // The ledger holds ONE month, so each case picks its own month key rather
  // than clearing storage: the sanctioned storage primitive buffers a pending
  // write, which a raw `localStorage.clear()` would not reach.
  it('remembers a band within the month and forgets it in the next', () => {
    const month = '2026-03';
    expect(readSentBands(month)).toEqual([]);
    recordSentBand(month, 'approaching');
    expect(readSentBands(month)).toEqual(['approaching']);
    // A new month starts clean — the ledger holds one month, so it cannot grow.
    expect(readSentBands('2026-04')).toEqual([]);
  });

  it('closes the loop: a crossing alerts once and then never again', () => {
    const month = '2026-05';
    const input = { monthKey: month, spend: 8.5, ceiling: 10 };
    const first = decideSpendAlert({ ...input, alreadySent: readSentBands(month) });
    expect(first).toBe('approaching');
    recordSentBand(month, first!);
    expect(decideSpendAlert({ ...input, alreadySent: readSentBands(month) })).toBeNull();
  });
});
