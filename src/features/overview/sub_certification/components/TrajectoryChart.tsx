import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { getGridStroke, getAxisTickFill } from '@/features/overview/sub_usage/libs/chartConstants';
import type { TrajectoryPoint } from '@/lib/bindings/TrajectoryPoint';

const SCORE_COLOR = '#34d399'; // emerald-400
const COST_COLOR = '#38bdf8'; // sky-400
const COST_AXIS_FMT = (v: number) => `$${v.toFixed(1)}`;

/** Team score + cost over the team's run history (oldest → newest). */
export function TrajectoryChart({ points }: { points: TrajectoryPoint[] }) {
  const { t } = useTranslation();
  const c = t.overview.certification;

  const data = useMemo(
    () =>
      points.map((p, i) => ({
        idx: i + 1,
        score: p.teamScore ?? 0,
        cost: p.costUsd ?? 0,
      })),
    [points],
  );

  const gridStroke = getGridStroke();
  const axisTick = { fill: getAxisTickFill(), fontSize: 10 };

  return (
    <div className="h-48 bg-secondary/20 rounded-modal border border-primary/10 p-3">
      <ChartErrorBoundary>
        <LazyChart
          render={(R) => (
            <R.ResponsiveContainer width="100%" height="100%">
              <R.LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
                <R.CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <R.XAxis dataKey="idx" tick={axisTick} />
                <R.YAxis yAxisId="score" domain={[0, 120]} tick={axisTick} />
                <R.YAxis
                  yAxisId="cost"
                  orientation="right"
                  tick={axisTick}
                  tickFormatter={COST_AXIS_FMT}
                />
                <R.Tooltip
                  contentStyle={{
                    background: 'var(--color-secondary, #1e1e2e)',
                    border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <R.Legend iconType="circle" iconSize={6} wrapperStyle={{ fontSize: 10 }} />
                <R.Line
                  yAxisId="score"
                  type="monotone"
                  dataKey="score"
                  name={c.team_score}
                  stroke={SCORE_COLOR}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                <R.Line
                  yAxisId="cost"
                  type="monotone"
                  dataKey="cost"
                  name={c.cost}
                  stroke={COST_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={{ r: 2 }}
                />
              </R.LineChart>
            </R.ResponsiveContainer>
          )}
        />
      </ChartErrorBoundary>
    </div>
  );
}
