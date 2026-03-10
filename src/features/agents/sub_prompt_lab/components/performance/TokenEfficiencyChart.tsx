import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { PromptPerformancePoint } from '@/lib/bindings/PromptPerformancePoint';
import { GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/libs/chartConstants';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/components/ChartErrorBoundary';
import { fmtDate } from '../../libs/performanceHelpers';
import { DashTooltip } from './PerformanceWidgets';

interface TokenEfficiencyChartProps {
  points: PromptPerformancePoint[];
}

export function TokenEfficiencyChart({ points }: TokenEfficiencyChartProps) {
  return (
    <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
      <h4 className="text-sm font-medium text-foreground/80 mb-3 uppercase tracking-wider">Token Efficiency</h4>
      <ChartErrorBoundary>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={points} syncId="perf-sync">
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
          <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} />
          <Tooltip content={<DashTooltip formatter={(v) => Math.round(v).toLocaleString()} />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="avg_input_tokens" name="Input" fill="#6366f1" radius={[2, 2, 0, 0]} />
          <Bar dataKey="avg_output_tokens" name="Output" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      </ChartErrorBoundary>
    </div>
  );
}
