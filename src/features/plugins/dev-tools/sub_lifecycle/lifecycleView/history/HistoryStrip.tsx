/**
 * The step's own history, inside the step screen's band (Gate and Tests): the
 * same verdict row the Layer-1 figure draws (`parts/VerdictRow`), for this step
 * only, under the same column picker. It is the band's time axis: picking a
 * past Measure moves the page's one time cursor (`timeTravel`), and the band
 * around it, the command rows below and Layer 1 on return all show THAT
 * Measure. Picking the newest Measure, or "Back to now" (in the strip's head
 * line while a past Measure is viewed), returns.
 * With the strip focused on a past Measure, Esc returns to now; otherwise Esc
 * goes back to Layer 1, as everywhere on a step's screen (and Left / Right in
 * the strip move between Measures, not between steps).
 *
 * The strip is one fixed height in every state (a ghost row, a failed read,
 * too short a history, the row), so the band never changes height with it.
 */
import { ArrowRightToLine } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { Ghost } from '@/features/shared/components/kit';

import { useLifecycleViewModel } from '../context';
import { Count } from '../system/Count';
import { lcShape } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { HIST_ROW } from './historyGeometry';
import { ColumnPicker } from './parts/ColumnPicker';
import { VerdictRow } from './parts/VerdictRow';
import { useTimeTravel } from './timeTravel';

/** One verdict row, its gap and the axis. */
const STRIP_REM = 1.5 + 0.25 + 1.5;

function Row({ stepId }: { stepId: string }) {
  const { dl } = useLifecycleViewModel();
  const { columns, viewedIndex, history, error, refetch, travel } = useTimeTravel();
  if (!history && error) return <Banner severity="error" compact message={dl.lcx3_history_failed} cause={error} onRetry={refetch} />;
  if (!history) return <span className={`block ${HIST_ROW.verdict} overflow-hidden ${lcShape('chip')}`} aria-hidden data-testid="lc2-strip-ghost"><Ghost width="100%" height="100%" /></span>;
  if (columns.length < 2) return <p className={LT.row} data-testid="lc2-strip-empty">{dl.lcx3_history_empty}</p>;
  const newest = columns.length - 1;
  return (
    <ColumnPicker
      columns={columns}
      at={viewedIndex ?? newest}
      onPick={(i) => travel(i >= newest ? null : columns[i]?.measureId ?? null)}
      onClear={() => travel(null)}
      label={dl.lcx3_history_label}
      stepIds={[stepId]}
      testId="lc2-strip"
    >
      <VerdictRow columns={columns} stepId={stepId} />
    </ColumnPicker>
  );
}

export function HistoryStrip({ stepId }: { stepId: string }) {
  const { dl } = useLifecycleViewModel();
  const { columns, viewing, travel } = useTimeTravel();
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="lc2-strip" data-step={stepId}>
      {/* One line tall in both states: the hint, or (viewing a past Measure) the way back to now. */}
      <span className="flex h-7 min-w-0 items-center gap-2">
        <span className={LT.eyebrow}>{dl.lcx3_history}</span>
        {columns.length >= 2 && <Count value={columns.length} />}
        {viewing ? (
          <Button variant="secondary" size="xs" icon={<ArrowRightToLine className={GLYPH.sm} />} onClick={() => travel(null)} data-testid="lc2-band-now">
            {dl.lcx3_back_to_now}
          </Button>
        ) : (
          <span className={`min-w-0 truncate ${LT.meta}`}>{dl.lcx3_strip_hint}</span>
        )}
      </span>
      <div className="flex flex-col justify-center" style={{ height: `${STRIP_REM}rem` }}>
        <Row stepId={stepId} />
      </div>
    </div>
  );
}
