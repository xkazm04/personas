/**
 * The grid's tiling contract, extracted so the footer's "is there a grid worth
 * opening?" count and the overlay's tile list can never drift apart.
 */
import { describe, it, expect } from 'vitest';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { isGridEligible, gridSessions } from '../fleetSessionScope';

const s = (id: string, state: FleetSessionState, createdAtMs: number): FleetSession =>
  ({ id, state, createdAtMs: BigInt(createdAtMs) } as unknown as FleetSession);

describe('isGridEligible', () => {
  it('accepts every state that still owns a process', () => {
    for (const state of ['spawning', 'running', 'awaiting_input', 'idle', 'stale'] as const) {
      expect(isGridEligible(s('x', state, 0))).toBe(true);
    }
  });

  it('rejects exited and hibernated — neither has a PTY to attach', () => {
    expect(isGridEligible(s('x', 'exited', 0))).toBe(false);
    expect(isGridEligible(s('x', 'hibernated', 0))).toBe(false);
  });
});

describe('gridSessions', () => {
  it('orders by spawn time, not activity, so a tile never moves cells', () => {
    const ordered = gridSessions([
      s('third', 'idle', 300),
      s('first', 'running', 100),
      s('second', 'awaiting_input', 200),
    ]);
    expect(ordered.map((x) => x.id)).toEqual(['first', 'second', 'third']);
  });

  it('drops non-tileable sessions', () => {
    const ordered = gridSessions([s('a', 'running', 1), s('b', 'exited', 2), s('c', 'hibernated', 3)]);
    expect(ordered.map((x) => x.id)).toEqual(['a']);
  });
});
