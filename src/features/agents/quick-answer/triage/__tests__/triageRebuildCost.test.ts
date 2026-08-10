/**
 * What an untouched deck costs every thirty seconds.
 *
 * The queue is rebuilt, re-sorted and re-serialised on every poll, whether or
 * not anything changed. `triageQueue.test.ts` pins what the ORDER is; this file
 * pins what producing it is allowed to cost, and that the cheap version produces
 * the identical order.
 *
 * Three costs, three `describe`s:
 *  • the comparator dereferenced the skip ledger twice and re-tested the focus
 *    pin on every one of the O(n log n) pairs, and collated two ISO timestamps
 *    through ICU while it was there. The pin has since gone entirely — a jump
 *    moves a CURSOR, not a row — so what used to be the pin's tests now guard
 *    that the reviewer's position cannot touch the order at all;
 *  • `adoptReach` re-parsed the same applicability JSON once per member project;
 *  • the session record was serialised three times on mount, writing back byte
 *    for byte what had just been read out of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectQueue, withSkip, type SkipLedger } from '../triageQueue';
import { adoptReach, applicabilityMatches } from '../triageReach';
import {
  clearTriageSession,
  loadTriageSession,
  resetTriageSessionCache,
  saveTriageSession,
} from '../triageSession';
import { compareOrder, compareTriage, TRIAGE_KINDS, type TriageItem } from '../triageTypes';
import { ALL_KINDS, makeItem } from './triageFixtures';

const NO_SKIPS: SkipLedger = new Map();

/* -------------------------------------------------------------------------- */

