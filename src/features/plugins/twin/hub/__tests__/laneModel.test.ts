/**
 * The lane partition, which is the whole claim the consolidation rests on:
 * the Desk won and nothing it could not reach went with the three deleted
 * prototypes, because every entry the feed carries lands in exactly one lane.
 *
 * 1. History EXCLUDES pending. A row in both Queue and History could be given
 *    a verdict twice, from two places, with the second overwriting the first.
 * 2. Knowledge holds facts AND reflections, and nothing else.
 * 3. The three entry lanes PARTITION the feed: every entry is in exactly one.
 * 4. A verdict filter is a claim about reviewed rows, so a message (which
 *    carries no verdict) drops out of it rather than pretending to satisfy it.
 * 5. The lane badges are composed from `HubCounts`, never recounted, so a badge
 *    cannot disagree with the number the shell shows for the same fact.
 */

import { describe, it, expect } from 'vitest';
import type { HubCounts, HubEntry, HubEntryKind, HubReviewStatus } from '../hubContract';
import {
  HUB_LANES, historyEntries, knowledgeEntries, laneCount, queueEntries,
} from '../desk/laneModel';

let seq = 0;
function entry(kind: HubEntryKind, status: HubReviewStatus | null = null): HubEntry {
  seq += 1;
  const id = `e${seq}`;
  // The source row is never read by the derivations; only `kind` and `status`
  // decide the lane, so the narrowest shape that type-checks is the honest one.
  const row = { id } as unknown as Extract<HubEntry['source'], { kind: 'memory' }>['row'];
  return {
    id, kind, at: new Date(2026, 0, seq).toISOString(), channel: null, title: null,
    body: `body ${id}`, status, reviewerNotes: null, contactHandle: null, importance: null,
    source: { kind: 'memory', row },
  };
}

const FEED: HubEntry[] = [
  entry('memory', 'pending'),
  entry('memory', 'approved'),
  entry('memory', 'rejected'),
  entry('audit', 'pending'),
  entry('audit', 'approved'),
  entry('message'),
  entry('message'),
  entry('fact'),
  entry('reflection'),
];

describe('hub lane derivation', () => {
  it('queue is the pending reviewables only', () => {
    expect(queueEntries(FEED).map((e) => e.kind)).toEqual(['memory', 'audit']);
    expect(queueEntries(FEED).every((e) => e.status === 'pending')).toBe(true);
  });

  it('history excludes pending, and holds the filed memories plus the messages', () => {
    const history = historyEntries(FEED, 'all');
    expect(history.some((e) => e.status === 'pending')).toBe(false);
    expect(history.map((e) => e.kind)).toEqual(['memory', 'memory', 'audit', 'message', 'message']);
  });

  it('a verdict filter drops the kinds that carry no verdict', () => {
    expect(historyEntries(FEED, 'approved').map((e) => e.status)).toEqual(['approved', 'approved']);
    expect(historyEntries(FEED, 'rejected').map((e) => e.status)).toEqual(['rejected']);
    expect(historyEntries(FEED, 'approved').some((e) => e.kind === 'message')).toBe(false);
  });

  it('knowledge holds facts and reflections, and nothing else', () => {
    expect(knowledgeEntries(FEED).map((e) => e.kind)).toEqual(['fact', 'reflection']);
  });

  it('the three entry lanes partition the feed — every entry in exactly one', () => {
    const ids = [
      ...queueEntries(FEED),
      ...historyEntries(FEED, 'all'),
      ...knowledgeEntries(FEED),
    ].map((e) => e.id);
    expect(ids).toHaveLength(FEED.length);
    expect(new Set(ids).size).toBe(FEED.length);
  });

  it('lane badges are composed from the counts, and Replies claims no number', () => {
    const counts: HubCounts = {
      pending: 2, approved: 3, rejected: 1, messages: 7, facts: 5, reflections: 4,
    };
    expect(laneCount('queue', counts)).toBe(2);
    expect(laneCount('history', counts)).toBe(3 + 1 + 7);
    expect(laneCount('knowledge', counts)).toBe(5 + 4);
    expect(laneCount('replies', counts)).toBeNull();
  });

  it('every lane in the control resolves a badge decision', () => {
    const counts: HubCounts = {
      pending: 0, approved: 0, rejected: 0, messages: 0, facts: 0, reflections: 0,
    };
    for (const lane of HUB_LANES) {
      const value = laneCount(lane, counts);
      expect(value === null || typeof value === 'number').toBe(true);
    }
  });
});
