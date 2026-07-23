import type { FleetSession } from '@/lib/bindings/FleetSession';

/**
 * Can this session host a tile in the terminal grid?
 *
 * Exited sessions have no process; hibernated ones deliberately gave theirs up
 * to free resources — neither has a PTY to attach, so neither is tiled. Shared
 * so the footer's "is the grid worth opening?" count and the grid's own tile
 * list can never disagree.
 */
export const isGridEligible = (s: FleetSession): boolean =>
  s.state !== 'exited' && s.state !== 'hibernated';

/**
 * Tile order is LOCKED to spawn time, never activity.
 *
 * Reordering tiles on every state change is disorienting at scale — the
 * operator builds muscle memory for "which session is in which cell", so a
 * tile must stay put. New sessions append at the end; the grid never reshuffles.
 */
export function gridSessions(sessions: ReadonlyArray<FleetSession>): FleetSession[] {
  return sessions
    .filter(isGridEligible)
    .sort((a, b) => Number(a.createdAtMs) - Number(b.createdAtMs));
}
