import { useState, useEffect, useRef, useCallback } from 'react';
import { extractMessage } from '@/lib/silentCatch';

export type ValidationState = 'idle' | 'validating' | 'valid' | 'error';

export interface UseFieldValidationOptions {
  /** Async (or sync) validator — return an error string or null/undefined for valid. */
  validate: (value: string) => Promise<string | null | undefined> | string | null | undefined;
  /** Debounce delay in ms (default 400). */
  debounceMs?: number;
  /** Minimum input length before validation runs (default 1). */
  minLength?: number;
}

export interface UseFieldValidationReturn {
  /** Current validation state for the FormField `validationState` prop. */
  validationState: ValidationState;
  /** Error message when state is 'error', undefined otherwise. */
  error: string | undefined;
  /** Call this from onChange — it debounces and triggers validation. */
  onChange: (value: string) => void;
}

/**
 * Debounced inline field validation hook.
 *
 * Usage:
 * ```tsx
 * const { validationState, error, onChange } = useFieldValidation({
 *   validate: async (v) => { … return errorMsg || null; },
 * });
 * ```
 */
export function useFieldValidation({
  validate,
  debounceMs = 400,
  minLength = 1,
}: UseFieldValidationOptions): UseFieldValidationReturn {
  const [state, setState] = useState<ValidationState>('idle');
  const [error, setError] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Retired on EVERY onChange, not when the next debounce fires: a check still
  // in flight when the user types again (or clears below minLength) is stale
  // the moment the value changes. Same AbortController shape as the sibling
  // useAsyncFieldValidation (a catalog primitive cannot import the stores'
  // createLatestWins).
  const inFlightRef = useRef<AbortController | null>(null);

  // Keep validate ref stable to avoid stale closures
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const onChange = useCallback(
    (value: string) => {
      // Clear pending timer and retire any check already in flight.
      if (timerRef.current) clearTimeout(timerRef.current);
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;
      const { signal } = controller;

      // Reset if below min length
      if (value.length < minLength) {
        setState('idle');
        setError(undefined);
        return;
      }

      setState('validating');
      setError(undefined);

      timerRef.current = setTimeout(async () => {
        try {
          const result = await validateRef.current(value);
          // Ignore stale results
          if (signal.aborted) return;
          if (result) {
            setState('error');
            setError(result);
          } else {
            setState('valid');
            setError(undefined);
          }
        } catch (err) {
          if (signal.aborted) return;
          setState('error');
          setError(extractMessage(err));
        }
      }, debounceMs);
    },
    [debounceMs, minLength],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      inFlightRef.current?.abort();
    };
  }, []);

  return { validationState: state, error, onChange };
}
