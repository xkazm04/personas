import { useCallback, useEffect, useRef, useState } from 'react';

interface Identifiable {
  id: string;
}

/**
 * Multi-select state for a gallery grid. The hook tracks a Set of selected
 * ids and the index of the last toggled item so shift-click can extend a
 * range. Selection is pruned whenever the underlying `items` array changes
 * — if a search filter narrows the visible set, any id no longer present
 * is dropped, so the selection count always reflects what the user can
 * actually see.
 */
export function useGallerySelection<T extends Identifiable>(items: T[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);

  // Keep a ref so the toggle callback can read the latest items without
  // listing `items` as a dep (which would change identity every parent
  // re-render and churn downstream memoization).
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(items.map((i) => i.id));
      let allPresent = true;
      for (const id of prev) {
        if (!visible.has(id)) {
          allPresent = false;
          break;
        }
      }
      if (allPresent) return prev;
      const pruned = new Set<string>();
      for (const id of prev) if (visible.has(id)) pruned.add(id);
      return pruned;
    });
  }, [items]);

  const toggle = useCallback(
    (id: string, index: number, shift: boolean) => {
      const list = itemsRef.current;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shift && lastIndex !== null) {
          const [a, b] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
          // Range-select adds every id in the range; the anchor stays at the
          // most recently toggled item so subsequent shift-clicks pivot from
          // there, which matches Finder/Explorer behaviour.
          for (let i = a; i <= b; i++) {
            const candidate = list[i];
            if (candidate) next.add(candidate.id);
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setLastIndex(index);
    },
    [lastIndex],
  );

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setLastIndex(null);
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    isSelected,
    toggle,
    clear,
    count: selectedIds.size,
  };
}
