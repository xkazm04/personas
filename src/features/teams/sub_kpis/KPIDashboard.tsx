// KPI dashboard — a CHART-FIRST command center over ALL projects' KPIs, built
// on the app's recharts stack (LazyChart wrapper). Visual hierarchy: a summary
// stat row, then the KpiSignalBoard ("Distance to target" grouped BY PROJECT,
// with each project's off-track alerts injected at the head of its card), then
// "Trend" (progress-vs-target lines from the measurement series). Everything
// clicks through to the KPI detail modal; prose lives THERE, not on the
// dashboard. Filter by project.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, type LucideIcon } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { KPIS_GLYPH } from '@/features/shared/glyph/glyphs/kpisGlyph';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { paceDescriptor, kpiOffTrackReason, type PaceDescriptor } from './kpiMath';
import { TRACK_COLOR } from './kpiMeta';
import { AutopilotControl } from './AutopilotControl';
import { distancePct, type DistanceGroup, type DistanceRow } from './kpiDistance';
import { KpiSignalBoard } from './KpiSignalBoard';
import { KpiSimControl } from './KpiSimControl';
import { KpiSimSuggestions } from './KpiSimSuggestions';

/** Observation channels for the trend chart. Production is the authoritative
 *  channel (pace/status/autopilot always read it); test/local carry the
 *  LLM-engine simulation series — advisory, rendered dashed. */
type KpiEnv = 'production' | 'test' | 'local';
const ENVS: KpiEnv[] = ['production', 'test', 'local'];

/** Normalize one measurement onto the same axis for the trend chart. */
function normValue(kpi: DevKpi, v: number): number | null {
  const { target_value: target, baseline_value: baseline } = kpi;
  if (target == null) return null;
  // Clamp to the same [-15, 115] band as distancePct. Without this, a near-zero
  // measurement on a 'down' KPI made `target / Math.max(v, 1e-9)` astronomically
  // large, producing an off-axis spike that flattened every other point on the
  // trend chart.
  const clamp = (n: number) => Math.max(-15, Math.min(115, Math.round(n)));
  if (baseline != null && baseline !== target) {
    return clamp(((v - baseline) / (target - baseline)) * 100);
  }
  if (target === 0) return null;
  return clamp((kpi.direction === 'down' ? target / Math.max(v, 1e-9) : v / target) * 100);
}

