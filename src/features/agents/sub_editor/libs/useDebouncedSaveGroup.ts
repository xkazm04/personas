import { useCallback, useRef } from 'react';
import type { PersonaDraft } from './PersonaDraft';
import { draftChanged } from './PersonaDraft';

interface SaveGroupOptions {
  /** Ref to always-current draft. */
  draftRef: React.RefObject<PersonaDraft>;
  /** Ref to always-current baseline. Kept for callers; no longer consulted for
   *  the post-await early-return check (see comment below). */
  baselineRef: React.RefObject<PersonaDraft>;
  /** Key group used for dirty detection. */
  keys: readonly (keyof PersonaDraft)[];
  /** The actual save operation -- called with the current draft snapshot. */
  performSave: (draft: PersonaDraft) => Promise<void>;
}

/**
 * Generic save-group orchestrator that encapsulates:
 * - while-inflight-await lock (prevents overlapping saves)
 * - ref-based draft reads (never captures stale state)
 * - try/finally cleanup of the in-flight ref
 *
 * Returns a stable save callback suitable for useTabSection.
 */
export function useDebouncedSaveGroup({
  draftRef,
  baselineRef: _baselineRef,
  keys,
  performSave,
}: SaveGroupOptions) {
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Snapshot of the draft passed to the currently-running performSave. Stored
  // synchronously (no React render gap) so the post-await comparison cannot
  // wrongly report 'no changes' when keystrokes arrived during the await
  // window. Previously we compared against baselineRef, which is updated via
  // setBaseline (async) — that left a window where the ref still pointed at
  // the *previous* baseline and the early-return swallowed unsaved edits.
  const inFlightSnapshotRef = useRef<PersonaDraft | null>(null);

  const save = useCallback(async () => {
    while (inFlightRef.current) {
      const snapshotBefore = inFlightSnapshotRef.current;
      await inFlightRef.current;
      // Only short-circuit if the live draft exactly matches the snapshot the
      // in-flight save just persisted (for the keys we care about). Any keystroke
      // that arrived during the await produces a divergence and forces another
      // save iteration.
      if (snapshotBefore && !draftChanged(draftRef.current, snapshotBefore, keys)) return;
    }

    const snapshot = draftRef.current;
    inFlightSnapshotRef.current = snapshot;
    const savePromise = performSave(snapshot);

    inFlightRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      if (inFlightRef.current === savePromise) {
        inFlightRef.current = null;
        inFlightSnapshotRef.current = null;
      }
    }
  }, [draftRef, keys, performSave]);

  return save;
}
