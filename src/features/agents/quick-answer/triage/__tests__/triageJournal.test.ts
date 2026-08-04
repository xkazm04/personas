/**
 * The decision journal, and the one thing it must not do: flatter the reviewer.
 *
 * A throughput readout is only worth showing if it is honest about what did NOT
 * count. Three acts look like decisions and are not:
 *
 *  • a deferral wrote nothing;
 *  • an undone verdict was taken back;
 *  • a verdict that lost a compare-and-swap recorded nothing at all.
 *
 * All three stay VISIBLE as their own counts — an undone decision is amended
 * rather than deleted — and none of them lands in `decided`.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  clearJournal,
  markUndone,
  MAX_JOURNAL_ENTRIES,
  readJournal,
  recordDecision,
  resetJournalCache,
  summariseJournal,
} from '../triageJournal';
import { makeItem } from './triageFixtures';
import type { TriageKind } from '../triageTypes';

function record(kind: TriageKind, verdict: 'accept' | 'reject' | 'skip', extra = {}) {
  return recordDecision({
    item: makeItem(kind, {
      source: { label: 'Core' },
      tags: [{ id: 'k', label: kind === 'practice' ? 'pitfall' : 'technical', tone: 'accent' }],
    }),
    verdict,
    ...extra,
  });
}

beforeEach(() => {
  localStorage.clear();
  clearJournal();
  resetJournalCache();
});

describe('triageJournal — what one act records', () => {
  it('keeps the grouping axis a future round would need', () => {
    // "You reject 80% of pitfall practices from workspace X" needs the chips and
    // the origin; the card already resolved both, so the journal stores them
    // rather than teaching itself six domain models.
    const entry = record('practice', 'reject', { reason: 'Out of scope', dwellMs: 4200 });
    expect(entry.tags).toEqual(['pitfall']);
    expect(entry.source).toBe('Core');
    expect(entry.reason).toBe('Out of scope');
    expect(entry.dwellMs).toBe(4200);
    // Matches `record_idea_decision_by`'s taxonomy, so a merged view never has
    // to guess which loop decided a row.
    expect(entry.actor).toBe('Human');
  });

  it('survives a reload of the module cache', () => {
    record('idea', 'accept');
    resetJournalCache();
    expect(readJournal()).toHaveLength(1);
  });

  it('bounds the ring rather than growing forever', () => {
    for (let i = 0; i < MAX_JOURNAL_ENTRIES + 25; i += 1) record('idea', 'accept');
    expect(readJournal()).toHaveLength(MAX_JOURNAL_ENTRIES);
  });
});

describe('triageJournal — the session summary', () => {
  it('counts verdicts, splits accept from reject, and keeps deferrals separate', () => {
    record('idea', 'accept');
    record('idea', 'accept');
    record('idea', 'reject');
    record('practice', 'skip');

    const summary = summariseJournal(readJournal(), 0);
    expect(summary.decided).toBe(3);
    expect(summary.accepted).toBe(2);
    expect(summary.rejected).toBe(1);
    // A skip is not throughput. It IS work, so it is reported — just not here.
    expect(summary.skipped).toBe(1);
  });

  it('AMENDS an undone verdict rather than deleting it, and drops it from throughput', () => {
    const kept = record('idea', 'accept');
    const taken = record('idea', 'reject');
    markUndone(taken.itemId);

    const summary = summariseJournal(readJournal(), 0);
    expect(summary.decided).toBe(1);
    expect(summary.undone).toBe(1);
    // The entry is still there: "decided then undone" and "never decided" are
    // different things.
    expect(readJournal()).toHaveLength(2);
    expect(readJournal().find((e) => e.itemId === kept.itemId)?.undone).toBeUndefined();
  });

  it('marks only the MOST RECENT entry for an item', () => {
    const item = makeItem('idea', { sourceId: 'idea-7' });
    recordDecision({ item, verdict: 'skip' });
    recordDecision({ item, verdict: 'accept' });
    markUndone(item.id);

    const entries = readJournal();
    expect(entries[0]?.undone).toBeUndefined();
    expect(entries[1]?.undone).toBe(true);
  });

  it('does not count a verdict that LOST the swap as throughput', () => {
    record('idea', 'accept');
    record('idea', 'accept', { conflicted: true });

    const summary = summariseJournal(readJournal(), 0);
    expect(summary.decided).toBe(1);
    // Reported, because it is effort the reviewer spent and did not get.
    expect(summary.conflicts).toBe(1);
  });

  it('reports the MEDIAN dwell, so one long read cannot swamp the pace', () => {
    record('idea', 'accept', { dwellMs: 1000 });
    record('idea', 'accept', { dwellMs: 2000 });
    record('idea', 'accept', { dwellMs: 600_000 });
    expect(summariseJournal(readJournal(), 0).medianDwellMs).toBe(2000);
  });

  it('tallies per kind, heaviest first', () => {
    record('practice', 'accept');
    record('idea', 'accept');
    record('idea', 'reject');
    record('idea', 'accept');

    const byKind = summariseJournal(readJournal(), 0).byKind;
    expect(byKind[0]).toEqual({ kind: 'idea', decided: 3, accepted: 2 });
    expect(byKind[1]).toEqual({ kind: 'practice', decided: 1, accepted: 1 });
  });

  it('scopes to the session window — the ring outlives the sitting', () => {
    record('idea', 'accept');
    const boundary = Date.now() + 1;
    expect(summariseJournal(readJournal(), boundary).decided).toBe(0);
    expect(summariseJournal(readJournal(), 0).decided).toBe(1);
  });

  it('describes an empty session without inventing a pace', () => {
    const summary = summariseJournal([], 0);
    expect(summary.decided).toBe(0);
    expect(summary.medianDwellMs).toBeNull();
    expect(summary.byKind).toEqual([]);
  });
});
