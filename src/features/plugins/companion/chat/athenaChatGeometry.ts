/**
 * Panel geometry — the numbers that decide how much screen Athena's chat takes.
 *
 * Kept in one place because they are coupled to app chrome that lives far away:
 * the panel is anchored `bottom-12` (48px above the viewport floor) and the
 * custom title bar is a fixed 48px band at the top (`globals.css .titlebar`).
 * A panel taller than `viewport − bottomInset − titleBar − breathing room`
 * pushes its own header UNDER the app header, which is exactly what the old
 * `max-h-[calc(100vh-5rem)]` did: 100vh − 80px against a 48px bottom inset put
 * the panel's top edge at y=32 — 16px inside the title bar.
 */

/** Distance from the viewport floor to the panel's bottom edge (`bottom-12`). */
export const PANEL_BOTTOM_INSET_PX = 48;

/** Height of the custom title bar (`globals.css` → `.titlebar`). */
export const APP_TITLEBAR_PX = 48;

/** Visible gap we insist on between the title bar and the panel's top edge. */
export const PANEL_TOP_BREATHING_PX = 16;

/**
 * Largest height the panel may take before it would collide with the app
 * header. Expressed as a CSS `calc` so it tracks the live viewport.
 */
export const PANEL_MAX_HEIGHT =
  `calc(100vh - ${
    PANEL_BOTTOM_INSET_PX + APP_TITLEBAR_PX + PANEL_TOP_BREATHING_PX
  }px)` as const;

/** Preferred height — clamped by {@link PANEL_MAX_HEIGHT} on short viewports. */
export const PANEL_HEIGHT_PX = 880;

/**
 * Expanded width. Widened from the original 760px by 20% so a full-width turn
 * fits more of Athena's prose (and the inner side panel) without wrapping.
 */
export const PANEL_WIDTH_PX = 912;

/**
 * Compact ("shrunk") width — deliberately unchanged by the widening above.
 * Compact exists to give the app back its screen, so it stays exactly as slim
 * as it was; only the expanded state grew.
 */
export const PANEL_COMPACT_WIDTH_PX = 350;

/** Resolve the panel's width for a compact flag. */
export function panelWidthPx(compact: boolean): number {
  return compact ? PANEL_COMPACT_WIDTH_PX : PANEL_WIDTH_PX;
}
