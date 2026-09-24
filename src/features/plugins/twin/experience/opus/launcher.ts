/**
 * Who asked for the Twin experience, and for what.
 *
 * The overlay is summoned from places that do not share a parent: the
 * Profiles roster ("New twin"), the first-run hero, a twin card's slot jump,
 * and the Setup tab. Each calls `openTwinExperience`; the one host mounted in
 * `TwinPage` renders it. Holding the request here rather than in the roster's
 * own state is also what lets the overlay SURVIVE the roster underneath it
 * re-rendering into a different branch the moment the first twin exists — a
 * dialog owned by that branch was unmounted mid-flow.
 *
 * Ephemeral by design: a request is UI intent, not data, so it is neither
 * persisted nor kept across a hot reload.
 */

import { useSyncExternalStore } from 'react';
import type { SetupStage } from '../../setup/setupContract';

export type TwinExperienceRequest =
  /** Name a new twin, then go straight on to training it. */
  | { mode: 'create' }
  /** Train the active twin, optionally starting on a given stage. */
  | { mode: 'train'; stage?: SetupStage };

let request: TwinExperienceRequest | null = null;
const listeners = new Set<() => void>();

function publish(next: TwinExperienceRequest | null) {
  request = next;
  for (const listener of listeners) listener();
}

export function openTwinExperience(next: TwinExperienceRequest): void {
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
export function useTwinExperienceRequest(): TwinExperienceRequest | null {
  return useSyncExternalStore(subscribe, () => request, () => null);
}
