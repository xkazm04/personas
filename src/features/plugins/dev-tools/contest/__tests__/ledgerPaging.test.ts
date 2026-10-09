import { describe, expect, it } from 'vitest';

import { ledgerGroups } from '../ledger/ledgerModel';
import { cascadeOrder, countLedgerRows, LEDGER_PAGE_SIZE, windowLedger } from '../ledger/ledgerPaging';
import { summaryFixture } from './fixtures';

const text = () => '';

/** `n` contests with distinct ids, alternating the phase that groups them. */
function set(n: number) {
  return Array.from({ length: n }, (_, i) =>
    summaryFixture({
      contestId: `c${String(i).padStart(3, '0')}`,
      phase: i % 3 === 0 ? 'review' : i % 3 === 1 ? 'running' : 'decided',
      date: `2026-0${(i % 3) + 7}-1${i % 9}`,
      updatedAtMs: 1_758_700_000_000 - i * 1000,
    }),
  );
}

describe('ledger render window', () => {
  it('shows one page of 20 and reports the whole set behind it', () => {
    const groups = ledgerGroups(set(53), null, '', text);
    const w = windowLedger(groups, LEDGER_PAGE_SIZE);
    expect(LEDGER_PAGE_SIZE).toBe(20);
    expect(w.shown).toBe(20);
    expect(w.total).toBe(53);
    expect(w.hasMore).toBe(true);
  });

  it('keeps the whole-set order, so the window is a prefix and never a reshuffle', () => {
    const groups = ledgerGroups(set(53), null, '', text);
    const all = windowLedger(groups, 999);
    const page = windowLedger(groups, 20);
    const ids = (g: typeof all) => g.groups.flatMap((x) => x.families.flatMap((f) => f.items.map((i) => i.summary.contestId)));
    expect(ids(page)).toEqual(ids(all).slice(0, 20));
  });

  it('keeps every group header truthful about its whole-set counts', () => {
    const groups = ledgerGroups(set(53), null, '', text);
    const page = windowLedger(groups, 20);
    for (const g of page.groups) {
      const full = groups.find((x) => x.attention === g.attention)!;
      expect(g.own).toBe(full.own);
      expect(g.related).toBe(full.related);
      expect(g.monthCount).toBe(new Set(full.families.map((f) => f.date.slice(0, 7))).size);
    }
  });

  it('drops a group that got no rows rather than rendering an empty header', () => {
    const groups = ledgerGroups(set(53), null, '', text);
    expect(groups.length).toBeGreaterThan(1);
    expect(windowLedger(groups, 1).groups).toHaveLength(1);
  });

  it('settles at the whole set once the limit passes it', () => {
    const groups = ledgerGroups(set(7), null, '', text);
    const w = windowLedger(groups, 20);
    expect(w.shown).toBe(7);
    expect(w.total).toBe(7);
    expect(w.hasMore).toBe(false);
  });

  it('counts an empty set as nothing to show', () => {
    expect(countLedgerRows([])).toBe(0);
    const w = windowLedger([], 20);
    expect(w).toMatchObject({ shown: 0, total: 0, hasMore: false });
    expect(w.groups).toEqual([]);
  });

  it('runs every page’s entrance ramp from zero', () => {
    expect(cascadeOrder(0)).toBe(0);
    expect(cascadeOrder(19)).toBe(19);
    expect(cascadeOrder(20)).toBe(0);
    expect(cascadeOrder(41)).toBe(1);
  });
});
