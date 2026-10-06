/**
 * THESIS - PLATED: every region is a physical plate, and the step is the
 * smallest plate of all.
 *
 * The opposite bet to `engraved`. Instead of taking surfaces away it commits to
 * them and makes them regular: each lane is an enclosed tinted surface with its
 * own heading bar, the node sits on a raised plate carrying its status wash and
 * a soft shadow of the same status colour, the state panel is a card whose head
 * is a tinted strip, and the ledger keeps its frame and its status row accent.
 *
 * The argument: this is the vocabulary the rest of the app speaks (cards,
 * tinted heads, framed tables), and the baseline was a half-measure - it tinted
 * the node and then dropped the panel flat onto the page behind one hairline
 * rule, so the surface read as an unfinished card rather than a deliberate flat
 * one. If the app is made of plates the diagnostic should be too, and the
 * elevation then does a job: a raised node reads as a thing you can press,
 * which is exactly what a node now is.
 *
 * The cost it accepts: more tint competing with the five status colours, and a
 * taller page. It pays for that by making the lane boundary unmistakable and by
 * giving the tally, the legend items and each binding their own enclosure, so
 * no row is left flying empty.
 */
import type { LifecycleSkin } from './types';

export const PLATED: LifecycleSkin = {
  id: 'plated',

  pageGap: 'space-y-4',
  regionWrap: 'rounded-card border border-primary/15 bg-primary/[0.04] p-4 space-y-4',

  headlineWrap: 'mx-auto max-w-prose rounded-card border border-primary/15 bg-background/60 px-4 py-2.5 text-center',
  headlineType: 'typo-body-lg',
  headlineStatusInk: true,

  railWrap: 'flex w-max mx-auto items-start gap-4 px-2',
  laneWrap: 'flex flex-col gap-3 shrink-0 rounded-card border border-primary/15 bg-primary/[0.035] px-4 pb-3 pt-2.5',
  laneHead: 'typo-eyebrow text-primary/85',
  connector: 'bg-primary/30 h-0.5 rounded-full',
  nodeMark: 'plate',
  nodeBacking: 'rounded-modal bg-background shadow-sm shadow-background',
  nodeSelected: 'ring-2 ring-primary ring-offset-2 ring-offset-background',
  nodeLabel: 'typo-caption',
  nodeLabelOn: 'typo-caption font-semibold text-primary',
  dot: 'w-2 h-2 rounded-full',

  legendWrap: 'flex flex-wrap items-center justify-center gap-x-3 gap-y-2',
  legendItem: 'typo-label text-foreground rounded-interactive border border-primary/15 bg-background/50 px-2 py-1',
  legendChip: 'w-4 h-4 rounded-interactive',
  legendNote: 'typo-caption px-1',

  panelWrap: 'rounded-card border border-primary/15 bg-background/50 overflow-hidden',
  panelHead: 'flex items-start gap-3 border-b border-primary/15 bg-primary/[0.06] px-4 py-3',
  panelGlyph: 'w-10 h-10 rounded-card',
  panelTitle: 'typo-section-title',
  panelMeta: 'typo-caption',
  panelTally: 'typo-data text-foreground tabular-nums rounded-interactive bg-foreground/[0.06] px-2 py-0.5',
  panelBody: 'grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-6 gap-y-4 items-start px-4 pb-4 pt-3.5',
  sectionHead: 'typo-eyebrow text-primary/70',
  ruleText: 'typo-body text-foreground leading-relaxed',
  bindingList: 'space-y-1.5',
  bindingRow: 'flex items-start gap-3 rounded-input border border-primary/15 bg-primary/[0.03] px-3 py-2',
  bindingKind: 'typo-body text-foreground',
  bindingChip: 'w-4 h-4 rounded-interactive',

  ledgerDensity: 'compact',
  ledgerRowHeight: 40,
  ledgerBorderless: false,
  ledgerAccent: true,
  regionMinHeight: 'min-h-[27rem]',
  ledgerHeight: 'h-[17rem]',
};
