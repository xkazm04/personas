/**
 * The peek over one bar of a run chart: how the run came out, when and on
 * which commit, its time against the budget (or why it has none), its exit
 * code and its first error line. Inert like every tip; a press on the bar is
 * what opens the run.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { shortSha } from '../../history/parts/Axis';
import { LT } from '../../system/lcType';
import { RunPill } from '../../system/Pill';

type Vm = Pick<ReturnType<typeof useLifecycleViewModel>, 'dl' | 'tx'>;

/** A run's time in words: against its budget, or why it has none. */
export function runTimeLine({ dl, tx }: Vm, run: LifecycleRun, budgetMs: number | null): string {
  if (run.outcome === 'did_not_run') return dl.lcx6_peek_no_time;
  const time = formatNumeric(run.durationMs, 'ms');
  if (run.outcome === 'timeout') return tx(dl.lcx6_peek_killed, { time });
  return budgetMs != null ? tx(dl.lcx6_peek_vs_budget, { time, budget: formatNumeric(budgetMs, 'ms') }) : time;
}

export function RunPeek({ run, budgetMs, viewed }: { run: LifecycleRun; budgetMs: number | null; viewed: boolean }) {
  const vm = useLifecycleViewModel();
  const { dl, tx } = vm;
  const over = run.outcome === 'passed' && budgetMs != null && run.durationMs > budgetMs;
  return (
    <div className="flex w-[22rem] max-w-full flex-col gap-1.5 py-1" data-testid="lc6-run-peek" data-run={run.id}>
      <div className="flex items-center justify-between gap-3">
        <RunPill outcome={run.outcome} />
        <span className={LT.meta}>
          {fillTemplate(dl.lcx1_fresh_measured, {
            time: <RelativeTime timestamp={run.finishedAt} showTooltip={false} />,
            sha: <span className={LT.code}>{shortSha(run.headSha)}</span>,
          })}
        </span>
      </div>
      <p className={`${LT.row} ${over ? 'text-status-warning' : ''}`}>
        {runTimeLine(vm, run, budgetMs)}
        {run.exitCode != null && <span className={LT.meta}>{` · ${tx(dl.lcx6_peek_exit, { code: run.exitCode })}`}</span>}
      </p>
      {run.firstError && <p className={`line-clamp-2 break-all text-status-error ${LT.code}`}>{run.firstError}</p>}
      {viewed && <p className={`${LT.label} text-primary`}>{dl.lcx6_peek_viewed}</p>}
      <p className={LT.meta}>{dl.lcx6_peek_open}</p>
    </div>
  );
}
