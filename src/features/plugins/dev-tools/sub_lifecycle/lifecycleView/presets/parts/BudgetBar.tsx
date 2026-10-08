// A run's time against its budget, drawn: the bar is the run's duration, the
// upright line is the budget, both on one scale, so "over budget" is a bar
// that crosses the line. A timeout draws a dotted empty track (its time is
// the kill time, not a speed) and a run that never started a dashed one. With
// no known budget (the rules name none for the kind) there is no line and no
// "over": the bar is drawn against its own length.
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';

export function BudgetBar({ run, budgetMs }: { run: LifecycleRun | null; budgetMs: number | null }) {
  const { dl, tx } = useLifecycleViewModel();
  const ran = run && (run.outcome === 'passed' || run.outcome === 'failed');
  const scale = Math.max(budgetMs ?? 0, ran ? run.durationMs : 0) * 1.15 || 1;
  const over = !!ran && budgetMs != null && run.durationMs > budgetMs;
  const fill = !ran ? '' : run.outcome === 'failed' ? 'bg-status-error' : over ? 'bg-status-warning' : 'bg-status-success';
  const track = !run || run.outcome === 'did_not_run'
    ? 'border border-dashed border-foreground/40'
    : run.outcome === 'timeout' ? 'border border-dotted border-status-warning/80' : 'bg-secondary/60';
  return (
    <div className="flex w-full flex-col gap-1" data-over={over || undefined}>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        {ran
          ? <Numeric value={run.durationMs} unit="ms" className={`${LT.rowNum} ${over ? 'text-status-warning' : ''}`} />
          : <span className={LT.rowNum}>{dl.lc1_na}</span>}
        {budgetMs != null && <span className={LT.meta}>{tx(dl.lc2_of_budget, { budget: formatNumeric(budgetMs, 'ms') })}</span>}
      </span>
      <span aria-hidden className={`relative block h-2 w-full rounded-full ${track}`}>
        {ran && <span className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width: `${(run.durationMs / scale) * 100}%` }} />}
        {budgetMs != null && <span className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground" style={{ left: `${(budgetMs / scale) * 100}%` }} />}
      </span>
    </div>
  );
}
