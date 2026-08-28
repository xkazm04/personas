/**
 * Retention bound on the localStorage copy of memory-action rules.
 *
 * Each persisted record carries a 200-character excerpt of a memory's body.
 * Before this bound existed nothing ever dropped one, so an excerpt outlived
 * the memory it was taken from: delete the memory (or Delete-all the store)
 * and its body text stayed in `localStorage` forever, with nothing left in the
 * app able to show or clear it.
 *
 * These tests drive `pruneActions` directly and through the two doors that
 * apply it (`saveActions`, `loadActions`), because a retention rule that is
 * written but never wired is indistinguishable from no retention rule at all.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  ACTION_TTL_MS,
  MAX_PERSISTED_ACTIONS,
  loadActions,
  pruneActions,
  saveActions,
  type MemoryAction,
} from '../memoryActions';

const NOW = Date.parse('2026-08-28T12:00:00.000Z');
const STORAGE_KEY = 'dolla:memory-actions';

function action(overrides: Partial<MemoryAction> & { id: string; createdAt: string }): MemoryAction {
  return {
    memoryId: `mem_${overrides.id}`,
    memoryTitle: 'Deploy window',
    kind: 'schedule',
    rule: 'Never deploy on a Friday afternoon; the on-call rotation changes at 17:00.',
    reasoning: 'High-importance operational instruction.',
    score: 9,
    agentId: 'persona_1',
    dismissed: false,
    ...overrides,
  };
}

function iso(msBeforeNow: number): string {
  return new Date(NOW - msBeforeNow).toISOString();
}

describe('pruneActions', () => {
  it('drops entries older than the TTL and keeps the ones inside it', () => {
    const fresh = action({ id: 'fresh', createdAt: iso(24 * 60 * 60 * 1000) });
    const stale = action({ id: 'stale', createdAt: iso(ACTION_TTL_MS + 1) });

    const kept = pruneActions([fresh, stale], NOW);

    expect(kept.map((a) => a.id)).toEqual(['fresh']);
  });

  it('expires an entry whose timestamp cannot be parsed', () => {
    // An unparseable createdAt can never age out, so keeping it would reproduce
    // exactly the "lives forever" failure this bound exists to stop.
    const broken = action({ id: 'broken', createdAt: 'not-a-date' });

    expect(pruneActions([broken], NOW)).toEqual([]);
  });

  it('caps the list at MAX_PERSISTED_ACTIONS, keeping the newest', () => {
    const many = Array.from({ length: MAX_PERSISTED_ACTIONS + 10 }, (_, i) =>
      action({ id: `a${i}`, createdAt: iso(i * 60_000) }),
    );

    const kept = pruneActions(many, NOW);

    expect(kept).toHaveLength(MAX_PERSISTED_ACTIONS);
    // a0 is the newest (0ms before now); the 10 oldest must be the ones gone.
    expect(kept[0]!.id).toBe('a0');
    expect(kept.map((a) => a.id)).not.toContain(`a${MAX_PERSISTED_ACTIONS}`);
  });

  it('is a no-op for a list already inside both bounds', () => {
    const ok = [
      action({ id: 'a', createdAt: iso(1000) }),
      action({ id: 'b', createdAt: iso(2000) }),
    ];

    expect(pruneActions(ok, NOW).map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('the retention bound is actually wired into storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saveActions never writes an expired excerpt to localStorage', () => {
    saveActions([
      action({ id: 'fresh', createdAt: new Date().toISOString() }),
      action({ id: 'ancient', createdAt: new Date(Date.now() - ACTION_TTL_MS - 1).toISOString() }),
    ]);

    const written = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as MemoryAction[];
    expect(written.map((a) => a.id)).toEqual(['fresh']);
    // The whole point: the ancient record's memory body text is gone from disk.
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('mem_ancient');
  });

  it('loadActions prunes and rewrites a blob an older build left oversized', () => {
    const legacy = [
      action({ id: 'keep', createdAt: new Date().toISOString() }),
      action({ id: 'expired', createdAt: new Date(Date.now() - ACTION_TTL_MS - 1).toISOString() }),
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    expect(loadActions().map((a) => a.id)).toEqual(['keep']);
    // Pruned on read, not just in the returned value — otherwise the stale copy
    // survives on disk and the bound only ever looks like it worked.
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as MemoryAction[];
    expect(onDisk.map((a) => a.id)).toEqual(['keep']);
  });
});
