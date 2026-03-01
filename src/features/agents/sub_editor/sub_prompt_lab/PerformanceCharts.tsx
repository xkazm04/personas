import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import type { PromptPerformancePoint } from '@/lib/bindings/PromptPerformancePoint';
import type { PromptPerformanceData } from '@/lib/bindings/PromptPerformanceData';
import { GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { VERSION_COLORS, COMPARE_A_COLOR, COMPARE_B_COLOR, fmtDate, fmtCost, fmtMs, fmtPct } from './performanceHelpers';
import { DashTooltip } from './PerformanceWidgets';

interface ComparedPoint extends PromptPerformancePoint {
  costA: number | null;
  costB: number | null;
  latencyA: number | null;
  latencyB: number | null;
  errorA: number | null;
  errorB: number | null;
}

interface PerformanceChartsProps {
  data: PromptPerformanceData;
  compareMode: boolean;
  comparedData: ComparedPoint[] | null;
  compALabel: string;
  compBLabel: string;
  productionBaseline: number | null;
}

export type { ComparedPoint };

export function PerformanceCharts({
  data, compareMode, comparedData, compALabel, compBLabel, productionBaseline,
}: PerformanceChartsProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* 1) Cost per Execution */}
      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
        <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Cost per Execution</h4>
        <ResponsiveContainer width="100%" height={200}>
          {compareMode && comparedData ? (
            <LineChart data={comparedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtCost(v)} />
              <Tooltip content={<DashTooltip formatter={(v) => fmtCost(v)} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="costA" name={compALabel} stroke={COMPARE_A_COLOR} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="costB" name={compBLabel} stroke={COMPARE_B_COLOR} strokeWidth={2} dot={false} connectNulls />
              {productionBaseline != null && (
                <ReferenceLine y={productionBaseline} stroke="#10b981" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: 'prod baseline', position: 'insideTopRight', fill: '#10b981', fontSize: 10 }} />
              )}
              {data.version_markers.map((v) => (
                <ReferenceLine key={v.version_id} x={v.created_at.slice(0, 10)} stroke={VERSION_COLORS[v.tag] ?? '#71717a'} strokeDasharray="4 2" strokeWidth={1} label={{ value: `v${v.version_number}`, position: 'top', fill: VERSION_COLORS[v.tag] ?? '#71717a', fontSize: 9 }} />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={data.daily_points}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtCost(v)} />
              <Tooltip content={<DashTooltip formatter={(v) => fmtCost(v)} />} />
              <Area type="monotone" dataKey="avg_cost_usd" name="Avg Cost" stroke="#6366f1" fill="url(#costGrad)" strokeWidth={2} />
              {productionBaseline != null && (
                <ReferenceLine y={productionBaseline} stroke="#10b981" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: 'prod baseline', position: 'insideTopRight', fill: '#10b981', fontSize: 10 }} />
              )}
              {data.version_markers.map((v) => (
                <ReferenceLine key={v.version_id} x={v.created_at.slice(0, 10)} stroke={VERSION_COLORS[v.tag] ?? '#71717a'} strokeDasharray="4 2" strokeWidth={1} label={{ value: `v${v.version_number}`, position: 'top', fill: VERSION_COLORS[v.tag] ?? '#71717a', fontSize: 9 }} />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* 2) Latency Distribution */}
      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
        <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Latency Distribution</h4>
        <ResponsiveContainer width="100%" height={200}>
          {compareMode && comparedData ? (
            <LineChart data={comparedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtMs} />
              <Tooltip content={<DashTooltip formatter={fmtMs} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="latencyA" name={compALabel} stroke={COMPARE_A_COLOR} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="latencyB" name={compBLabel} stroke={COMPARE_B_COLOR} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          ) : (
            <LineChart data={data.daily_points}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtMs} />
              <Tooltip content={<DashTooltip formatter={fmtMs} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="p50_duration_ms" name="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p95_duration_ms" name="p95" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line type="monotone" dataKey="p99_duration_ms" name="p99" stroke="#ef4444" strokeWidth={1} dot={false} strokeDasharray="2 2" />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* 3) Error Rate Trend */}
      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
        <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Error Rate Trend</h4>
        <ResponsiveContainer width="100%" height={200}>
          {compareMode && comparedData ? (
            <LineChart data={comparedData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtPct(v)} domain={[0, 'auto']} />
              <Tooltip content={<DashTooltip formatter={(v) => fmtPct(v)} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="errorA" name={compALabel} stroke={COMPARE_A_COLOR} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="errorB" name={compBLabel} stroke={COMPARE_B_COLOR} strokeWidth={2} dot={false} connectNulls />
              {data.version_markers.map((v) => (
                <ReferenceLine key={v.version_id} x={v.created_at.slice(0, 10)} stroke={VERSION_COLORS[v.tag] ?? '#71717a'} strokeDasharray="4 2" strokeWidth={1} />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={data.daily_points}>
              <defs>
                <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
              <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={(v) => fmtPct(v)} domain={[0, 'auto']} />
              <Tooltip content={<DashTooltip formatter={(v) => fmtPct(v)} />} />
              <Area type="monotone" dataKey="error_rate" name="Error Rate" stroke="#ef4444" fill="url(#errorGrad)" strokeWidth={2} />
              {data.version_markers.map((v) => (
                <ReferenceLine key={v.version_id} x={v.created_at.slice(0, 10)} stroke={VERSION_COLORS[v.tag] ?? '#71717a'} strokeDasharray="4 2" strokeWidth={1} label={{ value: `v${v.version_number}`, position: 'top', fill: VERSION_COLORS[v.tag] ?? '#71717a', fontSize: 9 }} />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* 4) Token Efficiency */}
      <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
        <h4 className="text-xs font-medium text-foreground/80 mb-3 uppercase tracking-wider">Token Efficiency</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.daily_points}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} tickFormatter={fmtDate} />
            <YAxis tick={{ fontSize: 10, fill: AXIS_TICK_FILL }} />
            <Tooltip content={<DashTooltip formatter={(v) => Math.round(v).toLocaleString()} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="avg_input_tokens" name="Input" fill="#6366f1" radius={[2, 2, 0, 0]} />
            <Bar dataKey="avg_output_tokens" name="Output" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
