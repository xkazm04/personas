import { useLayoutEffect, useState, type RefObject } from 'react';

/** Content-box size from which a sheet draws its fuller drawings (about a 1920x1080 window). */
const ROOMY = { width: 1350, height: 880 } as const;

/**
 * Whether the sheet has room for its fuller drawings: on a large window layer
 * one letters the bio's scale and stage mode draws the channel elevations and
 * the tallies instead of their one-line forms. Never a smaller type size:
 * below this the fuller drawings move to the zoom (L2) instead.
 */
export function useRoomySheet(ref: RefObject<HTMLElement | null>): boolean {
  const [roomy, setRoomy] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setRoomy(el.clientWidth >= ROOMY.width && el.clientHeight >= ROOMY.height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return roomy;
}
