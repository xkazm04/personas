/**
 * The last sweep's skipped-sensor list, shared between the control that ran the
 * sweep and the scoreboard that reports on sensors.
 *
 * `runFindingSweep` already returns `skippedSensors`, and both callers already
 * put it in a toast — but a toast is gone in four seconds, and the surface that
 * is actually ABOUT sensors rendered `null` when nothing had been raised. A
 * first sweep on an unwired project therefore looked exactly like a clean bill
 * of health, which is the `failure-not-empty-success` trap: "no findings"
 * because nothing was measured is not the same claim as "no findings".
 *
 * A module-scoped record rather than a store slice: both writers and the one
 * reader live in this directory, the value is per-session and never persisted,
 * and adding it to the global UI slice would put a transient sweep detail in the
 * same place as navigation state that outlives it.
 */

import { useSyncExternalStore } from 'react';

export interface LastSweepRecord {
  /** Sensor keys `runFindingSweep` reported it could not read. */
  skippedSensors: string[];
  /** Which project it swept - a record from another project is not this one's. */
  projectId: string;
  at: number;
}

let current: LastSweepRecord | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Called by every sweep entry point (manual button and scheduled ingest). */
export function recordSweep(projectId: string, skippedSensors: string[]): void {
  current = { projectId, skippedSensors, at: Date.now() };
  emit();
}

/** Test hatch. Production has no reason to forget the last sweep. */
export function resetLastSweep(): void {
  current = null;
  emit();
}

export function getLastSweep(): LastSweepRecord | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The last sweep, but only if it was THIS project's. A record from a project the
 * operator has since switched away from is not evidence about the one on screen.
 */
export function useLastSweep(projectId: string | null): LastSweepRecord | null {
  const record = useSyncExternalStore(subscribe, getLastSweep, getLastSweep);
  if (!record || !projectId || record.projectId !== projectId) return null;
  return record;
}
