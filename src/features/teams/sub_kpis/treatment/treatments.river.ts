// THE RIVER, three ways.
//
// AUDIT of the River's current execution, measured rather than asserted:
//   1. The headline sentence is a bare `<p className={KT.text}>` between the
//      header's hairline and the chart - `typo-body`, type-1/400, no eyebrow,
//      no rule, no surface. It is the "component flying empty without subtle
//      dividers or structure" the owner names, and it carries the surface's
//      only prose.
//   2. `typo-body` (KT.text) and `typo-caption` (KT.meta) are BOTH type-1/400.
//      The only difference between a sentence and a hint on this surface is
//      `typo-caption`'s 80% ink - hierarchy by ink alpha, with no size or
//      weight step behind it.
//   3. A tributary row stacks `KT.name` over `KT.meta`: TWO type-1 lines, so
//      an eleven-row list is eleven double-height blocks with no size
//      contrast between the place and the sentence about it.
//   4. The only grouping for those eleven rows is `divide-y divide-primary/10
//      border-t border-primary/10` - a 1px rule at 10% alpha - under a section
//      head that is the hand-composed `KT.eyebrow` with `mb-1`.
//   5. `RiverbedChart` hard-codes NINE opacity literals (0.28, 0.22, 0.45,
//      0.85, 0.7) and three dash patterns while `kpiChartTheme.ts` - the file
//      whose header says it is "the one chart vocabulary for sub_kpis" - is
//      imported by neither it nor `RiverTributary`.
//   6. THREE unrelated chart heights with no rhythm between them:
//      `MAIN_HEIGHT = 260`, `DRY_HEIGHT = 120`, tributary `height={34}`.
//   7. The `status === 'failed'` branch is a hand-built `flex items-center
//      gap-3` with a `KT.text` paragraph and a ghost Button - not
//      `ErrorBanner` - and the identical construct is duplicated verbatim in
//      `BookChanges.tsx:56-63`.
//   8. The bed is drawn full-bleed with no frame at all, so the figure and
//      the page have no boundary and the 260px canvas floats.
import { treatment, type KpiTreatment } from './kpiTreatment';

/** STAGE - the figure gets a plate. The bed sits in the app's own chart panel
 *  and the tributaries are rows on the same plate, so nothing floats. */
export const RIVER_STAGE: KpiTreatment = treatment({
  id: 'stage',
  thesis: 'plated: the bed and its tributaries share one framed surface, nothing floats',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  // Defect 2: the surface's only prose gets a real size step (type-2) so it
  // stops reading as a caption that happens to be long.
  text: 'typo-body-lg',
  figure: 'typo-data tabular-nums',
  rule: 'border-primary/15',
  divide: 'divide-primary/15',
  radius: 'rounded-card',
  markRadius: 'rounded-interactive',
  rowHover: 'hover:bg-secondary/25',
  surface: 'rounded-card border border-primary/15 bg-secondary/10 p-4',
  tile: 'rounded-card border border-card-border bg-secondary/30 px-3 py-2',
  // Defect 8: the figure is composed into a frame and free inside it.
  frame: 'rounded-card border border-primary/15 bg-secondary/10 p-3',
});

/** HYDRO - ruled and unfilled. Hairlines and the water are the only marks,
 *  and the rule under a row thickens instead of the row filling. */
export const RIVER_HYDRO: KpiTreatment = treatment({
  id: 'hydro',
  thesis: 'ruled: hairlines and the water are the only marks, no fills at all',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  // Defect 3: the place is the 600, the sentence under it stays 400 muted,
  // and the denominator joins it - one emphasis per row.
  figure: 'typo-body tabular-nums',
  // Defect 4: if a rule is the ONLY grouping it has to be strong enough to be
  // one. 10% alpha at 1px is below the threshold where it reads as structure.
  rule: 'border-primary/25',
  divide: 'divide-primary/25',
  radius: 'rounded-none',
  markRadius: 'rounded-none',
  rowHover: 'hover:shadow-[inset_0_-2px_0_var(--primary)]',
  rowPad: 'py-2',
  surface: '',
  tile: 'border-t-2 border-primary/25 px-2 py-1.5',
  frame: 'border border-primary/25',
  toneLine: false,
});

/** STRATA - bands, not rules. Every tributary is its own low surface with a
 *  gap around it, so eleven rows read as eleven PLACES, not one list. */
export const RIVER_STRATA: KpiTreatment = treatment({
  id: 'strata',
  thesis: 'banded: every tributary is its own surface, separated by gaps not rules',
  eyebrow: 'typo-eyebrow',
  colHead: 'typo-eyebrow',
  figure: 'typo-data tabular-nums',
  rule: 'border-transparent',
  divide: 'divide-transparent',
  radius: 'rounded-card',
  markRadius: 'rounded-interactive',
  rowHover: 'hover:bg-secondary/45',
  rowPad: 'py-3',
  surface: 'rounded-card bg-secondary/20 p-3',
  tile: 'rounded-card bg-secondary/35 px-3 py-2.5',
  frame: 'rounded-card bg-secondary/25 p-3',
  // Defect 4 answered the other way: no rule, a surface per row.
  band: 'rounded-card bg-secondary/20 px-1',
});

export const RIVER_TREATMENTS = [RIVER_STAGE, RIVER_HYDRO, RIVER_STRATA] as const;
