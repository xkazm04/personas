/**
 * The per-command rows of a gate / tests step: what ran, how it came out, how
 * long it took against its budget (drawn), its time over the recent runs (a
 * sparkline), and its pass rate with n. The slowest command is called out
 * above the rows, and each command's first error opens under its own row.
 * Speed figures name their endpoints once, in the section's caption.
 *
 * With a past Measure picked (`measureId`, the page's time cursor), each row
 * shows THAT Measure's run instead of the latest (matched by `measureId`):
 * its outcome and time, its point ringed on the trend, the row raised; the
 * first such row is scrolled into view. A command with no run in that Measure
 * says so.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ListRow, Rows, Section, type RowColumn } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { RunPill } from '../system/Pill';
import { GLYPH } from '../system/scales';
import { slowest, type CommandRow } from './gateModel';
import { BudgetBar } from './parts/BudgetBar';
import { Sparkline, type SparkPoint } from './parts/Sparkline';
import { useKindLabel } from './useKindLabel';

function sparkPoints(row: CommandRow): SparkPoint[] {
  const budget = row.budgetMs;
  return [...row.runs].reverse().map((r) => ({
    value: r.outcome === 'passed' || r.outcome === 'failed' ? r.durationMs : null,
    tone: r.outcome === 'failed' ? 'error' : budget != null && r.durationMs > budget ? 'warning' : 'success',
  }));
}

function PassRate({ row }: { row: CommandRow }) {
  const { dl, tx } = useLifecycleViewModel();
  if (row.passRate == null) return <span className={LT.rowNum} data-na="true">{dl.lc1_na}</span>;
  return (
    <span className="flex flex-col items-end">
      <Numeric value={row.passRate} unit="percent" precision={0} className={LT.rowNum} />
      <span className={LT.metaNum}>{tx(dl.lc1_samples, { count: row.answered })}</span>
    </span>
  );
}

/** The run a row shows: the latest, or the picked Measure's (null when the command did not run in it). */
function shownRun(row: CommandRow, measureId: string | null): LifecycleRun | null {
  return measureId ? row.runs.find((r) => r.measureId === measureId) ?? null : row.latest;
}

function CommandLine({ row, measureId }: { row: CommandRow; measureId: string | null }) {
  const { dl, tx } = useLifecycleViewModel();
  const kind = useKindLabel();
  const [open, setOpen] = useState(false);
  const run = shownRun(row, measureId);
  const hit = measureId !== null && run !== null;
  const points = sparkPoints(row);
  const mark = run ? points.length - 1 - row.runs.indexOf(run) : undefined;
  const latest = run
    ? <RunPill outcome={run.outcome} />
    : <span className={LT.row}>{measureId ? dl.lcx3_not_in_measure : dl.lc2_never_ran}</span>;
  const meta: ReactNode = (
    <>
      <span>{kind(row.kind)}</span>
      <span>{tx(dl.lc2_median, { value: row.medianMs == null ? dl.lc1_na : formatNumeric(row.medianMs, 'ms') })}</span>
    </>
  );
  return (
    <>
      <ListRow
        size="l"
        name={<span className={LT.code}>{row.command}</span>}
        meta={meta}
        state={hit ? 'selected' : undefined}
        cells={[
          latest,
          <BudgetBar run={run} budgetMs={row.budgetMs} />,
          <Sparkline
            points={points}
            mark={hit ? mark : undefined}
            refs={row.budgetMs != null ? [{ value: row.budgetMs, tone: 'warning' }] : []}
            width={112}
            testId={`lc2-spark-${row.commandId}`}
          />,
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
          <pre
            className={`mx-4 mb-3 mt-1 overflow-x-auto whitespace-pre-wrap ${lcSurface('plate', 'border border-status-error/30 bg-status-error/5')} ${LT.code}`}
            data-testid={`lc2-error-${row.commandId}`}
          >
            {row.firstError}
          </pre>
        </Collapse>
      )}
    </>
  );
}

interface CommandRowsProps {
  rows: CommandRow[];
  loading: boolean;
  unavailable: boolean;
  /** The picked past Measure whose runs the rows show; null = the latest runs. */
  measureId?: string | null;
}

export function CommandRows({ rows, loading, unavailable, measureId = null }: CommandRowsProps) {
  const { dl, tx } = useLifecycleViewModel();
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const slow = slowest(rows);
  useEffect(() => {
    if (!measureId) return;
    // `?.()`: a DOM without layout (a test's) has no scrollIntoView.
    host.current?.querySelector('[data-kit-state~="selected"]')?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [measureId, reduced]);
  const columns: RowColumn[] = [
    { head: measureId ? dl.lcx3_col_viewed : dl.lc2_col_latest, width: '8.5rem' },
    { head: dl.lc2_col_time, width: '11rem' },
    { head: dl.lc2_col_trend, width: '7.5rem', collapse: true },
    { head: dl.lc2_col_pass, width: '5rem', align: 'end' },
  ];
  return (
    <Section
      title={dl.lc2_commands_runs}
      level={2}
      count={rows.length || undefined}
      desc={dl.lc2_speed_caption}
      state={loading ? 'loading' : undefined}
    >
      {slow?.latest && (
        <p className={`mb-3 ${LT.lead}`} data-testid="lc2-slowest">
          {tx(dl.lc2_slowest, { command: slow.command, time: formatNumeric(slow.latest.durationMs, 'ms') })}
        </p>
      )}
      <div ref={host} data-measure-focus={measureId ?? undefined}>
        <Rows
          count={rows.length}
          columns={columns}
          nameHead={dl.lc2_col_command}
          empty={{ title: unavailable ? dl.lc2_runs_unavailable : dl.lc2_runs_empty, hint: unavailable ? undefined : dl.lc2_runs_empty_hint }}
        >
          {rows.map((r) => <CommandLine key={r.commandId} row={r} measureId={measureId} />)}
        </Rows>
      </div>
    </Section>
  );
}
