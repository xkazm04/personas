import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

export interface AnchoredPortalPosition {
  top: number;
  left: number;
  width: number;
  /** True when the menu was flipped above the trigger for lack of room below. */
  flipUp: boolean;
}

/**
 * Shared positioning mechanics for a dropdown/menu portalled to `document.body`
 * and anchored under (or, when `flip` is enabled, above) a trigger element.
 * Recomputes on scroll (capture, so it catches scrollable ancestors) and
 * resize while `open`; returns `null` until the trigger ref is mounted and open.
 *
 * Extracted from ThemedSelect's `FilterableSelect` and `Listbox`'s portal mode,
 * which each re-implemented this `getBoundingClientRect` + scroll/resize dance
 * independently (refactor-bughunt-2026-07-10 #7).
 */
export function useAnchoredPortalPosition(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
  opts: { flip?: boolean; maxMenuHeight?: number; gap?: number; bottomMargin?: number } = {},
): AnchoredPortalPosition | null {
  const flip = opts.flip ?? false;
  const maxMenuHeight = opts.maxMenuHeight ?? 220;
  const gap = opts.gap ?? 4;
  // Clearance kept below the viewport edge when deciding whether to flip.
  // Defaults to `gap` but can differ from it (ThemedSelect historically used 8).
  const bottomMargin = opts.bottomMargin ?? gap;

  const [pos, setPos] = useState<AnchoredPortalPosition | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      let flipUp = false;
      if (flip) {
        const spaceBelow = window.innerHeight - rect.bottom - bottomMargin;
        flipUp = spaceBelow < maxMenuHeight && rect.top > spaceBelow;
      }
      setPos({
        top: flipUp ? rect.top - gap : rect.bottom + gap,
        left: rect.left,
        width: rect.width,
        flipUp,
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flip, maxMenuHeight, gap, bottomMargin]);

  return pos;
}
