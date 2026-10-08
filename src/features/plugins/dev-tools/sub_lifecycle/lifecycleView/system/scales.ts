// THE SCALES of the Lifecycle module: gauge, glyph and key sizes by NAME. The
// audit (2026-10-08) found gauges at 52 / 112 / 176 px and glyphs at h-5 / h-6
// / h-8 / h-14 with nothing relating them; a caller now says `md`, and the step
// from one size to the next is the same everywhere.

/** Drawn rates (ArcGauge): outer size and stroke in px. */
export const GAUGE = {
  /** A satellite beside its figure. */
  sm: { size: 56, stroke: 6 },
  /** A collar's arc on the rail; the not-measured card. */
  md: { size: 108, stroke: 9 },
  /** The Layer-2 instrument, the one hero drawing on a screen. */
  lg: { size: 184, stroke: 12 },
} as const;

export type GaugeSize = keyof typeof GAUGE;

/** Icon boxes. */
export const GLYPH = {
  /** Inside a pill, a legend chip, a small button. */
  sm: 'h-4 w-4',
  /** On a rail key, beside a group head, the page icon. */
  md: 'h-5 w-5',
  /** On the Layer-2 key. */
  lg: 'h-6 w-6',
  /** At the centre of the hero instrument. */
  xl: 'h-8 w-8',
} as const;

export type GlyphSize = keyof typeof GLYPH;

/** Key caps (TactileKeys): a rail card's key, the Layer-2 header's key. */
export const KEY = {
  /** In a rail card's head row, beside the step's name. */
  sm: 'h-7 w-7',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
} as const;

/**
 * The rail's linear figure (`rail/Meter`): the track a card's main rate fills,
 * and the marks on it (the earlier measure, the threshold). The track sits at
 * one height in every card, so the pipe that joins the cards runs through all
 * of them on one line.
 */
export const METER = {
  track: 'h-1.5',
  /** A mark's height: taller than the track, so it reads over a full fill. */
  mark: 'h-3.5',
  /** The earlier measure's bead. */
  bead: 'h-2.5 w-2.5',
} as const;

/** The slot a rail key sits in (the key plus its seat travel). */
export const KEY_SLOT = 'h-12';
