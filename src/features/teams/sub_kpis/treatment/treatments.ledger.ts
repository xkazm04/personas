// THE LEDGER, three ways.
//
// AUDIT of the Ledger's current execution, measured rather than asserted:
//   1. NINE columns and every numeric cell at `KT.figure` (= `typo-data`,
//      which renders 600 because this font has no Medium). A row therefore
//      carries nine 600-weight cells, so Gate 3b's "one emphasis per row" is
//      missed nine times over. Only `Debt` steps a ZERO down to `metaFigure`.
//   2. `Th` is `pb-2 pr-3 typo-label` - type-0/600, not uppercase, not
//      tracked - so the header row reads as a slightly bolder data row. The
//      canonical head is `typo-eyebrow` (type-0/700/0.06em/uppercase).
//   3. `KT.eyebrow` is `typo-heading uppercase`: a section head composed by
//      hand at type-1 with 0.025em tracking, in `BookChanges.tsx:68` and
//      `BookPreview.tsx:32`. The module already uses the real `typo-eyebrow`
//      in ten other places, so it contradicts itself.
//   4. `tfoot` carries no top rule and no fill - the totals row is visually
//      identical to a data row apart from its colSpan.
//   5. `border-b border-primary/10` is repeated on the head row AND on every
//      body row, and `py-2.5` on nine cells of every row: the row rhythm is
//      hand-maintained in two files.
//   6. TWO bars stacked in one cell - `CoverageBar` at 8px, `SizeBar` at 3px,
//      plus `mt-1` - is 12px of chart inside a ~44px row, and `SizeBar` paints
//      `bg-primary/50` on `bg-secondary/40`: a 50% tint of the brand hue used
//      as a quantity.
//   7. `ChangeChip` sets BOTH the KPI name and its state transition at
//      `typo-caption`, so the chip is monotone and the name has no more
//      weight than the thing that happened to it.
import { treatment, type KpiTreatment } from './kpiTreatment';

/** BROADSHEET - a printed financial table. Tracked uppercase heads over a
 *  rule, zero fills anywhere, and exactly one emphasis per row: the name. */
export const LEDGER_BROADSHEET: KpiTreatment = treatment({
  id: 'broadsheet',
  thesis: 'printed: tracked heads over a rule, no fills, figures in tabular 400',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  // Defect 1: nine 600-weight columns become nine 400-weight columns, and the
  // name is the only thing in the row set at 600.
  figure: 'typo-body tabular-nums',
  rule: 'border-foreground/15',
  divide: 'divide-foreground/10',
  radius: 'rounded-none',
  markRadius: 'rounded-none',
  rowHover: 'hover:shadow-[inset_2px_0_0_var(--primary)]',
  rowPad: 'py-2',
  surface: '',
  tile: 'border-b border-foreground/15 px-1 py-1.5',
  band: 'border-t-2 border-foreground/20',
  // Defect 4: the totals rule is a double rule, as a printed ledger's is.
  frame: 'border-y-2 border-foreground/20',
  toneLine: false,
});

/** PANEL - the books on a card. The head and the totals are filled bands and
 *  RHYTHM replaces the row rules, so nothing is drawn that spacing can say. */
export const LEDGER_PANEL: KpiTreatment = treatment({
  id: 'panel',
  thesis: 'layered: head and totals are filled bands, rhythm replaces the row rules',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  figure: 'typo-data tabular-nums',
  // Defect 5: no per-row rule at all. A table that bands its head and its
  // totals does not also need to draw 40 hairlines.
  rule: 'border-transparent',
  divide: 'divide-transparent',
  radius: 'rounded-card',
  markRadius: 'rounded-interactive',
  rowHover: 'hover:bg-secondary/35',
  rowPad: 'py-3',
  surface: 'rounded-card border border-card-border bg-secondary/15 p-3',
  tile: 'rounded-card border border-card-border bg-secondary/40 px-3 py-2.5',
  frame: 'rounded-card border border-card-border bg-secondary/15',
  band: 'rounded-interactive bg-secondary/30',
});

/** TALLY - a working ledger. The FIGURES carry the weight, names drop to 400,
 *  and the composition bar is the only colour on the page. */
export const LEDGER_TALLY: KpiTreatment = treatment({
  id: 'tally',
  thesis: 'figure-led: numbers at 600, names at 400, the bar is the only colour',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-label',
  // The inverse of broadsheet, and a real position: a ledger is read down its
  // columns, so the column is what gets the weight. Still ONE emphasis.
  name: 'typo-body',
  figure: 'typo-data tabular-nums',
  radius: 'rounded-interactive',
  markRadius: 'rounded-none',
  rowHover: 'hover:bg-secondary/20',
  rowPad: 'py-1.5',
  tile: 'border border-card-border bg-secondary/25 px-2.5 py-1.5',
  frame: 'border border-primary/10',
});

export const LEDGER_TREATMENTS = [LEDGER_BROADSHEET, LEDGER_PANEL, LEDGER_TALLY] as const;
