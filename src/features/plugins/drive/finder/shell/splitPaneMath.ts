// Pure geometry for the Finder split pane — kept out of the component so the
// clamp / step rules are unit-testable without a DOM.
import { FINDER_PREFS_DEFAULT } from "../types";

export type PaneSide = "sidebar" | "inspector";

export const PANE_LIMITS: Record<PaneSide, { min: number; max: number; def: number }> = {
  sidebar: { min: 160, max: 480, def: FINDER_PREFS_DEFAULT.sidebarW },
  inspector: { min: 240, max: 560, def: FINDER_PREFS_DEFAULT.inspectorW },
};

/** Keyboard resize step for the divider (arrow keys). */
export const DIVIDER_KEY_STEP = 16;

export function clampPaneWidth(side: PaneSide, width: number): number {
  const { min, max } = PANE_LIMITS[side];
  if (!Number.isFinite(width)) return PANE_LIMITS[side].def;
  return Math.min(max, Math.max(min, Math.round(width)));
}

/**
 * Width after a pointer drag. The sidebar grows when the pointer moves right;
 * the inspector (anchored to the right edge) grows when it moves left.
 */
export function dragPaneWidth(
  side: PaneSide,
  startWidth: number,
  startX: number,
  currentX: number,
): number {
  const delta = currentX - startX;
  return clampPaneWidth(side, side === "sidebar" ? startWidth + delta : startWidth - delta);
}

/**
 * Width after an arrow key on the divider. ArrowRight widens the sidebar and
 * narrows the inspector — the divider physically moves right in both cases,
 * which is what a keyboard user expects from a vertical separator.
 */
export function keyPaneWidth(side: PaneSide, width: number, key: string): number | null {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const dir = key === "ArrowRight" ? 1 : -1;
  const delta = side === "sidebar" ? dir * DIVIDER_KEY_STEP : -dir * DIVIDER_KEY_STEP;
  return clampPaneWidth(side, width + delta);
}
