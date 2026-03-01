import { useEffect, useState, useMemo } from 'react';
import { BarChart3, Play, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { DayRangePicker, PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import type { DayRange } from '@/features/overview/sub_usage/DashboardFilters';
import { CHART_COLORS, GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { ChartTooltip } from '@/features/overview/sub_usage/charts/ChartTooltip';
import { MetricChart } from '@/features/overview/sub_usage/charts/MetricChart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatToolName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);

  const [days, setDays] = useState<DayRange>(30);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        await fetchToolUsage(days, selectedPersonaId || undefined);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [days, selectedPersonaId, fetchToolUsage]);

  // Pivot overTime data into wide format for AreaChart + collect tool names
  const { areaData, allToolNames } = useMemo(() => {
    if (!toolUsageOverTime.length) return { areaData: [], allToolNames: [] as string[] };
    const dateMap = new Map<string, Record<string, number>>();
    const names = new Set<string>();
    for (const row of toolUsageOverTime) {
      names.add(row.tool_name);
      if (!dateMap.has(row.date)) dateMap.set(row.date, {});
      const entry = dateMap.get(row.date)!;
      entry[row.tool_name] = (entry[row.tool_name] || 0) + row.invocations;
    }
    const sortedDates = Array.from(dateMap.keys()).sort();
    return {
      areaData: sortedDates.map(date => ({ date, ...dateMap.get(date) })),
      allToolNames: Array.from(names),
    };
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

  // ── Insight annotations ─────────────────────────────────────────
  const barInsight = useMemo(() => {
    if (barData.length < 2) return null;
    const top = barData[0]!;
    const second = barData[1]!;
    if (second.invocations === 0) return `${top.name} is the only tool used`;
    const ratio = top.invocations / second.invocations;
    if (ratio >= 2) return `${top.name} is used ${ratio.toFixed(1)}x more than ${second.name}`;
    return `${top.name} leads with ${top.invocations.toLocaleString()} invocations`;
  }, [barData]);

  const pieTotal = useMemo(
    () => pieData.reduce((sum, d) => sum + d.value, 0),
    [pieData]
  );

  const pieInsight = useMemo(() => {
    if (pieData.length === 0) return null;
    const total = pieData.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) return null;
    const top = pieData.reduce((a, b) => (a.value > b.value ? a : b));
    const pct = Math.round((top.value / total) * 100);
    return `${top.name} accounts for ${pct}% of all tool calls`;
  }, [pieData]);

  const areaInsight = useMemo(() => {
    if (areaData.length < 4) return null;
    const mid = Math.floor(areaData.length / 2);
    let firstHalf = 0;
    let secondHalf = 0;
    for (let i = 0; i < areaData.length; i++) {
      const row = areaData[i]!;
      const rowTotal = Object.keys(row).reduce((s, k) => {
        if (k === 'date') return s;
        const val = row[k as keyof typeof row];
        return s + (typeof val === 'number' ? val : 0);
      }, 0);
      if (i < mid) firstHalf += rowTotal;
      else secondHalf += rowTotal;
    }
    if (firstHalf === 0) return 'Usage is ramping up from zero in the earlier period';
    const pctChange = Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
    if (pctChange > 5) return `Usage up ${pctChange}% vs previous period`;
    if (pctChange < -5) return `Usage down ${Math.abs(pctChange)}% vs previous period`;
    return 'Usage is stable compared to previous period';
  }, [areaData]);

  const personaInsight = useMemo(() => {
    if (personaBarData.length < 2) return null;
    const avg = personaBarData.reduce((s, p) => s + p.invocations, 0) / personaBarData.length;
    if (avg === 0) return null;
    const top = personaBarData[0]!;
    const ratio = top.invocations / avg;
    if (ratio >= 2) return `${top.name} uses ${ratio.toFixed(1)}x more tools than average`;
    return `${top.name} is the most active with ${top.invocations.toLocaleString()} invocations`;
  }, [personaBarData]);

  const isEmpty =
    toolUsageSummary.length === 0 &&
    toolUsageOverTime.length === 0 &&
    toolUsageByPersona.length === 0;

  return (
    <ContentBox>
      <ContentHeader
        icon={<BarChart3 className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Usage Analytics"
        subtitle={<>{toolUsageSummary.length} tool{toolUsageSummary.length !== 1 ? 's' : ''} &middot; {pieTotal.toLocaleString()} invocation{pieTotal !== 1 ? 's' : ''}</>}
      />

      {/* Filter bar */}
      <div className="px-4 md:px-6 py-3 border-b border-primary/10 flex items-center gap-4 flex-wrap flex-shrink-0">
        <PersonaSelect value={selectedPersonaId || ''} onChange={(v) => setSelectedPersonaId(v || null)} personas={personas} />
        <DayRangePicker value={days} onChange={setDays} />
      </div>

      {/* Content */}
      <ContentBody flex>
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-foreground/90">
            <Loader2 className="w-8 h-8 animate-spin text-primary/70" />
            <p className="text-sm">Loading usage analytics...</p>
          </div>
        ) : isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.05),transparent_50%)] pointer-events-none" />
            <div className="max-w-sm w-full flex flex-col items-center gap-6 relative z-10">
              <div className="relative group">
                <div className="absolute -inset-4 bg-violet-500/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-primary/5 border border-primary/10 shadow-sm flex items-center justify-center relative">
                  <BarChart3 className="w-8 h-8 text-primary/70 group-hover:scale-110 transition-transform duration-500" />
                  <div className="absolute inset-0 border border-white/5 rounded-2xl" />
                </div>
                <Sparkles className="w-5 h-5 text-amber-400 absolute -top-2 -right-2 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)] animate-pulse" />
              </div>
              <div className="text-center space-y-2.5">
                <h3 className="text-xl font-bold text-foreground/90 tracking-tight">Your analytics dashboard</h3>
                <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-[280px] mx-auto">
                  When your personas run and use tools, you'll see detailed charts showing
                  which tools are used most, usage trends, and breakdowns.
                </p>
              </div>
              <div className="w-full space-y-2.5 mt-2">
                {[
                  { step: '1', label: 'Create a persona', done: personas.length > 0 },
                  { step: '2', label: 'Assign tools to it', done: false },
                  { step: '3', label: 'Run an execution', done: false },
                ].map(({ step, label, done }) => (
                  <div
                    key={step}
                    className={`flex items-center gap-3.5 px-4 py-3 rounded-xl border transition-all ${
                      done ? 'bg-emerald-500/5 border-emerald-500/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]' : 'bg-secondary/40 border-primary/10 shadow-sm'
                    }`}
                  >
                    <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black tracking-wider ${
                      done ? 'bg-emerald-500/20 text-emerald-400 shadow-inner' : 'bg-primary/10 text-muted-foreground/70'
                    }`}>{step}</span>
                    <span className={`text-xs font-medium ${done ? 'text-emerald-400' : 'text-foreground/80'}`}>{label}</span>
                    {done && <span className="ml-auto text-[11px] font-bold uppercase tracking-widest text-emerald-400/60 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">Done</span>}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setSidebarSection('personas')}
                className="mt-2 flex items-center justify-center w-full gap-2 px-5 py-3 bg-gradient-to-b from-primary/15 to-primary/5 hover:from-primary/20 hover:to-primary/10 active:scale-[0.98] text-primary border border-primary/20 rounded-xl text-sm font-bold transition-all group shadow-sm"
              >
                {personas.length > 0 ? (
                  <><Play className="w-4 h-4 fill-primary/20" />Run a persona</>
                ) : (
                  <>Get started</>
                )}
                <ArrowRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 md:p-6 space-y-6">

      {/* ── Top Row: Bar Chart + Pie Chart ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Tool Invocations (horizontal bar) */}
        <MetricChart title="Tool Invocations" insight={barInsight} height={Math.max(200, barData.length * 40)} className="lg:col-span-3">
          <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis dataKey="name" type="category" width={120} tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Bar dataKey="invocations" name="Invocations" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={20} />
          </BarChart>
        </MetricChart>

        {/* Distribution (pie) */}
        <MetricChart title="Distribution" insight={pieInsight} height={260} className="lg:col-span-2">
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="value" nameKey="name" stroke="none">
              {pieData.map((_, idx) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Pie>
            {/* Donut center total */}
            <text x="50%" y="46%" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-lg font-bold">
              {pieTotal.toLocaleString()}
            </text>
            <text x="50%" y="58%" textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground/50 text-sm">
              total
            </text>
            <Tooltip content={<ChartTooltip />} />
            <Legend verticalAlign="bottom" iconType="circle" iconSize={8} formatter={(value: string) => (
              <span className="text-sm text-foreground/90">{value}</span>
            )} />
          </PieChart>
        </MetricChart>
      </div>

      {/* ── Usage Over Time (stacked area) ─────────────────────── */}
      {areaData.length > 0 && (
        <MetricChart title="Usage Over Time" insight={areaInsight} height={280}>
          <AreaChart data={areaData} margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis dataKey="date" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
            <YAxis tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Legend verticalAlign="top" iconType="circle" iconSize={8} formatter={(value: string) => (
              <span className="text-sm text-foreground/90">{formatToolName(value)}</span>
            )} />
            {allToolNames.map((toolName, idx) => (
              <Area key={toolName} type="monotone" dataKey={toolName} name={toolName} stackId="1" fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.3} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={1.5} />
            ))}
          </AreaChart>
        </MetricChart>
      )}

      {/* ── By Persona (horizontal bar) ───────────────────────── */}
      {personaBarData.length > 0 && (
        <MetricChart title="By Persona" insight={personaInsight} height={Math.max(180, personaBarData.length * 44)}>
          <BarChart data={personaBarData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis dataKey="name" type="category" width={140} tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Bar dataKey="invocations" name="Invocations" radius={[0, 4, 4, 0]} barSize={22}>
              {personaBarData.map((entry, idx) => (
                <Cell key={idx} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </MetricChart>
      )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
