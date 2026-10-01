/**
 * Who asked for the Twin experience, and for what.
 *
 * The overlay is summoned from places that do not share a parent — the Profiles
 * roster's "New twin", the Setup tab, a readiness jump — so the request lives
 * here and the one host mounted by `TwinPage` renders it. Holding it outside
 * the roster is also what lets the overlay SURVIVE the page underneath swapping
 * its first-run hero for the grid the moment a twin exists.
 *
 * Ephemeral by design: a request is UI intent, not data, so it is neither
 * persisted nor carried across a hot reload.
 */

import { useSyncExternalStore } from 'react';
import type { SetupStage } from '../setup/setupContract';
import type { ExperienceDoor } from './table/TableChrome';

/**
 * A writing sample the new twin should learn from right after it is forged
 * (Browser Learn > "New twin", spark twin-portable-blueprint). The forge
 * creates the twin, then hands this to `learnFromSample` on the new id.
 */
export interface ExperienceSeedSample {
  text: string;
  sourceKind: 'selection' | 'clipboard';
  sourceHost: string | null;
}

export type ExperienceRequest =
  /** Name a new twin, then deal the first hand without leaving; optionally seeded with a sample to learn from. */
  | { mode: 'create'; seedSample?: ExperienceSeedSample }
  /** Train the active twin, optionally opening on a given stage, with a door (layer) already open. */
  | { mode: 'train'; stage?: SetupStage; door?: ExperienceDoor };

let request: ExperienceRequest | null = null;
const listeners = new Set<() => void>();

function publish(next: ExperienceRequest | null) {
  request = next;
  for (const listener of listeners) listener();
}

export function openTwinExperience(next: ExperienceRequest): void {
  publish(next);
}

export function closeTwinExperience(): void {
  publish(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The live request, or null while the experience is closed. */
export function useTwinExperienceRequest(): ExperienceRequest | null {
  return useSyncExternalStore(subscribe, () => request, () => null);
}
