/**
 * THESIS - ENGRAVED: the journey is cut into the surface, not placed on it.
 *
 * No fill anywhere. Every mark is a stroke, every head is a tracked eyebrow
 * sitting on a rule, and the two lanes are divided by a visible rule instead of
 * a gap and a `role="group"` nobody can see. The ledger drops its frame and
 * lets the rows breathe at comfortable height, so the page reads as one sheet
 * of ruled paper rather than three stacked boxes.
 *
 * The argument: this surface is a diagnostic, and every tint it spends on
 * decoration is a tint it cannot spend on a status. With fills gone, the only
 * coloured things left on the page are the five state strokes, the severity ink
 * on the headline, and a failed row in the ledger - so colour MEANS something
 * everywhere it appears. The rule-and-eyebrow pairing gives back the structure
 * the tint was carrying, which answers the owner's "nothing flying empty
 * without subtle dividers" with rules rather than with surfaces.
 *
 * The right angles are deliberate and total: square marks, square chips, square
 * dots. A stroke-only vocabulary needs its corners to read, and a 1px hairline
 * on a 6px radius loses half its visible length to the curve.
 */
import type { LifecycleSkin } from './types';

export const ENGRAVED: LifecycleSkin = {
  id: 'engraved',

  pageGap: 'space-y-6',
  regionWrap: 'border-t border-foreground/15 pt-6 space-y-5',

  headlineWrap: 'mx-auto max-w-prose border-l-2 border-primary/40 pl-3',
  headlineType: 'typo-body-lg',
  headlineStatusInk: true,

  railWrap: 'flex w-max mx-auto items-stretch divide-x divide-foreground/15 px-2',
  laneWrap: 'flex flex-col gap-3 shrink-0 px-5 first:pl-0 last:pr-0',
  laneHead: 'typo-eyebrow text-foreground border-b border-foreground/15 pb-1.5',
  connector: 'bg-foreground/20 h-px',
  nodeMark: 'stroke',
  nodeBacking: 'rounded-modal bg-background',
  nodeSelected: 'ring-1 ring-primary ring-offset-2 ring-offset-background',
  nodeLabel: 'typo-caption',
  nodeLabelOn: 'typo-caption font-semibold text-primary',
  dot: 'w-1.5 h-1.5 rounded-none',

  legendWrap: 'flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-y border-foreground/15 py-2',
  legendItem: 'typo-label text-foreground',
  legendChip: 'w-[18px] h-[18px] rounded-none',
  legendNote: 'typo-caption italic',

  panelWrap: 'space-y-5',
  panelHead: 'flex items-start gap-3 border-b border-foreground/15 pb-3',
  panelGlyph: 'w-10 h-10 rounded-none',
  panelTitle: 'typo-section-title',
  panelMeta: 'typo-caption',
  panelTally: 'typo-data text-foreground tabular-nums',
  panelBody: 'grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-6 gap-y-4 items-start gap-y-5',
  sectionHead: 'typo-eyebrow text-foreground border-b border-foreground/15 pb-1',
  ruleText: 'typo-body text-foreground leading-relaxed',
  bindingList: 'divide-y divide-foreground/15 border-t border-foreground/15',
  bindingRow: 'flex items-start gap-3 py-2',
  bindingKind: 'typo-body text-foreground',
  bindingChip: 'w-[18px] h-[18px] rounded-none',

  ledgerDensity: 'comfortable',
  ledgerRowHeight: 44,
  ledgerBorderless: true,
  ledgerAccent: true,
  regionMinHeight: 'min-h-[27rem]',
  ledgerHeight: 'h-[18rem]',
};
