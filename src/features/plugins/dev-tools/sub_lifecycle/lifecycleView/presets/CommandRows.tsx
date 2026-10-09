/**
 * The per-command rows of a gate / tests step, each a row-instrument
 * (`CommandLine`): what ran, how it came out, its run history drawn, its time
 * against its budget and its pass rate. The slowest command is named in the
 * section's head line; a compact toolbar orders and filters the rows
 * (`gate/GateToolbar`, remembered per step); how to read the charts and what
 * the times measure is said once, under the rows.
 *
 * With a past Measure picked (`measureId`, the page's time cursor), each row
 * shows THAT Measure's run instead of the latest, and the first such row is
 * scrolled into view.
 *
 * A budget saved in place is announced on the line under the rows, which is
 * always mounted so the result is heard when its text arrives.
 */
import { useEffect, useRef } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { Rows, Section, type RowColumn } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { CommandLine } from './CommandLine';
import { ChartLegend } from './gate/ChartLegend';
import { GateToolbar } from './gate/GateToolbar';
import { filterCounts, viewRows, type GateFilter, type GateViewState, type InstrumentRow } from './gate/gateView';
import type { BudgetEditState } from './gate/useBudgetEdit';
import { SPARK_RUNS, slowest } from './gateModel';

interface CommandRowsProps {
  rows: InstrumentRow[];
  loading: boolean;
  unavailable: boolean;
  /** The picked past Measure whose runs the rows show; null = the latest runs. */
  measureId?: string | null;
  view: GateViewState;
  onView: (view: GateViewState) => void;
  budget: BudgetEditState;
  onOpen: (row: InstrumentRow, run: LifecycleRun) => void;
}

export function CommandRows({ rows, loading, unavailable, measureId = null, view, onView, budget, onOpen }: CommandRowsProps) {
  const { dl, tx } = useLifecycleViewModel();
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const slow = slowest(rows);
  const shown = viewRows(rows, view);
  const counts = filterCounts(rows);
  // Every row's chart shares one bar width: the busiest command fills its chart.
  const slots = Math.min(SPARK_RUNS, Math.max(12, ...rows.map((r) => r.runs.length)));
  useEffect(() => {
    if (!measureId) return;
    // `?.()`: a DOM without layout (a test's) has no scrollIntoView.
    host.current?.querySelector('[data-kit-state~="selected"]')?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [measureId, reduced]);
  const columns: RowColumn[] = [
    { head: measureId ? dl.lcx3_col_viewed : dl.lc2_col_latest, width: '9rem' },
    { head: dl.lcx6_col_runs, width: '1.25fr', collapse: true },
    { head: dl.lcx6_col_time, width: '9rem' },
    { head: dl.lc2_col_pass, width: '4.5rem', align: 'end' },
  ];
  const meta = slow?.latest ? (
    <span data-testid="lc2-slowest">
      {tx(dl.lc2_slowest, { command: slow.command, time: formatNumeric(slow.latest.durationMs, 'ms') })}
    </span>
  ) : undefined;
  const filterLabel: Record<GateFilter, string> = {
    all: dl.lcx6_filter_all, failing: dl.lcx6_filter_failing, over_budget: dl.lcx6_filter_over_budget, flaky: dl.lcx6_filter_flaky,
  };
  const filteredOut = rows.length > 0 && shown.length === 0;
  return (
    <Section
      title={dl.lc2_commands_runs}
      level={2}
      count={rows.length || undefined}
      meta={meta}
      actions={rows.length > 1 ? <GateToolbar view={view} counts={counts} onChange={onView} /> : undefined}
      state={loading ? 'loading' : undefined}
    >
      <div ref={host} data-measure-focus={measureId ?? undefined} data-testid="lc6-rows">
        {filteredOut ? (
          <div className="flex flex-wrap items-center gap-3 py-3" data-testid="lc6-filter-none">
            <p className={LT.row}>{tx(dl.lcx6_filter_none, { filter: filterLabel[view.filter] })}</p>
            <Button variant="secondary" size="sm" onClick={() => onView({ ...view, filter: 'all' })}>{dl.lcx6_filter_show_all}</Button>
          </div>
        ) : (
          <Rows
            count={shown.length}
            columns={columns}
            nameHead={dl.lc2_col_command}
            empty={{ title: unavailable ? dl.lc2_runs_unavailable : dl.lc2_runs_empty, hint: unavailable ? undefined : dl.lc2_runs_empty_hint }}
          >
            {shown.map((r) => <CommandLine key={r.commandId} row={r} measureId={measureId} slots={slots} budget={budget} onOpen={onOpen} />)}
          </Rows>
        )}
      </div>
      {rows.length > 0 && <ChartLegend />}
      <p
        role="status"
        className={`${LT.row} empty:hidden ${budget.result?.tone === 'error' ? 'text-status-error' : 'text-status-success'} ${budget.result ? 'mt-2' : ''}`}
        data-testid="lc6-budget-result"
      >
        {budget.result?.text ?? ''}
      </p>
    </Section>
  );
}
