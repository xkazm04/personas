// THE MAP, three ways.
//
// AUDIT of the Map's current execution, measured rather than asserted:
//   1. `StrategicMap.tsx:115` composes the project frame's head by hand -
//      `flex w-full items-baseline gap-2 truncate rounded-t-card px-2 py-0.5`
//      with one `KT.name` and two `typo-caption`s. A head beside a drawn
//      figure is still furniture, and furniture is the kit's (doctrine 6c).
//   2. `MapTerritory.tsx:91` sets a COUNT in `typo-code` - monospace - two
//      lines under its own file header's rule "monospace only for
//      identifiers".
//   3. THREE radius vocabularies on one surface: `rounded-card` on the frame,
//      `rounded-interactive` on the territory, `rounded-[1px]` on 1,044 plots
//      and `rounded-[2px]` on the legend swatch. At a 2-4px plot the 1px
//      radius costs a paint and buys nothing visible.
//   4. TWO hairlines nested: the frame is `border-primary/15`, the territory
//      inside it `border-card-border`. One nesting level reads as a colour
//      change rather than as an elevation.
//   5. Hierarchy by container opacity: `DIMMED_OPACITY = 0.55` fades a whole
//      territory - its label, its border and its plots together. A second
//      constant of the same name and a different value (0.22) lives in
//      `kpiChartTheme.ts` for the same concept.
//   6. `KT.name === KT.figure === 'typo-data'`, so a frame's label and its
//      denominator are the same size AND the same weight: nothing in the row
//      is emphasised, which is Gate 3's monotone text.
//   7. The ghost uses `bg-primary/[0.06]`, an arbitrary bracket alpha, where
//      the surface it stands in for uses `bg-secondary/10`.
import { treatment, type KpiTreatment } from './kpiTreatment';

/** ATLAS - an engraving. Hairlines do all the grouping, nothing is filled,
 *  and every corner is square so a 3px plot is a true square. */
export const MAP_ATLAS: KpiTreatment = treatment({
  id: 'atlas',
  thesis: 'ruled: hairlines do all the grouping, no fills, square corners',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  // One emphasis per row (Gate 3b): the NAME is the 600, every figure recedes
  // to 400 tabular. Defect 6.
  figure: 'typo-body tabular-nums',
  rule: 'border-primary/20',
  divide: 'divide-primary/20',
  radius: 'rounded-none',
  markRadius: 'rounded-none',
  // An ink mark on the leading edge rather than a fill - a ruled surface that
  // fills on hover stops being ruled.
  rowHover: 'hover:shadow-[inset_2px_0_0_var(--primary)]',
  rowPad: 'py-2',
  surface: '',
  tile: 'border border-primary/20 px-3 py-2',
  frame: 'border border-primary/20',
  // Defect 2: a COUNT is not an identifier, so it leaves monospace.
  markFigure: 'typo-caption tabular-nums',
  cell: 'rounded-none border border-primary/20',
  // One mechanism per fact: the figure's own ink carries the tone. Defect in
  // EstateHeadline (a gradient hairline AND a coloured figure for one state).
  toneLine: false,
});

/** NOCTURNE - night. The canvas is the darkest thing on screen and every
 *  piece of chrome steps up from it on ONE elevation ladder. */
export const MAP_NOCTURNE: KpiTreatment = treatment({
  id: 'nocturne',
  thesis: 'layered: one elevation ladder from the canvas up, one hairline token',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  figure: 'typo-data tabular-nums',
  // ONE hairline for every nesting level, and it is the token, not an alpha.
  // Defect 4.
  rule: 'border-card-border',
  divide: 'divide-card-border',
  radius: 'rounded-card',
  markRadius: 'rounded-interactive',
  rowHover: 'hover:bg-secondary/50',
  surface: 'rounded-card border border-card-border bg-secondary/20 p-3',
  tile: 'rounded-card border border-card-border bg-secondary/50 px-3 py-2.5',
  frame: 'rounded-card border border-card-border bg-secondary/20',
  markFigure: 'typo-caption tabular-nums',
  // Third rung of the ladder: canvas, frame, territory - each one step up.
  cell: 'rounded-card border border-card-border bg-secondary/35',
});

/** SURVEY - a survey sheet. The type ramp is the only hierarchy: labels small
 *  and bold, figures large, and the plot is the only colour on the page. */
export const MAP_SURVEY: KpiTreatment = treatment({
  id: 'survey',
  thesis: 'type-led: labels at type-0/600, figures two tiers up, no second hue',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  // A survey labels small and answers large. `typo-label` is type-0/600 and
  // tracked; the figure sits at type-1/600 above it, the hero at type-6.
  name: 'typo-label',
  figure: 'typo-data tabular-nums',
  hero: 'typo-hero',
  stat: 'typo-data-lg tabular-nums',
  rule: 'border-primary/15',
  divide: 'divide-primary/15',
  radius: 'rounded-card',
  markRadius: 'rounded-none',
  rowHover: 'hover:bg-secondary/25',
  rowPad: 'py-2',
  surface: 'rounded-card border border-card-border bg-background p-3',
  // A tile that is a ruled column rather than a box: the sheet has one
  // surface, so a stat cannot be a second one.
  tile: 'border-l-2 border-card-border px-3 py-1.5',
  frame: 'border border-primary/15 bg-background',
  markFigure: 'typo-label tabular-nums',
  cell: 'rounded-none border border-card-border',
  toneLine: false,
});

export const MAP_TREATMENTS = [MAP_ATLAS, MAP_NOCTURNE, MAP_SURVEY] as const;
