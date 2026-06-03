import { useSyncExternalStore } from 'react';
import { MOBILE_VIEWPORT_BREAKPOINT_PX } from '@/lib/utils/platform/platform';
import { useMobilePreview } from './useMobilePreview';

/**
 * Single source of truth for "should the layout render in its compact / mobile
 * form".
 *
 * It joins the two signals that used to be defined independently (and could
 * therefore disagree):
 *   - the build-time platform flag + dev mobile-preview toggle (useMobilePreview)
 *   - a runtime viewport-width media query (one matchMedia source, one
 *     breakpoint constant from platform.ts)
 *
 * A phone build, the Ctrl+Shift+M dev preview, OR a narrow desktop/web window
 * all collapse to the compact layout from one breakpoint authority — so the
 * responsive layout is now testable in the browser without an Android device.
 */

const QUERY = `(max-width: ${MOBILE_VIEWPORT_BREAKPOINT_PX - 1}px)`;

let _mql: MediaQueryList | null = null;
function mql(): MediaQueryList | null {
  if (_mql === null && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    _mql = window.matchMedia(QUERY);
  }
  return _mql;
}

function subscribe(cb: () => void): () => void {
  const m = mql();
  if (!m) return () => {};
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

function getSnapshot(): boolean {
  return mql()?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

/** True while the viewport is narrower than `MOBILE_VIEWPORT_BREAKPOINT_PX`. */
export function useIsNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * True when the layout should use its compact/mobile form — a mobile build (or
 * the dev mobile-preview toggle) OR a viewport narrower than the breakpoint.
 */
export function useIsCompact(): boolean {
  const isMobileBuild = useMobilePreview();
  const isNarrow = useIsNarrowViewport();
  return isMobileBuild || isNarrow;
}
