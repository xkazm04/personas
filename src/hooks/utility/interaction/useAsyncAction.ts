import { useState, useCallback, useRef } from 'react';

/**
 * Hook that wraps an async function with loading + error state management.
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

  // Track mount state to avoid set-state-after-unmount
  // Using a ref + cleanup instead of useEffect to keep the hook lightweight
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
