/**
 * The grid's "tiles never move" contract. Every session keeps a tile
 * (exited/hibernated render as in-place tombstones), order is locked to spawn
 * time with the id as a total tie-break, and a wake that inherits its
 * predecessor's `createdAtMs` (registry::adopt_lineage) lands in the same slot.
 */
import { describe, it, expect } from 'vitest';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { gridSessions } from '../fleetSessionScope';

const s = (id: string, state: FleetSessionState, createdAtMs: number): FleetSession =>
  ({ id, state, createdAtMs: BigInt(createdAtMs) } as unknown as FleetSession);

describe('gridSessions', () => {
  it('orders by spawn time, not activity, so a tile never moves cells', () => {
    const ordered = gridSessions([
      s('third', 'idle', 300),
      s('first', 'running', 100),
      s('second', 'awaiting_input', 200),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(['first', 'second', 'third']);
  });

  it('keeps exited and hibernated sessions as in-place tombstones', () => {
    // A tile leaving the grid compacts every tile after it — the reorder the
    // first live run surfaced. Nothing leaves implicitly.
    const ordered = gridSessions([
      s('a', 'running', 1),
      s('b', 'exited', 2),
      s('c', 'hibernated', 3),
      s('d', 'awaiting_input', 4),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('breaks spawn-time ties by id so equal timestamps cannot flip between refreshes', () => {
    // The Rust snapshot iterates a HashMap — same-ms spawns arrive in an
    // arbitrary order each fetch. The tie-break makes the sort total.
    const shuffleOne = gridSessions([s('bbb', 'idle', 100), s('aaa', 'idle', 100)]);
    const shuffleTwo = gridSessions([s('aaa', 'idle', 100), s('bbb', 'idle', 100)]);
    expect(shuffleOne.map((x) => x.id)).toEqual(['aaa', 'bbb']);
    expect(shuffleTwo.map((x) => x.id)).toEqual(['aaa', 'bbb']);
  });

  it('slots a woken session (inherited createdAtMs) back where its predecessor sat', () => {
    const before = gridSessions([s('a', 'running', 1), s('old', 'stale', 2), s('c', 'running', 3)]);
    expect(before.map((x) => x.id)).toEqual(['a', 'old', 'c']);
    // Wake replaces `old` with a new row carrying the SAME createdAtMs.
    const after = gridSessions([s('a', 'running', 1), s('new', 'spawning', 2), s('c', 'running', 3)]);
    expect(after.map((x) => x.id)).toEqual(['a', 'new', 'c']);
  });
});
