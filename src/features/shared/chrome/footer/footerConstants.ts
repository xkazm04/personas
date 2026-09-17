import { IS_MOBILE } from '@/lib/utils/platform/platform';

// Constants live apart from the footer component so importers (Sidebar,
// keyboard shortcuts, fullscreen overlays) do not pull the footer chunk in
// just to read a string or a number.

/** Custom event name used to toggle sidebar collapse from anywhere. */
export const SIDEBAR_TOGGLE_EVENT = 'personas:sidebar-toggle';

/**
 * Height of the desktop footer bar in px (the `h-8` on the bar).
 *
 * Exported so fullscreen surfaces can stop *above* the footer rather than
 * relying on z-order to sit under it — reserving the space keeps the footer's
 * controls clickable and keeps the surface's own bottom edge visible. Zero on
 * mobile, where the footer isn't rendered at all.
 */
export const DESKTOP_FOOTER_HEIGHT_PX = IS_MOBILE ? 0 : 32;
