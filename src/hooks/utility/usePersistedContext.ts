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
   * Return `undefined` if the context has no timestamp (will be treated as fresh).
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
      const parsed = JSON.parse(raw) as T;
      const id = validate(parsed);
      if (!id) {
        window.localStorage.removeItem(key);
        return;
      }

      // Discard stale contexts
      const savedAt = getSavedAt(parsed);
      if (savedAt !== undefined && Date.now() - savedAt > maxAge) {
        window.localStorage.removeItem(key);
        return;
      }

      onRestore(parsed);
    } catch {
      window.localStorage.removeItem(key);
    }
  }, [enabled, key, maxAge, validate, getSavedAt, onRestore]);
}
