/**
 * Layout/visual constants for the TimelinePlayer replay bar and its density markers.
 * Opacity values are unitless (0..1); counts are integer bins.
 */

/** Event density heatmap settings behind the scrub track. */
export const TIMELINE_DENSITY = {
  /** Number of histogram bins drawn across the scrub track. 60 aligns with the 24h=60min intuition and stays under 1 DOM node per px at minimum track widths. */
  bins: 60,
  /** Minimum opacity for a bin that contains at least one event. Below 0.1 the marker is visually indistinguishable from the empty track. */
  minOpacity: 0.1,
  /** Maximum opacity for the busiest bin. Above 0.4 the density layer drowns out the playhead/progress fill. */
  maxOpacity: 0.4,
} as const;
