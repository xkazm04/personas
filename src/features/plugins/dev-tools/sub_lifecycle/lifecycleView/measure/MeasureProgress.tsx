/**
 * The header's Measure control while a Measure runs, laid over the idle
 * button's own box (`blocks/MeasureControl`): the segmented track over "2 of 5", and a
 * Cancel icon button beside them. The time left is the subtitle's to say
 * (`MeasuringLine`); the slot holds no more than the idle button did.
 *
 * Cancel needs no confirmation (it only stops this one Measure; every run
 * already recorded stays) and cannot be doubled: once pressed it carries the
 * pressed-control spinner until the Measure ends. While the plan resolves
 * the count reads "Preparing"; while a cancel is on its way, "Cancelling".
 *
 * The track's running segment turns to the warning tone past 1.5x its median,
 * on the shared 1 s ticker (`useQuantizedNow`), which stops while the window
 * is hidden.
 */
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useQuantizedNow } from '@/hooks/utility/timing/relativeTimeTicker';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { tally } from './measureModel';
import { useMeasureSession } from './measureSession';
import { SegmentTrack } from './SegmentTrack';
import type { CancelMeasure } from './useCancelMeasure';

export function MeasureProgress({ cancel }: { cancel: CancelMeasure }) {
  const { dl, tx } = useLifecycleViewModel();
  const { phase, progress } = useMeasureSession();
  const now = useQuantizedNow(1000);
  const { done, total } = tally(progress);
  const count = phase === 'preparing' ? dl.lcx4_preparing : phase === 'cancelling' ? dl.lcx4_cancelling : tx(dl.lcx4_count, { done, total });
  return (
    <span className="flex h-full w-full items-center gap-1.5 rounded-interactive border border-primary/20 bg-secondary/40 pl-2.5 pr-1" data-testid="lc-measure-progress" data-phase={phase}>
      <span
        role="progressbar"
        aria-label={dl.lcx4_progress_label}
        aria-valuemin={0}
        aria-valuemax={Math.max(total, 1)}
        aria-valuenow={done}
        aria-valuetext={phase === 'preparing' ? dl.lcx4_preparing : tx(dl.lcx4_count, { done, total })}
        className="flex min-w-0 flex-1 flex-col gap-1"
      >
        <SegmentTrack commands={progress?.commands ?? []} now={now} />
        <span className={`truncate whitespace-nowrap ${LT.label} ${phase === 'cancelling' ? 'text-status-warning' : 'text-primary'}`} data-testid="lc-measure-count">
          {count}
        </span>
      </span>
      <Tooltip content={dl.lcx4_cancel_tip} placement="bottom">
        <Button
          variant="ghost"
          size="icon-sm"
          icon={<X className={GLYPH.sm} />}
          loading={phase === 'cancelling'}
          onClick={() => void cancel.cancel()}
          aria-label={dl.lcx4_cancel}
          data-testid="lc-measure-cancel"
        />
      </Tooltip>
    </span>
  );
}
