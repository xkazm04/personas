/**
 * Who asked for the Mirror, and for what.
 *
 * The layer is summoned from places that do not share a parent — the Profiles
 * roster's "New twin", the Setup tab, a readiness jump — so the request lives
 * here and the one host mounted by `TwinPage` renders it. Holding it outside
 * the roster is also what lets the layer SURVIVE the page underneath swapping
 * its first-run hero for the grid the moment a twin exists.
 *
 * Ephemeral by design: a request is UI intent, not data, so it is neither
 * persisted nor carried across a hot reload.
 */

import { useSyncExternalStore } from 'react';
import type { SetupStage } from '../../setup/setupContract';

export type MirrorRequest =
  /** Name a new twin, then walk straight on into the first question. */
  | { mode: 'create' }
  /** Train the active twin, optionally opening on a given stage. */
  | { mode: 'train'; stage?: SetupStage };

let request: MirrorRequest | null = null;
const listeners = new Set<() => void>();

function publish(next: MirrorRequest | null) {
  request = next;
  for (const listener of listeners) listener();
}

export function openMirror(next: MirrorRequest): void {
  publish(next);
}

export function closeMirror(): void {
  publish(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The live request, or null while the Mirror is closed. */
export function useMirrorRequest(): MirrorRequest | null {
  return useSyncExternalStore(subscribe, () => request, () => null);
}
