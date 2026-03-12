import { useCallback, useRef } from 'react';
import type { PersonaDraft } from './PersonaDraft';
import { draftChanged } from './PersonaDraft';

interface SaveGroupOptions {
  /** Ref to always-current draft. */
  draftRef: React.RefObject<PersonaDraft>;
  /** Ref to always-current baseline. */
  baselineRef: React.RefObject<PersonaDraft>;
  /** Key group used for dirty detection. */
  keys: readonly (keyof PersonaDraft)[];
  /** The actual save operation -- called with the current draft snapshot. */
  performSave: (draft: PersonaDraft) => Promise<void>;
}

/**
 * Generic save-group orchestrator that encapsulates:
 * - while-inflight-await lock (prevents overlapping saves)
 * - ref-based draft/baseline reads (never captures stale state)
 * - try/finally cleanup of the in-flight ref
 *
 * Returns a stable save callback suitable for useTabSection.
 */
export function useDebouncedSaveGroup({
  draftRef,
  baselineRef,
  keys,
  performSave,
}: SaveGroupOptions) {
  const inFlightRef = useRef<Promise<void> | null>(null);

  const save = useCallback(async () => {
    while (inFlightRef.current) {
      await inFlightRef.current;
      if (!draftChanged(draftRef.current, baselineRef.current, keys)) return;
    }

    const savePromise = performSave(draftRef.current);

    inFlightRef.current = savePromise;
    try {
      await savePromise;
    } finally {
      if (inFlightRef.current === savePromise) {
        inFlightRef.current = null;
      }
    }
  }, [draftRef, baselineRef, keys, performSave]);

  return save;
}