export function KPIDashboard({
  loading,
  onOpen,
  onReviewProposals,
}: {
  loading: boolean;
  onOpen: (kpiId: string) => void;
  onReviewProposals: () => void;
}) {
  const { t } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const projects = useSystemStore((s) => s.projects);
  const kpiTrends = useSystemStore((s) => s.kpiTrends);
  const fetchKpiTrends = useSystemStore((s) => s.fetchKpiTrends);

  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [envFilter, setEnvFilter] = useState<KpiEnv>('production');

  const projectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, p.name);
    return (id: string) => m.get(id) ?? '—';
  }, [projects]);

  const active = useMemo(() => kpis.filter((k) => k.status === 'active'), [kpis]);
  const filtered = useMemo(
    () => (projectFilter ? active.filter((k) => k.project_id === projectFilter) : active),
    [active, projectFilter],
  );
  const kpiProjects = useMemo(() => [...new Set(active.map((k) => k.project_id))], [active]);
  const hasProposals = useMemo(() => kpis.some((k) => k.status === 'proposed'), [kpis]);
  // The project whose autopilot the switch controls: the active filter, or the
  // sole project when there's only one. With multiple projects and "All"
  // selected, there's no single target — pick one via the filter chips first.
  const autopilotProject = projectFilter ?? (kpiProjects.length === 1 ? kpiProjects[0] : null);

  const activeIdsKey = useMemo(() => active.map((k) => k.id).join(','), [active]);
  useEffect(() => {
    if (activeIdsKey) void fetchKpiTrends(activeIdsKey.split(','));
  }, [activeIdsKey, fetchKpiTrends]);

  const paced = useMemo(() => filtered.map((k) => ({ kpi: k, d: paceDescriptor(k) })), [filtered]);
  const offTrack = paced.filter((p) => p.d.track === 'off-track');
  const onTrack = paced.filter((p) => p.d.track === 'on-track').length;
  const met = paced.filter((p) => p.d.track === 'met').length;

  // --- chart models -----------------------------------------------------
  /** One distance row per KPI — the shared model behind the grouping. */
  const buildRow = useCallback(
    (kpi: DevKpi, d: PaceDescriptor): DistanceRow => ({
      id: kpi.id,
      name: kpi.name,
      projectId: kpi.project_id,
      project: projectName(kpi.project_id),
      pct: distancePct(kpi) ?? 0,
      fill: TRACK_COLOR[d.track],
      current: kpi.current_value,
      target: kpi.target_value,
      unit: kpi.unit,
      track: d.track,
      reason: kpiOffTrackReason(kpi),
      category: kpi.category,
    }),
    [projectName],
  );

  // Distance rows grouped BY PROJECT (name asc), so the off-track alerts can be
  // injected inside each project's own card.
  const projectGroups = useMemo<DistanceGroup[]>(() => {
    const groups = new Map<string, DistanceGroup>();
    for (const { kpi, d } of paced) {
      const key = kpi.project_id;
      let entry = groups.get(key);
      if (!entry) { entry = { key, label: projectName(key), order: 0, rows: [] }; groups.set(key, entry); }
      entry.rows.push(buildRow(kpi, d));
    }
    const arr = [...groups.values()];
    for (const e of arr) e.rows.sort((a, b) => a.name.localeCompare(b.name));
    arr.sort((a, b) => a.label.localeCompare(b.label));
    return arr;
  }, [paced, projectName, buildRow]);

  const trendModel = useMemo(() => {
    const series = filtered
      .map((kpi) => {
        // One env at a time — legacy rows (pre env-axis) count as production.
        const ms = (kpiTrends[kpi.id] ?? []).filter(
          (m) => (m.env ?? 'production') === envFilter,
        );
        const simulated = ms.some((m) => m.source === 'simulation');
        const pts = ms
          .map((m) => ({
            t: new Date(m.measured_at.replace(' ', 'T')).getTime(),
            v: normValue(kpi, m.value),
          }))
          .filter((p): p is { t: number; v: number } => Number.isFinite(p.t) && p.v != null);
        return { kpi, pts, simulated };
      })
      .filter((s) => s.pts.length >= 2);
    if (series.length === 0) return null;
    const stamps = [...new Set(series.flatMap((s) => s.pts.map((p) => p.t)))].sort((a, b) => a - b);
    const rows = stamps.map((ts) => {
      const row: Record<string, number | string> = { t: ts };
      for (const s of series) {
        const exact = s.pts.find((p) => p.t === ts);
        if (exact) row[s.kpi.id] = exact.v;
      }
      return row;
    });
    return { series, rows };
  }, [filtered, kpiTrends, envFilter]);

  if (loading && kpis.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }
  if (active.length === 0) {
    return (
      <EmptyState
        glyph={KPIS_GLYPH}
        title={t.kpis.empty_title}
        description={hasProposals ? t.kpis.empty_with_proposals_hint : t.kpis.empty_hint}
        action={
          hasProposals
            ? { label: t.kpis.review_proposals_cta, onClick: onReviewProposals }
            : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="kpi-dashboard">
      {/* Project filter */}
      {kpiProjects.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip active={projectFilter === null} onClick={() => setProjectFilter(null)}>
            {t.kpis.filter_all_projects}
          </FilterChip>
          {kpiProjects.map((pid) => (
            <FilterChip key={pid} active={projectFilter === pid} onClick={() => setProjectFilter(pid)}>
              {projectName(pid)}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Per-project autopilot — the single switch over this project's
          KPI → goal → team loop (D2). Shown for the selected/sole project. */}
      {autopilotProject && (
        <AutopilotControl projectId={autopilotProject} className="rounded-card border border-primary/15 bg-secondary/10 px-4 py-3" />
      )}

      {/* Simulation dispatch — the long Dev-runner operation for the selected
          project (kpi-simulation-skill P1/P2). */}
      {autopilotProject && (
        <div className="rounded-card border border-primary/15 bg-secondary/10 px-4 py-3">
          <KpiSimControl projectId={autopilotProject} onIngested={() => { if (activeIdsKey) void fetchKpiTrends(activeIdsKey.split(',')); }} />
        </div>
      )}

      {/* Sim suggestions — one-click apply of the sim's adopt/adjust/retire
          proposals (P3 adoption path). Renders only when there are any. */}
      {autopilotProject && (
        <KpiSimSuggestions projectId={autopilotProject} onApplied={() => { if (activeIdsKey) void fetchKpiTrends(activeIdsKey.split(',')); }} />
      )}

      {/* Environment switcher — which observation channel the trend reads.
          Production is authoritative; test/local are the simulated channels. */}
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="kpi-env-switcher">
        <span className="typo-label text-foreground/45">{t.kpis.env_filter_label}</span>
        {ENVS.map((env) => (
          <FilterChip key={env} active={envFilter === env} onClick={() => setEnvFilter(env)}>
            {t.kpis.env_labels[env]}
          </FilterChip>
        ))}
        {envFilter !== 'production' && (
          <span className="typo-caption text-foreground/60" data-testid="kpi-env-sim-caption">
            {t.kpis.env_sim_caption}
          </span>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label={t.kpis.stat_active} value={filtered.length} />
        <StatCard label={t.kpis.stat_on_track} value={onTrack} tone="success" />
        <StatCard
          label={t.kpis.stat_off_track}
          value={offTrack.length}
          tone={offTrack.length ? 'danger' : 'neutral'}
        />
        <StatCard label={t.kpis.stat_met} value={met} tone={met ? 'success' : 'neutral'} />
      </div>

      {/* Distance to target, grouped by project, with each project's off-track
          alerts injected at the head of its card. */}
      <KpiSignalBoard projectGroups={projectGroups} onOpen={onOpen} />

      {/* Trend — progress vs target over time */}
      {!trendModel && envFilter !== 'production' && (
        <p className="typo-caption text-foreground/60 rounded-card border border-primary/15 bg-secondary/10 px-4 py-3">
          {t.kpis.env_no_sim_series}
        </p>
      )}
      {trendModel && (
        <ChartPanel title={t.kpis.chart_trend_title} icon={TrendingUp}>
          <LazyChart
            fallback={<div className="h-48" />}
            render={(R) => (
              <R.ResponsiveContainer width="100%" height={220}>
                <R.LineChart accessibilityLayer={false} data={trendModel.rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <R.CartesianGrid stroke="var(--secondary)" strokeOpacity={0.5} vertical={false} />
                  <R.XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={(ts: number) => new Date(ts).toLocaleDateString()}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                  />
                  <R.YAxis
                    tickFormatter={(v: number) => `${v}%`}
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    width={42}
                  />
                  <R.ReferenceLine y={100} stroke="var(--status-success)" strokeDasharray="4 3" />
                  <R.Tooltip
                    labelFormatter={((ts: unknown) => new Date(Number(ts)).toLocaleString()) as never}
                    contentStyle={{
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <R.Legend
                    formatter={(id: string) => {
                      const s = trendModel.series.find((x) => x.kpi.id === id);
                      if (!s) return id;
                      return s.simulated ? `${s.kpi.name} · ${t.kpis.trend_sim_suffix}` : s.kpi.name;
                    }}
                  />
                  {trendModel.series.map(({ kpi, simulated }) => (
                    <R.Line
                      key={kpi.id}
                      dataKey={kpi.id}
                      type="monotone"
                      connectNulls
                      stroke={TRACK_COLOR[paceDescriptor(kpi).track]}
                      strokeWidth={2}
                      // Simulated (LLM-engine) series read dashed — visually
                      // distinct from real telemetry at a glance.
                      strokeDasharray={simulated ? '6 4' : undefined}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5, onClick: () => onOpen(kpi.id) }}
                    />
                  ))}
                </R.LineChart>
              </R.ResponsiveContainer>
            )}
          />
        </ChartPanel>
      )}
    </div>
  );
}

/** Titled chart panel — shared chrome for the dashboard's chart sections so
 *  every panel reads identically (border, surface tint, header, and the
 *  recharts focus-outline resets that would otherwise be copy-pasted). */
function ChartPanel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-primary/15 bg-secondary/10 p-4 [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none [&_svg]:outline-none">
      <h3 className="flex items-center gap-1.5 typo-overline text-foreground mb-3">
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`typo-caption rounded-interactive border px-2.5 py-1 transition-colors ${
        active
          ? 'border-primary/50 bg-primary/15 text-foreground font-medium'
          : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/40'
      }`}
    >
      {children}
    </button>
  );
}
