import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT_PX = 768;

/**
 * Returns true while the viewport is narrower than `MOBILE_BREAKPOINT_PX`.
 *
 * Used by the persona overview page to swap the wide DataGrid for a card list
 * on small screens, where horizontal columns would otherwise truncate to
 * unreadable widths.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}