describe('the sort is precomputed and still the same order', () => {
  /** The old comparator, verbatim — the order this refactor must reproduce. */
  function legacyOrder(
    all: TriageItem[],
    skips: SkipLedger,
    focused?: string | null,
  ): string[] {
    return [...all]
      .sort((a, b) => {
        if (focused) {
          if (a.id === focused) return -1;
          if (b.id === focused) return 1;
        }
        return (
          (skips.get(a.id) ?? 0) - (skips.get(b.id) ?? 0) ||
          b.weight - a.weight ||
          a.createdAt.localeCompare(b.createdAt)
        );
      })
      .map((i) => i.id);
  }

  const spread = () =>
    Array.from({ length: 40 }, (_, i) =>
      makeItem(TRIAGE_KINDS[i % TRIAGE_KINDS.length]!, {
        sourceId: `s-${i}`,
        // Deliberate ties in both fields — a tie is where an unstable
        // comparator or a bad partition actually shows up.
        weight: [10, 50, 50, 90][i % 4]!,
        createdAt: `2026-01-${String((i % 9) + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );

  it('matches the old comparator exactly, ties and all', () => {
    const all = spread();
    let skips: SkipLedger = NO_SKIPS;
    skips = withSkip(skips, all[3]!.id);
    skips = withSkip(skips, all[11]!.id);
    skips = withSkip(withSkip(skips, all[20]!.id), all[20]!.id);

    // The stood-down card leaves the deck, so compare against the same live set.
    const live = all.filter((i) => (skips.get(i.id) ?? 0) < 2);
    const { items } = projectQueue({
      all,
      resolved: new Set(),
      skips,
      activeKinds: ALL_KINDS,
    });

    expect(items.map((i) => i.id)).toEqual(legacyOrder(live, skips));
  });

  it('a jump moves the CURSOR and not the row — the queue does not renumber', () => {
    // This replaced a pin. Clicking row 28 used to lift that item out of the
    // order and unshift it to position 1, so the list the reviewer was reading
    // renumbered itself around their own click, and the deck then carried on
    // from the front rather than from where they had gone.
    const all = spread();
    const skips = withSkip(NO_SKIPS, all[5]!.id);
    const input = { all, resolved: new Set<string>(), skips, activeKinds: ALL_KINDS };

    const plain = projectQueue(input);
    const target = plain.items[27]!.id;
    const jumped = projectQueue({ ...input, cursorId: target });

    // Byte-for-byte the same order, and the same order the old comparator gave
    // when nothing was focused.
    expect(jumped.items.map((i) => i.id)).toEqual(plain.items.map((i) => i.id));
    expect(jumped.items.map((i) => i.id)).toEqual(legacyOrder(all, skips));
    // The position is the only thing that changed.
    expect(plain.cursor).toBe(0);
    expect(jumped.cursor).toBe(27);
    expect(jumped.items[jumped.cursor]!.id).toBe(target);
  });

  it('an unresolvable cursor falls back to the front — decided, filtered, or off the end', () => {
    const all = spread();
    const input = { all, resolved: new Set<string>(), skips: NO_SKIPS, activeKinds: ALL_KINDS };

    // The card the cursor named has been decided since it was set.
    const gone = projectQueue({ ...input, cursorId: 'no-such-item' });
    expect(gone.cursor).toBe(0);
    // ...and so has "no cursor at all", which is where a session starts.
    expect(projectQueue({ ...input, cursorId: null }).cursor).toBe(0);
    expect(projectQueue(input).cursor).toBe(0);
  });

  it('stays a consistent TOTAL ORDER whatever the sources hand over', () => {
    // No adjacent pair in the dealt sequence may be faultable by the ordering
    // itself. Shuffle-proof in a way "same input, same output" is not — this
    // fixture has genuine ties in both fields, and tied elements keep their
    // input order under a stable sort.
    const all = spread();
    const skips = withSkip(NO_SKIPS, all[2]!.id);
    const project = (input: TriageItem[]) =>
      projectQueue({
        all: input,
        resolved: new Set(),
        skips,
        activeKinds: ALL_KINDS,
        // A cursor must be inert to the ORDER — passing one here is the point.
        cursorId: all[9]!.id,
      }).items;

    const rank = (i: TriageItem) => skips.get(i.id) ?? 0;

    for (let seed = 0; seed < 8; seed += 1) {
      const shuffled = [...all].sort((a, b) => ((a.weight * seed + b.weight) % 7) - 3);
      const items = project(shuffled);

      expect(items).toHaveLength(all.length);
      expect(items.filter((i) => i.id === all[9]!.id)).toHaveLength(1);

      for (let i = 1; i < items.length; i += 1) {
        const a = items[i - 1]!;
        const b = items[i]!;
        const cmp =
          rank(a) - rank(b) || compareOrder(a.weight, a.createdAt, b.weight, b.createdAt);
        expect(cmp).toBeLessThanOrEqual(0);
      }
    }
  });

  it('collates timestamps without ICU, and identically', () => {
    // RFC3339 is fixed-width ASCII, so codepoint order IS collation order —
    // which is what lets the hot comparator drop two `localeCompare` calls per
    // comparison.
    const stamps = [
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.001Z',
      '2026-01-02T00:00:00.000Z',
      '2026-11-30T23:59:59.999Z',
      '2027-01-01T00:00:00.000Z',
    ];
    for (const a of stamps) {
      for (const b of stamps) {
        expect(Math.sign(compareOrder(1, a, 1, b))).toBe(Math.sign(a.localeCompare(b)));
      }
    }
  });

  it('keeps `compareTriage` as the one ordering law', () => {
    const a = makeItem('idea', { weight: 50, createdAt: '2026-01-01T00:00:00.000Z' });
    const b = makeItem('idea', { weight: 50, createdAt: '2026-01-02T00:00:00.000Z' });
    expect(compareTriage(a, b)).toBe(
      compareOrder(a.weight, a.createdAt, b.weight, b.createdAt),
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('applicability is parsed once per practice, not once per member', () => {
  const applicability = JSON.stringify({
    languages: ['TypeScript'],
    frameworks: ['React'],
    layers: ['ui'],
    conditions: ['always'],
  });
  const stacks = Array.from({ length: 12 }, (_, i) =>
    i % 3 === 0 ? 'React + TypeScript + Tauri' : 'Go + Postgres',
  );

  it('parses the blob exactly once for a whole workspace', () => {
    const parse = vi.spyOn(JSON, 'parse');
    try {
      adoptReach(applicability, stacks);
      // Was one parse PER MEMBER — P practices × M members per rebuild, and the
      // deck rebuilds its queue on every 30-second poll.
      expect(parse).toHaveBeenCalledTimes(1);
    } finally {
      parse.mockRestore();
    }
  });

  it('gives the same answer it always did', () => {
    expect(adoptReach(applicability, stacks)).toEqual({ members: 12, applicable: 4 });
    // And the single-project door is unchanged for its own callers.
    expect(applicabilityMatches(applicability, 'React + TypeScript')).toBe(true);
    expect(applicabilityMatches(applicability, 'Go + Postgres')).toBe(false);
    expect(applicabilityMatches(null, 'anything')).toBe(true);
    expect(applicabilityMatches('{not json', 'anything')).toBe(true);
  });

  it('costs nothing extra for an unconstrained practice', () => {
    expect(adoptReach(null, stacks)).toEqual({ members: 12, applicable: 12 });
  });
});

/* -------------------------------------------------------------------------- */

describe('the session record is serialised once per change', () => {
  beforeEach(() => {
    clearTriageSession();
    resetTriageSessionCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTriageSession();
    resetTriageSessionCache();
  });

  it('takes the caller’s `startedAt` rather than the moment of the write', () => {
    // The stamp used to come from whichever write landed first, which was only
    // ever right because three effects fired on mount. Coalescing them moved the
    // first write to the first DECISION — and a session that begins after the
    // verdict it is meant to contain reports an empty sitting.
    const began = Date.now() - 60_000;
    saveTriageSession({ resolved: new Set(['idea:1']), startedAt: began });
    expect(loadTriageSession().startedAt).toBe(began);
  });

  it('merges the three halves in ONE `setItem` instead of three', () => {
    const seen: string[] = [];
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    spy.mockImplementation((key: string) => {
      seen.push(key);
    });

    saveTriageSession({
      skips: new Map([['idea:1', 1]]),
      kinds: new Set(['idea' as const]),
      resolved: new Set(['idea:2']),
      startedAt: 1_700_000_000_000,
    });

    // Each write is a read-modify-write that re-serialises the WHOLE record,
    // drafts included (up to MAX_DRAFTS × MAX_DRAFT_CHARS).
    expect(seen).toHaveLength(1);
  });

  it('still leaves the drafts half alone — the merge is what makes one write safe', () => {
    saveTriageSession({ drafts: { 'sess-1::tools': 'ripgrep' }, startedAt: 1 });
    saveTriageSession({
      skips: new Map([['idea:1', 2]]),
      kinds: new Set(['idea' as const]),
      resolved: new Set(['idea:2']),
      startedAt: 1,
    });

    const session = loadTriageSession();
    expect(session.drafts['sess-1::tools']).toBe('ripgrep');
    expect(session.skips.get('idea:1')).toBe(2);
    expect([...session.resolved]).toEqual(['idea:2']);
  });
});
