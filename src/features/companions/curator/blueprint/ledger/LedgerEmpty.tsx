/**
 * What the ledger body says when it has no rows - said ONCE, quietly, in the
 * place the rows would be.
 *
 * The rendering goes through the shared `feedback/ScenarioEmptyState` (the
 * `local-empty-state` census rule, docs/concepts/golden-paths/empty-and-demo-states.md):
 * `LedgerBody` wraps it in a `.cb-lrow.cb-lempty` line so it still sits inside
 * `.cb-lscroll`, under the real head and above the real bands, on the ledger's
 * own grid. This file owns only the part that is the ledger's: which phase it
 * is in and the words for each.
 *
 * ## The three phases, and why they are three
 *
 * Two of them are in flight and one is not, and conflating them is how a
 * surface tells an operator "nothing here" while it is still reading:
 *
 * - `reading`  - the first read of the session has not come back yet.
 * - `running`  - the instrument is walking the corpus right now.
 * - `unrun`    - the read came back and there is no projection. Run me.
 *
 * None of the three carries a run control: the console above owns exactly one,
 * in every phase. Two buttons for one act is what the old empty state had.
 */
import type { BlueprintStrings } from '../words';

/** Which unpopulated phase the page is in. Only consulted when `rows` is null. */
export type BlueprintPhase = 'reading' | 'running' | 'unrun';

/** The title and body the unpopulated ledger says in `phase`. */
export function ledgerPhaseCopy(
  w: BlueprintStrings,
  phase: BlueprintPhase,
): { title: string; subtitle: string } {
  return phase === 'running'
    ? { title: w.console.refresh_title, subtitle: w.console.refresh_body }
    : phase === 'reading'
      ? { title: w.boot_title, subtitle: w.boot_body }
      : { title: w.no_plan_title, subtitle: w.no_plan_body };
}
