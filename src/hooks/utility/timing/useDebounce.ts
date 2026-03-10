import { useState, useEffect } from 'react';

/**
 * Debounce a value by the given delay (default 150ms).
 * Returns the debounced value that updates only after the
 * caller stops changing the input for `delay` milliseconds.
 */
export function useDebounce<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
