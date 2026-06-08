// fleetStripModel — pure logic for the global FleetActivityStrip.
//
// Kept separate from the component so the slot math is unit-testable without a
// DOM (see fleetStripModel.test.ts).

import type { ActiveProcess } from '@/stores/slices/processActivitySlice';

/**
 * Upper bound on the strip's bar count. The strip is a capacity gauge — it
 * normally renders exactly `cap` bars (see {@link slotCountForCapacity}) — but
 * a very large cap is clamped to this so the 2px hairline never overflows.
 */
export const STRIP_SLOTS = 20;

/**
 * Lower bound on the strip's bar count. Below this a 1–3 bar strip reads as
 * broken rather than as a gauge, so small caps clamp up to this.
 */
export const MIN_STRIP_SLOTS = 4;

/**
 * Bar count for a given global concurrency cap (the `max_parallel_executions`
 * setting). `cap` running executions fill the strip exactly, so a full strip
 * means the fleet is at its limit. Clamped to
 * [{@link MIN_STRIP_SLOTS}, {@link STRIP_SLOTS}]; a non-positive/NaN cap falls
 * back to the full width.
 */
export function slotCountForCapacity(cap: number): number {
  if (!Number.isFinite(cap) || cap <= 0) return STRIP_SLOTS;
  return Math.max(MIN_STRIP_SLOTS, Math.min(Math.round(cap), STRIP_SLOTS));
}

export interface FleetPulse {
  /** Executions currently running. */
  running: number;
  /** Executions queued behind a running one. */
  queued: number;
  /** Earliest `startedAt` among running processes, or `null`. */
  oldestRunningSince: number | null;
  /** Live USD cost summed across running processes. */
  liveCostUsd: number;
}

/**
 * Reduce the live process map to the handful of numbers the strip renders.
 * Deliberately tiny — the strip subscribes to these primitives so it
 * re-renders only when the pulse actually changes, not on every event tick.
 */
export function computeFleetPulse(processes: Record<string, ActiveProcess>): FleetPulse {
  let running = 0;
  let queued = 0;
  let oldestRunningSince: number | null = null;
  let liveCostUsd = 0;
  for (const key in processes) {
    const p = processes[key]!;
    if (p.status === 'running') {
      running += 1;
      liveCostUsd += p.costUsd;
      if (oldestRunningSince === null || p.startedAt < oldestRunningSince) {
        oldestRunningSince = p.startedAt;
      }
    } else if (p.status === 'queued') {
      queued += 1;
    }
  }
  return { running, queued, oldestRunningSince, liveCostUsd };
}

/** Per-slot fill state for the strip, indexed left→right. */
export type SlotKind = 'running' | 'queued' | 'empty';

/**
 * Center-out fill order for `slots` physical cells.
 *
 * Returns physical indices ordered by distance from the centre line, so the
 * first persona lights the most central bar, the second switches to the other
 * side, the third steps further out, and so on — the strip grows symmetrically
 * from the middle. For an even slot count the two central bars (e.g. 9 then 10
 * for 20 slots) form the first pair; ties break left-first.
 *
 * Example (slots = 6): mid = 2.5 → [2, 3, 1, 4, 0, 5].
 */
export function centerOutOrder(slots: number): number[] {
  const mid = (slots - 1) / 2;
  return Array.from({ length: slots }, (_, i) => i).sort((a, b) => {
    const da = Math.abs(a - mid);
    const db = Math.abs(b - mid);
    if (da !== db) return da - db;
    return a - b; // equal distance → left side first
  });
}

/**
 * Lay the pulse out across `slots` cells, filling from the centre outward:
 * running cells claim the most central positions (alternating sides), then a
 * dim queued tail continues further out, then the rest stay empty. Running
 * alone is capped at the slot count; the queued tail only fills whatever room
 * running leaves.
 */
export function layoutSlots(pulse: FleetPulse, slots: number = STRIP_SLOTS): SlotKind[] {
  const runningCells = Math.min(pulse.running, slots);
  const queuedCells = Math.min(pulse.queued, slots - runningCells);
  const order = centerOutOrder(slots);
  const out: SlotKind[] = new Array<SlotKind>(slots).fill('empty');
  for (let r = 0; r < runningCells; r += 1) out[order[r]!] = 'running';
  for (let q = 0; q < queuedCells; q += 1) out[order[runningCells + q]!] = 'queued';
  return out;
}
