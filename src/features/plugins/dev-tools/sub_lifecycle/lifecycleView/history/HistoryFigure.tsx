/**
 * THE HISTORY FIGURE: the last Measures, oldest left, newest right, as one
 * drawing in three columns -
 *
 * - the row names (each command step, Time, Coverage);
 * - the plot, under one column picker (`parts/ColumnPicker`): each step's
 *   verdict cells, the Measure's total time as a bar, and Tests coverage as a
 *   line against its two thresholds; the axis under it;
 * - the scale: the top of the time bars, and the two thresholds by value.
 *
 * Picking a past column travels the page to that Measure (`timeTravel`);
 * picking the newest returns to now. Every size is a named row height
 * (`historyGeometry`), so the figure is the same height in every state.
 */
import { ShieldCheck, Timer, type LucideIcon } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatDuration } from '@/lib/utils/formatters';

import { stepGlyph, stepLabel } from '../../journey/journeyLabels';
import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { thresholdsFor } from '../system/rules';
import { GLYPH } from '../system/scales';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { HIST_ROW, HIST_ROW_GAP, figureColumns } from './historyGeometry';
import { coverageDomain, coverageSeries } from './historyModel';
import { ColumnPicker } from './parts/ColumnPicker';
import { CoverageRow, yPct, type CoverageScale } from './parts/CoverageRow';
import { DurationRow, durationScale } from './parts/DurationRow';
import { VerdictRow } from './parts/VerdictRow';
import { useTimeTravel } from './timeTravel';

function RowName({ glyph: Glyph, label, height }: { glyph: LucideIcon; label: string; height: string }) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${height} ${LT.label}`}>
      <Glyph className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The thresholds the coverage line is drawn against: Tests' own, else the snapshot's rules. */
function useCoverageScale(values: (number | null)[]): CoverageScale {
  const { order } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const params = order.find((n) => n.id === 'tests')?.view.step.params;
  const t = params ? thresholdsFor(rules, params) : { coverageGreenPct: rules.coverageGreenPct, amberFloorPct: rules.amberFloorPct };
  return { ...coverageDomain(values, t.coverageGreenPct, t.amberFloorPct), green: t.coverageGreenPct, amber: t.amberFloorPct };
}

export function HistoryFigure() {
  const { dl } = useLifecycleViewModel();
  const { columns, viewedIndex, history, travel } = useTimeTravel();
  const stepIds = history?.stepIds ?? [];
  const newest = columns.length - 1;
  const at = viewedIndex ?? newest;
  const values = coverageSeries(columns);
  const scale = useCoverageScale(values);
  const pick = (i: number) => travel(i >= newest ? null : columns[i]?.measureId ?? null);
  return (
    <div className="grid items-start gap-x-3" style={figureColumns(columns.length)} data-testid="lc-history-figure">
      <div aria-hidden className={`flex flex-col ${HIST_ROW_GAP}`}>
        {stepIds.map((id) => <RowName key={id} glyph={stepGlyph(id)} label={stepLabel(dl, id, null)} height={HIST_ROW.verdict} />)}
        <RowName glyph={Timer} label={dl.lcx3_row_time} height={HIST_ROW.duration} />
        <RowName glyph={ShieldCheck} label={dl.lcx3_row_coverage} height={HIST_ROW.coverage} />
      </div>
      <ColumnPicker
        columns={columns}
        at={at}
        onPick={pick}
        onClear={() => travel(null)}
        label={dl.lcx3_history_label}
        stepIds={stepIds}
        testId="lc-history"
      >
        {stepIds.map((id) => <VerdictRow key={id} columns={columns} stepId={id} />)}
        <DurationRow columns={columns} at={at} />
        <CoverageRow values={values} scale={scale} at={at} />
      </ColumnPicker>
      <div aria-hidden className={`flex flex-col ${HIST_ROW_GAP}`}>
        {stepIds.map((id) => <span key={id} className={HIST_ROW.verdict} />)}
        <span className={`${HIST_ROW.duration} ${LT.metaNum} whitespace-nowrap`}>{formatDuration(durationScale(columns).top)}</span>
        <span className={`relative ${HIST_ROW.coverage}`}>
          {(['green', 'amber'] as const).map((k) => (
            <span key={k} className="absolute left-0 -translate-y-1/2" style={{ top: `${yPct(scale[k], scale)}%` }} data-scale={k}>
              <Numeric value={scale[k]} unit="percent" precision={0} className={`${LT.metaNum} ${k === 'green' ? 'text-status-success' : 'text-status-warning'}`} />
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
