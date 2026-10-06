// THE TREATMENT: the visual execution of a KPI overview theme, as tokens.
//
// The three themes (Map, Ledger, River) are LAYOUTS - where the regions sit,
// what they show, what a click does. None of that lives here. What lives here
// is the other half: which type tier each job gets, how a group is bounded,
// what a row does under the cursor, how deep a surface sits. A treatment is a
// value, so a theme can be re-executed without re-arranging it, and the nine
// treatments below are nine design positions over three unchanged layouts.
//
// Why tokens rather than nine component trees: the audit that produced them
// (see `treatments.*.ts` headers) found the defects in the SHARED parts -
// `KT.eyebrow` composing a section head by hand in four files, one `typo-data`
// doing both "a name" and "a figure" in nine columns, four radius
// vocabularies, two interchangeable hairline alphas. A defect in a shared part
// cannot be fixed by a variant that re-implements the part; it is fixed by
// giving the part a token and letting the treatment decide it.
//
// MEASURED TYPE FACTS this file is built on (src/styles/typography.css):
//   * `typo-eyebrow` is type-0 / 700 / 0.06em / uppercase - the canonical
//     section head. `typo-heading uppercase` (what `KT.eyebrow` is today) is
//     type-1 / 700 / 0.025em: one tier too large and under-tracked.
//   * `typo-body`, `typo-caption` and `typo-data` are ALL type-1. The only
//     differences are weight (400 / 400 / 500) and `typo-caption`'s 80% ink.
//     This font has no Medium, so 500 renders as 600: the real choice at
//     type-1 is 400 or 600, and a treatment that wants "one emphasis per row"
//     (Gate 3b) has to put exactly one of its tiers at 600.
//   * Every token is `calc(var(--type-N) * var(--type-f))`, so no treatment
//     may name a px size: that would opt the element out of Appearance.

/** Which visual execution of a theme is being rendered. */
export type KpiTreatmentId =
  | 'baseline'
  // Map
  | 'atlas'
  | 'nocturne'
  | 'survey'
  // Ledger
  | 'broadsheet'
  | 'panel'
  | 'tally'
  // River
  | 'stage'
  | 'hydro'
  | 'strata';

export interface KpiTreatment {
  id: KpiTreatmentId;
  /** One line, in the owner's words, of what this execution bets on. */
  thesis: string;

  // -- type: nine jobs, and which tier each one gets -----------------------
  /** A name in a row, a list, a tooltip header. */
  name: string;
  /** A sentence or plain value. */
  text: string;
  /** A figure in a row. Tabular wherever a column has to align. */
  figure: string;
  /** Everything secondary: a context line, a hint, a unit. */
  meta: string;
  /** A secondary figure (a rank, a denominator). */
  metaFigure: string;
  /** A figure printed ON a mark - a plot's denominator, a rank chip. The
   *  baseline sets these in `typo-code`, i.e. monospace, two lines under its
   *  own file header's rule "monospace only for identifiers". */
  markFigure: string;
  /** A section head inside a surface or a tooltip. */
  eyebrow: string;
  /** The one figure a surface leads with. */
  hero: string;
  /** A stat tile's figure - one step under the hero. */
  stat: string;
  /** A column head in the books, or a frame label on the map. */
  colHead: string;

  // -- chrome: how a thing is bounded, filled and separated ----------------
  /** The hairline utility that separates a header from its content. */
  rule: string;
  /** The divider utility for a ruled list. */
  divide: string;
  /** The radius for a panel-sized surface. */
  radius: string;
  /** The radius for a mark: a swatch, a plot, a rank chip. */
  markRadius: string;
  /** What an interactive row does under the cursor. */
  rowHover: string;
  /** A row's vertical rhythm. */
  rowPad: string;
  /** A grouped region's surface, or '' when the treatment uses no fills. */
  surface: string;
  /** One stat tile's chrome. */
  tile: string;
  /** A framed figure: the map's project frame, the river's bed. */
  frame: string;
  /** An inner cell inside a frame - one map territory. */
  cell: string;
  /** A per-row surface, for treatments that band instead of ruling. */
  band: string;
  /** Whether a stat tile draws its tone as a hairline as WELL as inking the
   *  figure. Two mechanisms for one fact is the baseline's defect. */
  toneLine: boolean;
}

/**
 * THE CURRENT LOOK, token for token - the default for every theme, so nothing
 * changes for a user until the owner picks something else. Every value here is
 * transcribed from the surface it was read off, not chosen.
 */
export const BASELINE_TREATMENT: KpiTreatment = {
  id: 'baseline',
  thesis: 'the current look, unchanged',
  name: 'typo-data',
  text: 'typo-body',
  figure: 'typo-data',
  meta: 'typo-caption',
  metaFigure: 'typo-caption tabular-nums',
  markFigure: 'typo-code tabular-nums',
  eyebrow: 'typo-heading uppercase',
  hero: 'typo-data-lg',
  stat: 'typo-heading-lg tabular-nums',
  colHead: 'typo-label',
  rule: 'border-primary/10',
  divide: 'divide-primary/10',
  radius: 'rounded-card',
  markRadius: 'rounded-[2px]',
  rowHover: 'hover:bg-secondary/30',
  rowPad: 'py-2.5',
  surface: '',
  tile: 'border border-card-border bg-gradient-to-b from-secondary/40 to-secondary/10 px-3 py-2',
  frame: 'border border-primary/15',
  cell: 'rounded-interactive border border-card-border bg-secondary/10',
  band: '',
  toneLine: true,
};

/** A treatment stated as its difference from the baseline, so a diff reads as
 *  a list of decisions rather than a wall of re-typed tokens. */
export function treatment(over: Partial<KpiTreatment> & Pick<KpiTreatment, 'id' | 'thesis'>): KpiTreatment {
  return { ...BASELINE_TREATMENT, ...over };
}
