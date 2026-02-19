import { useEffect, useState, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import { DayRangePicker, PersonaSelect } from './DashboardFilters';
import type { DayRange } from './DashboardFilters';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK_FILL } from './charts/chartConstants';
import { ChartTooltip } from './charts/ChartTooltip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UsageDashboard() {
  const toolUsageSummary = usePersonaStore((s) => s.toolUsageSummary);
  const toolUsageOverTime = usePersonaStore((s) => s.toolUsageOverTime);
  const toolUsageByPersona = usePersonaStore((s) => s.toolUsageByPersona);
  const fetchToolUsage = usePersonaStore((s) => s.fetchToolUsage);
  const personas = usePersonaStore((s) => s.personas);

  const [days, setDays] = useState<DayRange>(30);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  useEffect(() => {
    fetchToolUsage(days, selectedPersonaId || undefined);
  }, [days, selectedPersonaId, fetchToolUsage]);

  // Pivot overTime data into wide format for AreaChart
  const areaData = useMemo(() => {
    if (!toolUsageOverTime.length) return [];

    const dateMap = new Map<string, Record<string, number>>();

    for (const row of toolUsageOverTime) {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, {});
      }
      const entry = dateMap.get(row.date)!;
      entry[row.tool_name] = (entry[row.tool_name] || 0) + row.invocations;
    }

    const sortedDates = Array.from(dateMap.keys()).sort();
    return sortedDates.map((date) => ({
      date,
      ...dateMap.get(date),
    }));
  }, [toolUsageOverTime]);

  const allToolNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of toolUsageOverTime) {
      names.add(row.tool_name);
    }
    return Array.from(names);
  }, [toolUsageOverTime]);

  // Pie chart data
  const pieData = useMemo(
    () =>
      toolUsageSummary.map((s) => ({
        name: formatToolName(s.tool_name),
        value: s.total_invocations,
      })),
    [toolUsageSummary]
  );

  // Bar chart: horizontal bars sorted descending
  const barData = useMemo(
    () =>
      [...toolUsageSummary]
        .sort((a, b) => b.total_invocations - a.total_invocations)
        .map((s) => ({
          name: formatToolName(s.tool_name),
          invocations: s.total_invocations,
          executions: s.unique_executions,
          personas: s.unique_personas,
        })),
    [toolUsageSummary]
  );

  // By-persona bar data
  const personaBarData = useMemo(
    () =>
      [...toolUsageByPersona]
        .sort((a, b) => b.total_invocations - a.total_invocations)
        .map((p) => ({
          name: p.persona_name || p.persona_id,
          invocations: p.total_invocations,
          tools: p.unique_tools,
          color: p.persona_color || '#3B82F6',
        })),
    [toolUsageByPersona]
  );

  const isEmpty =
    toolUsageSummary.length === 0 &&
    toolUsageOverTime.length === 0 &&
    toolUsageByPersona.length === 0;

  // ── Empty State ──────────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground/50">
        <BarChart3 className="w-12 h-12" />
        <p className="text-sm">No tool usage data yet</p>
        <p className="text-xs text-muted-foreground/30">
          Usage analytics will appear after personas execute tools
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 py-5 gap-6">
      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap">
        <PersonaSelect value={selectedPersonaId || ''} onChange={(v) => setSelectedPersonaId(v || null)} personas={personas} />
        <DayRangePicker value={days} onChange={setDays} />
      </div>

      {/* ── Top Row: Bar Chart + Pie Chart ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Tool Invocations (horizontal bar) */}
        <div className="lg:col-span-3 bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-foreground/70 mb-4">Tool Invocations</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, barData.length * 40)}>
            <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                dataKey="name"
                type="category"
                width={120}
                tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="invocations" name="Invocations" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Distribution (pie) */}
        <div className="lg:col-span-2 bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-foreground/70 mb-4">Distribution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                stroke="none"
              >
                {pieData.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                formatter={(value: string) => (
                  <span className="text-xs text-white/50">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Usage Over Time (stacked area) ─────────────────────── */}
      {areaData.length > 0 && (
        <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-foreground/70 mb-4">Usage Over Time</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={areaData} margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis
                dataKey="date"
                tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                verticalAlign="top"
                iconType="circle"
                iconSize={8}
                formatter={(value: string) => (
                  <span className="text-xs text-white/50">{formatToolName(value)}</span>
                )}
              />
              {allToolNames.map((toolName, idx) => (
                <Area
                  key={toolName}
                  type="monotone"
                  dataKey={toolName}
                  name={toolName}
                  stackId="1"
                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  fillOpacity={0.3}
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  strokeWidth={1.5}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── By Persona (horizontal bar) ───────────────────────── */}
      {personaBarData.length > 0 && (
        <div className="bg-secondary/30 border border-primary/10 rounded-xl p-4">
          <h3 className="text-sm font-medium text-foreground/70 mb-4">By Persona</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, personaBarData.length * 44)}>
            <BarChart data={personaBarData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                dataKey="name"
                type="category"
                width={140}
                tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="invocations" name="Invocations" radius={[0, 4, 4, 0]} barSize={22}>
                {personaBarData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
