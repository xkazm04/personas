// fleetStripModel — pure logic for the global FleetActivityStrip.
//
// Kept separate from the component so the slot math is unit-testable without a
// DOM (see fleetStripModel.test.ts).

import type { ActiveProcess } from '@/stores/slices/processActivitySlice';

/** Number of slots composing the strip's full width. */
export const STRIP_SLOTS = 20;

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

/** Per-slot fill state for the strip, left→right. */
export type SlotKind = 'running' | 'queued' | 'empty';

/**
 * Lay the pulse out across `slots` cells: running cells first (bright), then a
 * dim queued tail, then empty. Running alone is capped at the slot count; the
 * queued tail only fills whatever room running leaves.
 */
export function layoutSlots(pulse: FleetPulse, slots: number = STRIP_SLOTS): SlotKind[] {
  const runningCells = Math.min(pulse.running, slots);
  const queuedCells = Math.min(pulse.queued, slots - runningCells);
  const out: SlotKind[] = [];
  for (let i = 0; i < slots; i += 1) {
    if (i < runningCells) out.push('running');
    else if (i < runningCells + queuedCells) out.push('queued');
    else out.push('empty');
  }
  return out;
}
