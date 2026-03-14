import { useState, useCallback } from 'react';

export interface ToggleSetActions<T> {
  values: Set<T>;
  toggle: (item: T) => void;
  has: (item: T) => boolean;
  clear: () => void;
  addAll: (items: Iterable<T>) => void;
  set: (items: Set<T>) => void;
}

export function useToggleSet<T>(initial?: Iterable<T>): ToggleSetActions<T> {
  const [values, setValues] = useState<Set<T>>(() => new Set(initial));

  const toggle = useCallback((item: T) => {
    setValues((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }, []);

  const has = useCallback((item: T) => values.has(item), [values]);

  const clear = useCallback(() => setValues(new Set()), []);

  const addAll = useCallback((items: Iterable<T>) => {
    setValues((prev) => {
      const next = new Set(prev);
      for (const item of items) next.add(item);
      return next;
    });
  }, []);

  const set = useCallback((items: Set<T>) => setValues(items), []);

  return { values, toggle, has, clear, addAll, set };
}
