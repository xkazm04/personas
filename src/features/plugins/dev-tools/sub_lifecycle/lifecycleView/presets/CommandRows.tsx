/**
 * The per-command rows of a gate / tests step (`CommandLine`): what ran, how
 * it came out, how long it took against its budget, its trend and its pass
 * rate. The slowest command is named in the section's head line; what the
 * times measure is said once, under the rows, so the first row sits close to
 * the screen's band.
 *
 * With a past Measure picked (`measureId`, the page's time cursor), each row
 * shows THAT Measure's run instead of the latest, and the first such row is
 * scrolled into view.
 */
import { useEffect, useRef } from 'react';

import { Rows, Section, type RowColumn } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { CommandLine } from './CommandLine';
import { slowest, type CommandRow } from './gateModel';

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
  const meta = slow?.latest ? (
    <span data-testid="lc2-slowest">
      {tx(dl.lc2_slowest, { command: slow.command, time: formatNumeric(slow.latest.durationMs, 'ms') })}
    </span>
  ) : undefined;
  return (
    <Section
      title={dl.lc2_commands_runs}
      level={2}
      count={rows.length || undefined}
      meta={meta}
      state={loading ? 'loading' : undefined}
    >
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
      {rows.length > 0 && <p className={`mt-2 ${LT.meta}`}>{dl.lc2_speed_caption}</p>}
    </Section>
  );
}
