import { useState, useCallback } from 'react';

export function useToggleSet<T>(initial: Set<T> = new Set()) {
  const [set, setSet] = useState<Set<T>>(initial);

  const toggle = useCallback((value: T) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  return [set, toggle, setSet] as const;
}
