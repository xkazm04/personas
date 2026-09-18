/**
 * One-shot handoff from the create dialog to Setup Fields.
 *
 * The dialog only RECORDS a starting style; the studio panel runs it once the
 * new twin's Setup page mounts. Module-scoped on purpose: a choice that did not
 * reach the panel in this app session is stale, and a persisted one would
 * replay a roll the user never asked for again (the reason the old wizard's
 * localStorage handoff was retired). `take` deletes, so a remount cannot replay.
 */

import type { StyleStart } from './styleContract';

const pending = new Map<string, StyleStart>();

export function setPendingStyleStart(twinId: string, start: StyleStart): void {
  pending.set(twinId, start);
}

export function takePendingStyleStart(twinId: string): StyleStart | null {
  const start = pending.get(twinId) ?? null;
  pending.delete(twinId);
  return start;
}
