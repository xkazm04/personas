// One project's stacked-area river. Every axis, grid and tooltip comes from
// kpiChartTheme so the twelve panels read as one instrument, and the y domain
// is PASSED IN (sharedRiverMax) rather than derived per chart — a project with
// 3 KPIs must not be drawn as tall as one with 300.
//
// `connectNulls` is deliberately absent: a week with no reading is a hole in
// the river, and bridging it would invent a measurement.
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { useTranslation } from '@/i18n/useTranslation';
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from '../kpiChartTheme';
import { TRACK_COLOR } from '../kpiMeta';
import type { RiverPoint } from './StateRiver.model';
import { partialWeekStart } from './StateRiver.model';

export const RIVER_HEIGHT = 160;

export function RiverChartSlotGhost() {
  return (
    <div
      className="h-40 rounded-card bg-primary/[0.06] animate-fade-in"
      style={{ animationDelay: '150ms' }}
      aria-hidden="true"
    />
  );
}

const weekLabel = (ms: number) => new Date(ms).toLocaleDateString();

export function StateRiverChart({ points, yMax }: { points: RiverPoint[]; yMax: number }) {
  const { t } = useTranslation();
  const o = t.kpis.overview;
  const partial = partialWeekStart(points);

  return (
    <LazyChart
      fallback={<RiverChartSlotGhost />}
      render={(R) => (
        <R.ResponsiveContainer width="100%" height={RIVER_HEIGHT}>
          <R.AreaChart accessibilityLayer={false} data={points} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <R.CartesianGrid {...GRID_PROPS} />
            <R.XAxis dataKey="week" tickFormatter={weekLabel} {...AXIS_PROPS} />
            <R.YAxis
              allowDecimals={false}
              domain={[0, yMax]}
              width={34}
              {...AXIS_PROPS}
            />
            <R.Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={((ms: unknown) => weekLabel(Number(ms))) as never}
            />
            {partial != null && (
              <R.ReferenceArea
                x1={partial}
                x2={points[points.length - 1]!.week}
                fill="var(--muted-foreground)"
                fillOpacity={0.08}
                ifOverflow="extendDomain"
              />
            )}
            {partial != null && (
              <R.ReferenceLine
                x={partial}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 3"
                label={{ value: o.river_partial, position: 'insideTopRight', fontSize: 10, fill: 'var(--muted-foreground)' }}
              />
            )}
            <R.Area type="monotone" stackId="s" dataKey="met" name={t.kpis.stat_met} stroke={TRACK_COLOR.met} fill={TRACK_COLOR.met} fillOpacity={0.35} isAnimationActive={false} />
            <R.Area type="monotone" stackId="s" dataKey="onTrack" name={t.kpis.stat_on_track} stroke={TRACK_COLOR['on-track']} fill={TRACK_COLOR['on-track']} fillOpacity={0.35} isAnimationActive={false} />
            <R.Area type="monotone" stackId="s" dataKey="offTrack" name={t.kpis.stat_off_track} stroke={TRACK_COLOR['off-track']} fill={TRACK_COLOR['off-track']} fillOpacity={0.35} isAnimationActive={false} />
          </R.AreaChart>
        </R.ResponsiveContainer>
      )}
    />
  );
}
