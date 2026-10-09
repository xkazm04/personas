/**
 * Layer 2's history strip, at the top of the Gate and Tests screens: the same
 * verdict row the Layer-1 figure draws (`parts/VerdictRow`), for this step
 * only, under the same column picker. Picking a past Measure moves the page's
 * one time cursor (`timeTravel`): the command rows below show THAT Measure's
 * runs (matched by `measureId`), raised and scrolled into view, and Layer 1
 * shows the same Measure on return. Picking the newest Measure, or "Show the
 * latest runs", returns to now. With the strip focused on a past Measure, Esc
 * returns to now; otherwise Esc goes back to Layer 1, as everywhere on a
 * step's screen (and Left / Right in the strip move between Measures, not
 * between steps).
 *
 * The strip is one fixed height in every state (a ghost row, a failed read,
 * too short a history, the row), so the preset under it never jumps.
 */
import { ArrowRightToLine } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { Ghost, Section } from '@/features/shared/components/kit';

import { stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { fillTemplate } from '../frame/fillTemplate';
import { lcShape } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { HIST_ROW, figureColumns } from './historyGeometry';
import { shortSha } from './parts/Axis';
import { ColumnPicker } from './parts/ColumnPicker';
import { VerdictRow } from './parts/VerdictRow';
import { useTimeTravel } from './timeTravel';

/** One verdict row, its gap and the axis. */
const STRIP_REM = 1.5 + 0.25 + 1.5;

function Meta() {
  const { dl } = useLifecycleViewModel();
  const { viewing, travel } = useTimeTravel();
  if (!viewing) return <span className={LT.meta}>{dl.lcx3_strip_hint}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="lc2-strip-viewing">
      <span className={`text-primary ${LT.meta}`}>
        {fillTemplate(dl.lcx3_strip_showing, {
          time: <RelativeTime timestamp={viewing.finishedAt} />,
          sha: <span className={LT.code}>{shortSha(viewing.headSha)}</span>,
        })}
      </span>
      <Button variant="secondary" size="xs" icon={<ArrowRightToLine className={GLYPH.sm} />} onClick={() => travel(null)} data-testid="lc2-strip-latest">
        {dl.lcx3_strip_latest}
      </Button>
    </span>
  );
}

function Row({ stepId }: { stepId: string }) {
  const { dl } = useLifecycleViewModel();
  const { columns, viewedIndex, history, error, refetch, travel } = useTimeTravel();
  if (!history && error) return <Banner severity="error" compact message={dl.lcx3_history_failed} cause={error} onRetry={refetch} />;
  if (!history) return <span className={`block h-6 overflow-hidden ${lcShape('chip')}`} aria-hidden data-testid="lc2-strip-ghost"><Ghost width="100%" height="100%" /></span>;
  if (columns.length < 2) return <p className={LT.row} data-testid="lc2-strip-empty">{dl.lcx3_history_empty}</p>;
  const newest = columns.length - 1;
  const Glyph = stepGlyph(stepId);
  return (
    <div className="grid items-start gap-x-3" style={figureColumns(columns.length)}>
      <span aria-hidden className={`flex min-w-0 items-center gap-1.5 ${HIST_ROW.verdict} ${LT.label}`}>
        <Glyph className={`${GLYPH.sm} shrink-0 text-primary`} />
        <span className="truncate">{stepLabel(dl, stepId, null)}</span>
      </span>
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
      <span />
    </div>
  );
}

export function HistoryStrip({ stepId }: { stepId: string }) {
  const { dl } = useLifecycleViewModel();
  const { columns } = useTimeTravel();
  return (
    <Section level={2} title={dl.lcx3_history} count={columns.length >= 2 ? columns.length : undefined} meta={<Meta />}>
      <div className="k-in flex flex-col justify-center" style={{ height: `${STRIP_REM}rem` }} data-testid="lc2-strip" data-step={stepId}>
        <Row stepId={stepId} />
      </div>
    </Section>
  );
}
