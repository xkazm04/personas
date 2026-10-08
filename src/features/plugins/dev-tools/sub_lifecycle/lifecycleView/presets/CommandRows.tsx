/**
 * The per-command rows of a gate / tests step: what ran, how it came out, how
 * long it took against its budget (drawn), its time over the recent runs (a
 * sparkline), and its pass rate with n. The slowest command is called out
 * above the rows, and each command's first error opens under its own row.
 * Speed figures name their endpoints once, in the section's caption.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ListRow, Rows, Section, type RowColumn } from '@/features/shared/components/kit';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { slowest, type CommandRow } from './gateModel';
import { BudgetBar } from './parts/BudgetBar';
import { RunOutcomeChip } from './parts/RunOutcomeChip';
import { Sparkline, type SparkPoint } from './parts/Sparkline';
import { useKindLabel } from './useKindLabel';

function sparkPoints(row: CommandRow): SparkPoint[] {
  return [...row.runs].reverse().map((r) => ({
    value: r.outcome === 'passed' || r.outcome === 'failed' ? r.durationMs : null,
    tone: r.outcome === 'failed' ? 'error' : r.durationMs > row.budgetMs ? 'warning' : 'success',
  }));
}

function PassRate({ row }: { row: CommandRow }) {
  const { dl, tx } = useLifecycleViewModel();
  if (row.passRate == null) return <span className="typo-data text-foreground" data-na="true">{dl.lc1_na}</span>;
  return (
    <span className="flex flex-col items-end">
      <Numeric value={row.passRate} unit="percent" precision={0} className="typo-data text-foreground" />
      <span className="typo-caption">{tx(dl.lc1_samples, { count: row.answered })}</span>
    </span>
  );
}

function CommandLine({ row }: { row: CommandRow }) {
  const { dl, tx } = useLifecycleViewModel();
  const kind = useKindLabel();
  const [open, setOpen] = useState(false);
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
        name={<span className="typo-code text-foreground">{row.command}</span>}
        meta={meta}
        cells={[
          row.latest ? <RunOutcomeChip outcome={row.latest.outcome} /> : <span className="typo-body text-foreground">{dl.lc2_never_ran}</span>,
          <BudgetBar run={row.latest} budgetMs={row.budgetMs} />,
          <Sparkline points={sparkPoints(row)} refs={[{ value: row.budgetMs, tone: 'warning' }]} width={112} testId={`lc2-spark-${row.commandId}`} />,
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
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        ) : <span aria-hidden className="block h-7 w-7" />}
        testId={`lc2-cmd-${row.commandId}`}
      />
      {row.firstError && (
        <Collapse open={open} unmountWhenClosed>
          <pre className="mx-4 mb-3 mt-1 overflow-x-auto whitespace-pre-wrap rounded-card border border-status-error/30 bg-status-error/5 px-4 py-3 typo-code text-foreground" data-testid={`lc2-error-${row.commandId}`}>
            {row.firstError}
          </pre>
        </Collapse>
      )}
    </>
  );
}

export function CommandRows({ rows, loading, unavailable }: { rows: CommandRow[]; loading: boolean; unavailable: boolean }) {
  const { dl, tx } = useLifecycleViewModel();
  const slow = slowest(rows);
  const columns: RowColumn[] = [
    { head: dl.lc2_col_latest, width: '8.5rem' },
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
        <p className="mb-3 typo-body-lg text-foreground" data-testid="lc2-slowest">
          {tx(dl.lc2_slowest, { command: slow.command, time: formatNumeric(slow.latest.durationMs, 'ms') })}
        </p>
      )}
      <Rows
        count={rows.length}
        columns={columns}
        nameHead={dl.lc2_col_command}
        empty={{ title: unavailable ? dl.lc2_runs_unavailable : dl.lc2_runs_empty, hint: unavailable ? undefined : dl.lc2_runs_empty_hint }}
      >
        {rows.map((r) => <CommandLine key={r.commandId} row={r} />)}
      </Rows>
    </Section>
  );
}
