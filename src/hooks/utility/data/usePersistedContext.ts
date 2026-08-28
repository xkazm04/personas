import { useEffect, useRef } from 'react';

export interface UsePersistedContextOptions<T> {
  /** localStorage key to read from. */
  key: string;
  /** Maximum age in ms before the persisted context is considered stale. */
  maxAge: number;
  /** Whether restoration should be attempted. For modals, pass `isOpen`. For tabs, omit or pass `true`. */
  enabled?: boolean;
  /**
   * Validate the parsed context and return a job ID if valid, or `null` to discard.
   * The consumer checks for the presence of the required ID field.
   */
  validate: (parsed: T) => string | null;
  /**
   * Extract the `savedAt` timestamp from the parsed context.
   * Return `undefined` if the context has no timestamp — the entry is then
   * treated as STALE and discarded. A context whose age cannot be proven is
   * never restored (fail closed); every writer in this repo persists
   * `savedAt: Date.now()`, so only malformed/legacy entries hit this path.
   */
  getSavedAt: (parsed: T) => number | undefined;
  /** Called when a valid, non-stale context is found. */
  onRestore: (context: T) => void;
}

/**
 * Restores a persisted background-job context from localStorage on mount (or
 * when `enabled` flips to true).  Performs max-age validation, removes stale
 * entries, and calls `onRestore` exactly once per lifecycle.
 *
 * Used by both AdoptionWizardModal and N8nImportTab to recover in-flight
 * background transformation sessions after a page reload or modal re-open.
 */
export function usePersistedContext<T>({
  key,
  maxAge,
  enabled = true,
  validate,
  getSavedAt,
  onRestore,
}: UsePersistedContextOptions<T>) {
  const hasRestoredRef = useRef(false);

  // Reset restoration guard on unmount so next open can restore
  useEffect(() => {
    return () => { hasRestoredRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const raw = window.localStorage.getItem(key);
    if (!raw) return;

    try {
      const decoded: unknown = JSON.parse(raw);
      // Invariant: this entry is written only by this app's own persist step,
      // which always stores a plain object. `validate` is contracted to look
      // for a required id field, which no non-object JSON value can carry, so
      // anything that is not an object is discarded BEFORE the cast rather
      // than asserted past it.
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        window.localStorage.removeItem(key);
        return;
      }
      const parsed = decoded as T;
      const id = validate(parsed);
      if (!id) {
        window.localStorage.removeItem(key);
        return;
      }

      // Discard stale contexts. A missing or non-finite timestamp fails
      // CLOSED: an entry whose age cannot be established is not restorable,
      // where it used to be restored forever.
      const savedAt = getSavedAt(parsed);
      if (savedAt === undefined || !Number.isFinite(savedAt) || Date.now() - savedAt > maxAge) {
        window.localStorage.removeItem(key);
        return;
      }

      onRestore(parsed);
    } catch {
      // intentional: non-critical -- corrupt localStorage entry is removed
      window.localStorage.removeItem(key);
    }
  }, [enabled, key, maxAge, validate, getSavedAt, onRestore]);
}
