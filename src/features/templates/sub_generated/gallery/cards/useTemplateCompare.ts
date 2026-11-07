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

  /** Swap in the freshly loaded objects for selected ids (a refresh or rebuild
   *  changes a review in place). Ids absent from `items` are kept: `items` is
   *  only the loaded, filtered page, so a miss does not mean deleted. */
  const refreshFrom = useCallback((items: readonly PersonaDesignReview[]) => {
    setSelected((prev) => {
      const byId = new Map(items.map((r) => [r.id, r]));
      let changed = false;
      const next = prev.map((r) => {
        const fresh = byId.get(r.id);
        if (fresh && fresh !== r) { changed = true; return fresh; }
        return r;
      });
      return changed ? next : prev;
    });
  }, []);

  const canAdd = selected.length < MAX_COMPARE;

  return { selected, selectedIds, toggle, remove, clear, refreshFrom, canAdd };
}
