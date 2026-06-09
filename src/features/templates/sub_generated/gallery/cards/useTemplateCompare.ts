import { useState, useCallback, useMemo } from 'react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

/** Max templates that can be compared side-by-side at once. */
export const MAX_COMPARE = 3;

/**
 * Selection state for the gallery's side-by-side compare feature. Holds the
 * chosen reviews (capped at MAX_COMPARE), exposes a stable toggle so memoized
 * rows don't re-render on unrelated selection changes.
 */
export function useTemplateCompare() {
  const [selected, setSelected] = useState<PersonaDesignReview[]>([]);

  const selectedIds = useMemo(() => new Set(selected.map((r) => r.id)), [selected]);

  const toggle = useCallback((review: PersonaDesignReview) => {
    setSelected((prev) => {
      if (prev.some((r) => r.id === review.id)) return prev.filter((r) => r.id !== review.id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, review];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setSelected((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  const canAdd = selected.length < MAX_COMPARE;

  return { selected, selectedIds, toggle, remove, clear, canAdd };
}
