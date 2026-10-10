/**
 * One command as a row-instrument in the gate / tests runs: what ran (its
 * kind's glyph and the command), its signals (flaky, slowing down), how its
 * shown run came out, its run history drawn (`gate/RunChart`: bars by
 * outcome against the budget line and the median band), that run's time
 * against the budget (the budget editable in place) and its pass rate with n.
 * A bar's press opens the run; its first error also opens under the row.
 *
 * With a past Measure picked (`measureId`), the row shows THAT Measure's run
 * (matched by `measureId`): its outcome and time, its bar ringed, the row
 * raised. A command with no run in that Measure says so.
 *
 * Asked for by the screen (`stepFocus` = `run:<commandId>`, the Next panel's
 * "Open the run"), the row scrolls into view with its error open and the run
 * viewer opens on its latest run, once.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ListRow } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { KIND_GLYPH } from '../measure/kindGlyph';
import { lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { RunPill } from '../system/Pill';
import { GLYPH } from '../system/scales';
import { BudgetCell } from './gate/BudgetCell';
import type { InstrumentRow } from './gate/gateView';
import { RunChart } from './gate/RunChart';
import { SignalChips } from './gate/SignalChips';
import type { BudgetEditState } from './gate/useBudgetEdit';
import { useKindLabel } from './useKindLabel';

function PassRate({ row }: { row: InstrumentRow }) {
  const { dl, tx } = useLifecycleViewModel();
  if (row.passRate == null) return <span className={LT.rowNum} data-na="true">{dl.lc1_na}</span>;
  return (
    <span className="flex flex-col items-end">
      <Numeric value={row.passRate} unit="percent" precision={0} className={`${LT.rowNum} ${row.passRate < 100 ? 'text-status-warning' : ''}`} />
      <span className={LT.metaNum}>{tx(dl.lc1_samples, { count: row.answered })}</span>
    </span>
  );
}

/**
 * Open the row's error and the run viewer when the screen asks for this run.
 * The row is found by its test id: a kit row must stay a direct child of its
 * list (the columns are the list's grid), so it carries no wrapper to hold a ref.
 */
function useRunFocus(commandId: string, open: () => void) {
  const { stepFocus, clearStepFocus } = useLifecycleViewModel();
  const reduced = useReducedMotion();
  const asked = stepFocus === `run:${commandId}`;
  useEffect(() => {
    if (!asked) return;
    open();
    clearStepFocus();
    // `?.()`: a DOM without layout (a test's) has no scrollIntoView.
    document.querySelector(`[data-testid="lc2-cmd-${commandId}"]`)?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [asked, open, clearStepFocus, reduced, commandId]);
}

interface CommandLineProps {
  row: InstrumentRow;
  measureId: string | null;
  /** Bar slots every row's chart shares. */
  slots: number;
  budget: BudgetEditState;
  onOpen: (row: InstrumentRow, run: LifecycleRun) => void;
}

export function CommandLine({ row, measureId, slots, budget, onOpen }: CommandLineProps) {
  const { dl, tx } = useLifecycleViewModel();
  const kind = useKindLabel();
  const [open, setOpen] = useState(false);
  // Runs only while the screen's ask is pending (the effect clears it at once).
  useRunFocus(row.commandId, useCallback(() => {
    setOpen(true);
    if (row.latest) onOpen(row, row.latest);
  }, [row, onOpen]));
  const run = row.shown;
  const hit = measureId !== null && run !== null;
  const Glyph = KIND_GLYPH[row.kind];
  const errorRun = run?.firstError ? run : row.runs.find((r) => r.firstError) ?? null;
  return (
    <>
      <ListRow
        size="l"
        name={(
          <span className="flex min-w-0 items-center gap-2">
            <Glyph aria-hidden className={`${GLYPH.sm} shrink-0 text-primary`} />
            <span className={`truncate ${LT.code}`}>{row.command}</span>
          </span>
        )}
        meta={(
          <>
            <span>{kind(row.kind)}</span>
            <span>{tx(dl.lc2_median, { value: row.medianMs == null ? dl.lc1_na : formatNumeric(row.medianMs, 'ms') })}</span>
          </>
        )}
        state={hit ? 'selected' : undefined}
        cells={[
          <span className="flex flex-col items-start gap-1">
            {run ? <RunPill outcome={run.outcome} /> : <span className={LT.row}>{measureId ? dl.lcx3_not_in_measure : dl.lc2_never_ran}</span>}
            <SignalChips signals={row.signals} commandId={row.commandId} />
          </span>,
          <RunChart
            runsNewestFirst={row.runs}
            budgetMs={row.budgetMs}
            command={row.command}
            slots={slots}
            markRunId={hit ? run.id : null}
            onOpen={(r) => onOpen(row, r)}
            testId={`lc2-spark-${row.commandId}`}
          />,
          <BudgetCell row={row} edit={budget} />,
          <PassRate row={row} />,
        ]}
        // Every row carries the toggle's width, so a row with an error lines up with one without.
        figures={row.firstError ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-label={open ? dl.lc2_hide_error : dl.lc2_show_error}
            onClick={() => setOpen((o) => !o)}
            data-testid={`lc2-error-toggle-${row.commandId}`}
          >
            <ChevronDown className={`${GLYPH.sm} transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        ) : <span aria-hidden className="block h-7 w-7" />}
        testId={`lc2-cmd-${row.commandId}`}
      />
      {row.firstError && (
        <Collapse open={open} unmountWhenClosed>
          <div className={`mx-4 mb-3 mt-1 flex items-start gap-3 ${lcSurface('plate', 'border border-status-error/30 bg-status-error/5')}`}>
            <pre className={`min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap ${LT.code}`} data-testid={`lc2-error-${row.commandId}`}>
              {row.firstError}
            </pre>
            {errorRun && (
              <Button variant="secondary" size="sm" icon={<FileText className={GLYPH.sm} />} onClick={() => onOpen(row, errorRun)} data-testid={`lc6-open-run-${row.commandId}`}>
                {dl.lcx6_open_run}
              </Button>
            )}
          </div>
        </Collapse>
      )}
    </>
  );
}
