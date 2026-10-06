/**
 * THESIS - WASH: the state is a colour the step is soaked in.
 *
 * The default, and the closest thing to the surface the owner kept: tinted node
 * marks, a panel that sits flat on the page separated only by rules, a compact
 * framed ledger, a centred legend. What is NEW is craft, not arrangement:
 *
 *  - one type step per role, with WEIGHT carrying selection instead of a step
 *    DOWN to `typo-label` (the old rail shrank a node's caption as it gained
 *    emphasis, so arrow-walking made the whole caption row wobble);
 *  - `typo-eyebrow` for all four section heads, which were `typo-card-label` -
 *    a glow token for card titles - so a diagnostic panel had four glowing
 *    mini-heads and no section vocabulary;
 *  - the weakest-step sentence inked with the weakest step's own status colour,
 *    because the model already knows the severity and the sentence was reading
 *    exactly like the legend footnote beneath it;
 *  - a legend whose chips are 16px, the size at which a 2px dash renders as
 *    more than one dash per side.
 */
import type { LifecycleSkin } from './types';

export const WASH: LifecycleSkin = {
  id: 'wash',

  pageGap: 'space-y-5',
  regionWrap: 'border-t border-primary/15 pt-5 space-y-4',

  headlineWrap: 'text-center',
  headlineType: 'typo-body-lg',
  headlineStatusInk: true,

  railWrap: 'flex w-max mx-auto items-start gap-10 px-2',
  laneWrap: 'flex flex-col gap-2.5 shrink-0',
  laneHead: 'typo-eyebrow text-primary/80',
  connector: 'bg-primary/25 h-px',
  nodeMark: 'wash',
  nodeBacking: 'rounded-modal bg-background',
  nodeSelected: 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background',
  nodeLabel: 'typo-caption',
  nodeLabelOn: 'typo-caption font-semibold text-primary',
  dot: 'w-1.5 h-1.5 rounded-full',

  legendWrap: 'flex flex-wrap items-center justify-center gap-x-5 gap-y-2',
  legendItem: 'typo-label text-foreground',
  legendChip: 'w-4 h-4 rounded-interactive',
  legendNote: 'typo-caption',

  panelWrap: 'space-y-4',
  panelHead: 'flex items-start gap-3',
  panelGlyph: 'w-10 h-10 rounded-card',
  panelTitle: 'typo-section-title',
  panelMeta: 'typo-caption',
  panelTally: 'typo-data text-foreground tabular-nums',
  panelBody: 'grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-x-6 gap-y-4 items-start',
  sectionHead: 'typo-eyebrow text-foreground',
  ruleText: 'typo-body text-foreground leading-relaxed',
  bindingList: 'divide-y divide-primary/10 rounded-card border border-primary/15 overflow-hidden',
  bindingRow: 'flex items-start gap-3 px-3 py-2',
  bindingKind: 'typo-body text-foreground',
  bindingChip: 'w-4 h-4 rounded-interactive',

  ledgerDensity: 'compact',
  ledgerRowHeight: 40,
  ledgerBorderless: false,
  ledgerAccent: true,
  regionMinHeight: 'min-h-[26rem]',
  ledgerHeight: 'h-[17rem]',
};
