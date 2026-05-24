import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Availability surface state, distinct from the blocking `ValidationState` in
 * {@link ./useFieldValidation}:
 * - `idle`     — below min length, or reset. Nothing rendered.
 * - `checking` — debounce window open or async check in flight (spinner).
 * - `available` — the value is free to use (emerald check).
 * - `taken`    — the value collides; an optional `suggestion` offers an alternative (amber).
 */
export type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'taken';

export interface AvailabilityResult {
  /** Whether the value is free to use. */
  available: boolean;
  /** Optional alternative to surface to the user when `available` is false. */
  suggestion?: string;
}

export interface UseAsyncFieldValidationOptions {
  /**
   * Availability check. Receives the trimmed value and an `AbortSignal` that
   * fires when a newer keystroke supersedes this check (or the component
   * unmounts). Implementations that hit the network/IPC should forward the
   * signal so stale requests are cancelled; purely in-memory checks may ignore
   * it. May be sync or async.
   */
  check: (value: string, signal: AbortSignal) => Promise<AvailabilityResult> | AvailabilityResult;
  /** Debounce delay (ms) before the check fires. Default 350. */
  debounceMs?: number;
  /** Minimum trimmed length before checking; shorter values reset to idle. Default 1. */
  minLength?: number;
}

export interface UseAsyncFieldValidationReturn {
  /** Current availability state for the FormField `availability` prop. */
  status: AvailabilityStatus;
  /** Suggested alternative when `status === 'taken'` and the check provided one. */
  suggestion: string | undefined;
  /** Feed every input value here — it debounces and drives `status`. */
  onChange: (value: string) => void;
  /** Force back to idle (e.g. after a successful submit or when the form closes). */
  reset: () => void;
}

/**
 * Debounced, AbortController-cancelled inline availability check.
 *
 * Catches name collisions (duplicate persona/template/team names, etc.) at
 * type-time instead of save-time. Pair with `FormField`'s `availability` prop,
 * which renders a spinner → emerald check → amber "try X" with a gentle fade.
 *
 * The spinner stays steady between keystrokes because every keystroke re-enters
 * `checking` rather than toggling idle↔checking, so the inline status never
 * flickers while the user is mid-word.
 *
 * ```tsx
 * const name = useAsyncFieldValidation({
 *   check: (value) => ({ available: !existingNames.has(value.toLowerCase()) }),
 * });
 * // onChange in the input; pass { status, suggestion } down to FormField.
 * ```
 */
export function useAsyncFieldValidation({
  check,
  debounceMs = 350,
  minLength = 1,
}: UseAsyncFieldValidationOptions): UseAsyncFieldValidationReturn {
  const [status, setStatus] = useState<AvailabilityStatus>('idle');
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep `check` in a ref so callers can pass an inline closure without
  // re-creating `onChange` (and tearing down in-flight debounces) every render.
  const checkRef = useRef(check);
  checkRef.current = check;

  const cancelPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancelPending();
    setStatus('idle');
    setSuggestion(undefined);
  }, [cancelPending]);

  const onChange = useCallback(
    (value: string) => {
      // Supersede any pending timer + in-flight check.
      cancelPending();

      const trimmed = value.trim();
      if (trimmed.length < minLength) {
        setStatus('idle');
        setSuggestion(undefined);
        return;
      }

      setStatus('checking');
      setSuggestion(undefined);

      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        try {
          const result = await checkRef.current(trimmed, signal);
          if (signal.aborted) return;
          if (result.available) {
            setStatus('available');
            setSuggestion(undefined);
          } else {
            setStatus('taken');
            setSuggestion(result.suggestion);
          }
        } catch (err) {
          if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
          // A failed availability check must never block the user — fall back
          // to idle so the existing save-time validation stays the backstop.
          setStatus('idle');
          setSuggestion(undefined);
        }
      }, debounceMs);
    },
    [cancelPending, debounceMs, minLength],
  );

  // Abort + clear on unmount.
  useEffect(() => cancelPending, [cancelPending]);

  return { status, suggestion, onChange, reset };
}

/**
 * Pick the first free `"{base} {n}"` (n ≥ 2) not present in `taken`.
 * Handy for the `suggestion` field of an {@link AvailabilityResult} when a
 * name collides. Comparison is case-insensitive and trimmed.
 */
export function suggestAlternativeName(base: string, taken: Iterable<string>): string {
  const normalized = new Set<string>();
  for (const t of taken) normalized.add(t.trim().toLowerCase());
  const root = base.trim();
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root} ${n}`;
    if (!normalized.has(candidate.toLowerCase())) return candidate;
  }
  return `${root} ${Date.now()}`;
}
