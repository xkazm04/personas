import { useCallback, useRef, type KeyboardEvent } from 'react';

/**
 * WAI-ARIA roving tabindex helper for horizontal composite widgets
 * (tablists, toolbars, menubars). Returns a ref setter for each item
 * plus an onKeyDown handler that moves focus AND selection on
 * ArrowLeft/ArrowRight/Home/End and wraps at the ends.
 */
export function useRovingTabIndex<T extends HTMLElement>(
  count: number,
  activeIndex: number,
  onIndexChange: (next: number) => void,
) {
  const refs = useRef<(T | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (el: T | null) => {
      refs.current[index] = el;
    },
    [],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<T>) => {
      let next = -1;
      switch (e.key) {
        case 'ArrowRight':
          next = (activeIndex + 1) % count;
          break;
        case 'ArrowLeft':
          next = (activeIndex - 1 + count) % count;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = count - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      onIndexChange(next);
      refs.current[next]?.focus();
    },
    [activeIndex, count, onIndexChange],
  );

  return { setRef, onKeyDown };
}
