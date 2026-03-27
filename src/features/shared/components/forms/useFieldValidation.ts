import { useState, useEffect, useRef, useCallback } from 'react';

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
  const seqRef = useRef(0);

  // Keep validate ref stable to avoid stale closures
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const onChange = useCallback(
    (value: string) => {
      // Clear pending timer
      if (timerRef.current) clearTimeout(timerRef.current);

      // Reset if below min length
      if (value.length < minLength) {
        setState('idle');
        setError(undefined);
        return;
      }

      setState('validating');
      setError(undefined);

      timerRef.current = setTimeout(async () => {
        const seq = ++seqRef.current;
        try {
          const result = await validateRef.current(value);
          // Ignore stale results
          if (seq !== seqRef.current) return;
          if (result) {
            setState('error');
            setError(result);
          } else {
            setState('valid');
            setError(undefined);
          }
        } catch (err) {
          if (seq !== seqRef.current) return;
          setState('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      }, debounceMs);
    },
    [debounceMs, minLength],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { validationState: state, error, onChange };
}
