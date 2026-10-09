/**
 * Under the columns, never crowding: the oldest Measure's time at the left
 * end and "Latest" at the right one; while a past Measure is viewed, only its
 * own time and short sha, centred under it in the accent. Every other column
 * is a tick. A column's own time and sha are always in its peek.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { HIST_ROW, plotStyle } from '../historyGeometry';

export const shortSha = (sha: string) => sha.slice(0, 7);

export function Axis({ columns, at }: { columns: LifecycleMeasureColumn[]; at: number }) {
  const { dl } = useLifecycleViewModel();
  const newest = columns.length - 1;
  const travelling = at !== newest;
  return (
    <div aria-hidden className={`mt-1 grid items-start ${HIST_ROW.axis}`} style={plotStyle(columns.length)}>
      {columns.map((c, i) => {
        let text = null;
        if (travelling && i === at) {
          text = (
            <span className={`absolute left-1/2 top-1 flex -translate-x-1/2 items-baseline gap-1.5 whitespace-nowrap text-primary ${LT.label}`} data-axis="viewed">
              <RelativeTime timestamp={c.finishedAt} showTooltip={false} />
              <span className={LT.code}>{shortSha(c.headSha)}</span>
            </span>
          );
        } else if (!travelling && i === 0 && newest > 0) {
          text = <span className={`absolute left-0 top-1 whitespace-nowrap ${LT.label}`} data-axis="oldest"><RelativeTime timestamp={c.finishedAt} showTooltip={false} /></span>;
        } else if (!travelling && i === newest) {
          text = <span className={`absolute right-0 top-1 whitespace-nowrap ${LT.label}`} data-axis="latest">{dl.lcx3_axis_latest}</span>;
        }
        return (
          <span key={c.measureId} className="relative flex justify-center">
            <span className="block h-1 w-px bg-primary/30" />
            {text}
          </span>
        );
      })}
    </div>
  );
}
