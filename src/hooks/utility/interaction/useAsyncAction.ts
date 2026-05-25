import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Canonical hook for one-shot async actions: wraps an async function with
 * loading + error state and automatic set-state-after-unmount safety.
 *
 * Prefer this over hand-rolling a `useState` loading/error pair (the codebase
 * has ~70% of component fetches doing so). It is unmount-safe by default — no
 * caller wiring required.
 *
 * Replaces the common pattern:
 * ```ts
 * const [loading, setLoading] = useState(false);
 * const handleFoo = async () => {
 *   setLoading(true);
 *   try { await foo(); } catch (e) { ... } finally { setLoading(false); }
 * };
 * ```
 *
 * Usage:
 * ```ts
 * const { execute, loading, error } = useAsyncAction(async () => {
 *   await saveDraft();
 * });
 * <Button loading={loading} onClick={execute}>Save</Button>
 * ```
 */
export function useAsyncAction<T = void>(
  fn: () => Promise<T>,
  options?: {
    /** Called on error — return `true` to suppress setting the error state. */
    onError?: (err: unknown) => boolean | void;
    /** Called on success with the result. */
    onSuccess?: (result: T) => void;
  },
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Auto unmount-safety: flip mountedRef on real unmount so execute() never
  // set-states after unmount, with zero caller wiring. (Previously this was
  // opt-in via the returned `cleanup`, which most call sites never invoked —
  // so the guard silently did nothing.) The effect re-sets true on mount to
  // stay correct under StrictMode's mount→unmount→mount double-invoke.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Retained for back-compat / manual early teardown; unmount no longer needs it.
  const cleanup = useCallback(() => { mountedRef.current = false; }, []);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (mountedRef.current) {
        options?.onSuccess?.(result);
      }
      return result;
    } catch (err) {
      if (mountedRef.current) {
        const suppressed = options?.onError?.(err);
        if (!suppressed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      return undefined;
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [fn, options]);

  return { execute, loading, error, clearError: () => setError(null), cleanup } as const;
}
