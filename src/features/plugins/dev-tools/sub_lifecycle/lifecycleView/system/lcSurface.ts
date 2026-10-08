// THE GEOMETRY ROLES of the Lifecycle module: one radius, one padding, one
// border and one depth per role, and the rhythm between blocks. The audit
// (2026-10-08) found six card paddings, three panel treatments, a raised and a
// sunken count badge and three rhythms for the same jobs; each job is named here
// once, and a component asks for its role by name.
//
// A role's FILL may carry a meaning (a verdict's outline and wash on a collar or
// the hero band); its shape and padding never change with it, so a verdict
// recolours a card without resizing it.

export type SurfaceRole = 'panel' | 'lane' | 'node' | 'card' | 'plate' | 'chip';

/** Radius per role. */
const SHAPE: Record<SurfaceRole, string> = {
  panel: 'rounded-modal',
  lane: 'rounded-modal',
  node: 'rounded-card',
  card: 'rounded-card',
  plate: 'rounded-card',
  chip: 'rounded-interactive',
};

/** Padding per role. */
const PAD: Record<SurfaceRole, string> = {
  panel: 'px-5 py-4',
  lane: 'px-2 py-2.5',
  node: 'px-2.5 py-2',
  card: 'px-3 py-3',
  plate: 'px-4 py-3',
  chip: 'px-2.5 py-1.5',
};

/**
 * Border and depth per role, when no meaning colours it:
 * - panel: a recessed tray (the hero band, a preset's section);
 * - lane: the rail's recessed tray, padded tighter than a panel so six cards
 *   keep their figure on one line at 1280 wide;
 * - node: a step's card on the rail: a card with a 2px outline (the verdict's
 *   stroke) and tighter padding, so a lane of six fits 1280 wide;
 * - card: a raised object that sits ON a panel (a rail card, a satellite, an editor row);
 * - plate: a flat label plate for a sentence (the headline, a rule, an error line);
 * - chip: a small raised stat inside a card.
 */
const FILL: Record<SurfaceRole, string> = {
  panel: 'border border-primary/10 bg-secondary/30 shadow-inner',
  lane: 'border border-primary/10 bg-secondary/30 shadow-inner',
  node: 'border-2 border-primary/15 bg-background shadow-elevation-1',
  card: 'border border-primary/15 bg-background shadow-elevation-1',
  plate: 'border border-primary/15 bg-secondary/40',
  chip: 'bg-background shadow-elevation-1',
};

/** A role's whole class: shape, padding and fill (`fill` replaces the neutral fill with a meaning). */
export function lcSurface(role: SurfaceRole, fill?: string): string {
  return `${SHAPE[role]} ${PAD[role]} ${fill ?? FILL[role]}`;
}

/** A role's shape only, for a ghost or a press target that must match it. */
export function lcShape(role: SurfaceRole): string {
  return SHAPE[role];
}

/** The one count badge (a tray's step count, a legend count, a tally). */
export const LC_COUNT = 'inline-flex min-w-6 items-center justify-center rounded-pill bg-secondary/60 px-1.5';

/** The hairline between a head and its content, and between rows. */
export const LC_RULE = 'border-primary/10';

/**
 * Rhythm. `section` separates the page's sections, `block` the blocks inside
 * one, `tight` a label from its value; `inline` and `inlineWide` are the gaps in
 * a row of controls or of figures.
 */
export const RHYTHM = {
  section: 'space-y-8',
  block: 'space-y-4',
  tight: 'space-y-1.5',
  inline: 'gap-3',
  inlineWide: 'gap-x-8 gap-y-4',
} as const;

/**
 * The rail's geometry, shared by the rail and its ghost so the two lanes start
 * and end at the same place.
 *
 * - `gapRem`: the gutter between two cards in a lane. The pipe that joins them
 *   crosses it (and each card's own padding) on the meters' line.
 * - `padRem`: a rail card's horizontal padding (the `node` role's `px-2.5`),
 *   which the pipe also crosses.
 * - `laneGap`: the space between the two lanes, and between the status band
 *   and the first lane.
 *
 * The lanes are stacked, each a single row of equal columns: at 1280 wide the
 * content column is ~910px, so the After lane's six cards are ~138px each and
 * the Before lane's four ~215px. A lane never wraps into an orphan row.
 */
export const RAIL = {
  gapRem: 0.75,
  padRem: 0.625,
  laneGap: 'space-y-3',
} as const;
