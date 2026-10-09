/**
 * The peek over one Measure column: when it ran and on which commit, how long
 * it took, and each tracked step's verdict then with its one-line why and its
 * figure. Inert like every tip; a press on the column is what travels.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { stepLabel } from '../../../journey/journeyLabels';
import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { isRateKey } from '../../layer1/healthModel';
import { metricLabel } from '../../layer1/layer1Labels';
import { LT } from '../../system/lcType';
import { VerdictPill } from '../../system/Pill';
import { cellOf } from '../historyModel';
import { shortSha } from './Axis';

export function ColumnPeek({ column, stepIds, now }: { column: LifecycleMeasureColumn; stepIds: string[]; now: boolean }) {
  const { dl } = useLifecycleViewModel();
  return (
    <div className="flex w-[22rem] max-w-full flex-col gap-2 py-1" data-testid="lc-history-peek" data-measure={column.measureId}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={LT.title}>{now ? dl.lcx3_peek_latest : dl.lcx3_peek_title}</span>
        <span className={LT.meta}>
          {fillTemplate(dl.lcx1_fresh_measured, {
            time: <RelativeTime timestamp={column.finishedAt} showTooltip={false} />,
            sha: <span className={LT.code}>{shortSha(column.headSha)}</span>,
          })}
        </span>
      </div>
      {stepIds.map((id) => {
        const cell = cellOf(column, id);
        if (!cell) return null;
        const figure = cell.metrics.find((m) => isRateKey(m.key) && m.value != null) ?? null;
        return (
          <div key={id} className="flex flex-col gap-0.5" data-peek-step={id}>
            <div className="flex items-center justify-between gap-3">
              <span className={LT.label}>{stepLabel(dl, id, null)}</span>
              <span className="flex items-center gap-2">
                {figure && (
                  <span className="flex items-baseline gap-1">
                    <span className={LT.meta}>{metricLabel(dl, figure.key)}</span>
                    <Numeric value={figure.value} unit="percent" precision={0} className={LT.rowNum} />
                  </span>
                )}
                <VerdictPill health={cell.health} />
              </span>
            </div>
            {cell.reason && <p className={LT.meta}>{cell.reason}</p>}
          </div>
        );
      })}
      <div className="flex items-baseline gap-1.5">
        <span className={LT.label}>{dl.lcx3_peek_took}</span>
        <Numeric value={column.durationMs} unit="ms" className={LT.rowNum} />
      </div>
    </div>
  );
}
