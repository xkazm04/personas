// THE TYPE SCALE the three overview surfaces share (Map, Ledger, River), and
// the tooltips and rails that belong to them.
//
// Taken from the two surfaces the operator points at when asked what reads
// well in this app, rather than invented:
//
//  * Events (`overview/sub_events`): ONE size for everything in a row. Names,
//    values and sentences are all 0.875rem; hierarchy is weight and tone, never
//    a third font size. Monospace only for identifiers.
//  * Manifest (`shared/components/document`): a header separated from its
//    content by a hairline, small tracked uppercase section heads, and a single
//    muted tone for everything secondary.
//
// One trap this file exists to avoid. `typography.css` is UNLAYERED, so a
// `typo-*` class beats any Tailwind colour utility put beside it - and two of
// them carry a colour of their own. `typo-title` is tinted toward the primary
// hue, which is why every name set in it read cyan; `typo-caption` is
// foreground at 70%, which is the app's muting. So: names and figures use
// `typo-data` (foreground, 500), prose uses `typo-body` (foreground, 400), and
// anything secondary uses `typo-caption` - one muting, applied one way. Adding
// `text-foreground` beside a typo class changes nothing and is not done here.
//
// A token that combines a `typo-*` with a `font-*` weight is also avoided: the
// census rule `typo-token-overpainted` counts it, because the weight fights the
// token instead of choosing one.

export const KT = {
  /** A name in a row, a list, a tooltip header. */
  name: 'typo-data',
  /** A sentence or plain value in a row. */
  text: 'typo-body',
  /** A figure in a row: same size, tabular so a column aligns. */
  figure: 'typo-data tabular-nums',
  /** Everything secondary: a context line, a hint, a unit. The one muting. */
  meta: 'typo-caption',
  /** A secondary figure (a rank, a denominator). */
  metaFigure: 'typo-caption tabular-nums',
  /** A section head inside a surface or a tooltip: exactly the content
   *  grammar's `ContentEyebrow` (the execution detail's "SUGGESTED ACTIONS"),
   *  so a KPI section head and an execution section head are one thing. */
  eyebrow: 'typo-heading uppercase tracking-wider',
  /** The one figure a surface leads with. */
  hero: 'typo-data-lg tabular-nums',
  /** A stat card's figure: one step under the hero, so the hero still leads. */
  stat: 'typo-heading-lg tabular-nums',
} as const;

/** The hairline that separates a header from its content, and rows from each
 *  other - the Manifest header's rule and the Events table's row line. */
export const KT_RULE = 'border-primary/10';
