/**
 * Layout constants for the SwimLane horizontal-flow visualization.
 * All values are SVG user units on the 100x100 viewBox.
 */

/** Outer padding and positional anchors for the three vertical columns (source / hub / agent). */
export const SWIM_LANE_LAYOUT = {
  /** Horizontal padding from the SVG edges. 8 user units keeps node squares clear of the 100-unit bounding box. */
  padX: 8,
  /** Vertical padding from the SVG edges. 6 user units leaves room for the bottom stats label without clipping. */
  padY: 6,
  /** Hub column centered at x=50 so left and right tracks are symmetric. */
  hubX: 50,
  /** Radius used for the agent-side circle nodes. 2.2 keeps glyphs legible at ~280px minimum render height. */
  nodeR: 2.2,
  /** Inward offset of source/agent columns from their respective pad edges, in user units. */
  columnInset: 4,
} as const;

/** Derived horizontal anchors — exported so consumers do not repeat the arithmetic. */
export const SWIM_LANE_DERIVED = {
  /** Usable lane width between the left and right padding. */
  laneW: 100 - SWIM_LANE_LAYOUT.padX * 2,
  /** X-coordinate of the source column (left side). */
  srcX: SWIM_LANE_LAYOUT.padX + SWIM_LANE_LAYOUT.columnInset,
  /** X-coordinate of the agent column (right side). */
  agtX: 100 - SWIM_LANE_LAYOUT.padX - SWIM_LANE_LAYOUT.columnInset,
} as const;

/** Caps on how many nodes each column renders before vertical distribution gets too dense. */
export const SWIM_LANE_LIMITS = {
  /** Max discovered sources drawn on the left column. Beyond 10, labels run into adjacent lane stripes. */
  maxSources: 10,
  /** Max persona agents drawn on the right column. Beyond 8 the agent glyphs start colliding vertically. */
  maxAgents: 8,
  /** Fallback-persona count used when no real personas are present. Kept smaller than `maxAgents` for whitespace. */
  fallbackAgentCount: 6,
  /** Fallback-tool count used when no sources have been discovered. */
  fallbackToolCount: 8,
} as const;

/** Sizing coefficients applied to source nodes based on traffic volume. */
export const SWIM_LANE_NODE_SIZING = {
  /** Base size factor applied so low-traffic sources remain visible. */
  sizeFactorBase: 0.3,
  /** Traffic-weighted size factor range stacked on top of the base. */
  sizeFactorGain: 0.7,
  /** Multiplier applied once a source is past FADE_AFTER_MS. */
  stalenessSizeMultiplier: 0.5,
} as const;
