import type { FleetSession } from '@/lib/bindings/FleetSession';

/**
 * Grid ordering — the "tiles never move" contract.
 *
 * Every registry row is a fleet-spawned session (external hook-only CLIs never
 * create rows), and every one of them keeps a tile: exited and hibernated
 * sessions render as in-place tombstones (dismiss / wake) instead of vanishing.
 * That's deliberate. The first live fleet run showed tiles shifting under the
 * operator — any membership change compacts a CSS grid, so the only way to
 * honour "session X is the top-left tile" muscle memory is to never let a tile
 * leave implicitly. A tile disappears exactly one way: the operator dismisses
 * (or kills, then dismisses) it.
 *
 * Order is LOCKED to spawn time, never activity, with the id as a total
 * tie-break so equal timestamps can't flip between refreshes (the Rust
 * snapshot iterates a HashMap — without the tie-break, ties would re-shuffle
 * per fetch). Wake keeps a resumed session in its slot by inheriting the old
 * row's `createdAtMs` (`registry::adopt_lineage`); new sessions append at the
 * end; the grid never reshuffles.
 */
export function gridSessions(sessions: ReadonlyArray<FleetSession>): FleetSession[] {
  return [...sessions].sort(
    (a, b) => Number(a.createdAtMs) - Number(b.createdAtMs) || a.id.localeCompare(b.id),
  );
}
