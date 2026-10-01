import { useEffect, useState, type RefObject } from 'react';

/**
 * Dossier (WP9): whether the bento has room to draw more at full size (a wide
 * content area). Layer one never shrinks to fit; with room it shows more rows
 * and larger instruments instead of stretching the same ones thin. `false`
 * until measured (and wherever ResizeObserver is absent), so the default is
 * the layout that fits the smallest supported area.
 */
export function useRoomy(ref: RefObject<HTMLElement | null>, minWidth: number): boolean {
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setRoomy(width >= minWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, minWidth]);
  return roomy;
}
