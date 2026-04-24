/**
 * Layout and animation constants for the EventBus radial visualization.
 * Numeric units are SVG user units on the 100x100 viewBox unless suffixed with Ms (milliseconds).
 */

/** Caps on how many nodes the rings will render before they start to overlap labels / crowd. */
export const EVENT_BUS_LIMITS = {
  /** Max discovered sources placed on the outer ring. Beyond 14 the label arcs collide at 100-unit radius. */
  maxOuterSources: 14,
  /** Max personas placed on the inner ring. Beyond 10 persona glyphs visibly overlap at the inner-ring radius. */
  maxInnerPersonas: 10,
  /** Max concurrent return-flow comets kept in state. Older flows are dropped FIFO to cap re-render cost. */
  maxReturnFlows: 50,
  /** Ceiling for the `spawnedRef` dedupe set before it is cleared to avoid unbounded growth in long sessions. */
  spawnedSetCeiling: 200,
} as const;

/** Timings for particle/flow animations. All values in milliseconds. */
export const EVENT_BUS_TIMING_MS = {
  /** Minimum per-event processing duration. Below 1200ms the comet is hard to follow visually. */
  processingMinMs: 1200,
  /** Jitter added on top of the minimum (uniform 0..jitter). 1800ms of jitter keeps traffic organic without stalling > ~3s. */
  processingJitterMs: 1800,
  /** Polling interval for expiring stale return-flows. 300ms is tight enough for perceived smoothness without re-rendering every frame. */
  returnFlowSweepIntervalMs: 300,
} as const;

/** Sizing coefficients applied to source nodes based on traffic volume. */
export const EVENT_BUS_NODE_SIZING = {
  /** Base size factor applied to every node so low-traffic sources stay visible. */
  sizeFactorBase: 0.3,
  /** Traffic-weighted size factor range, added on top of the base. */
  sizeFactorGain: 0.7,
  /** Multiplier applied to the size factor once a source is considered stale (past FADE_AFTER_MS). */
  stalenessSizeMultiplier: 0.5,
} as const;
