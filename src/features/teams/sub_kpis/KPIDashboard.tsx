// KPI dashboard (P5 round 2) — a CHART-FIRST command center over ALL
// projects' KPIs, built on the app's recharts stack (LazyChart wrapper).
// Visual hierarchy: a needs-attention strip (off-track KPIs as destructive
// chips), a summary stat row, then two charts — "Distance to target"
// (horizontal pace-colored bars, one per KPI) and "Trend" (progress-vs-target
// lines from the measurement series). Everything clicks through to the
// detail drawer; prose lives THERE, not on the dashboard. Filter by project.
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, type LucideIcon } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { KPIS_GLYPH } from '@/features/shared/glyph/glyphs/kpisGlyph';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { SegmentedTabs, type SegmentedTab } from '@/features/shared/components/layout/SegmentedTabs';
import { paceDescriptor, kpiOffTrackReason } from './kpiMath';
import { TRACK_COLOR } from './kpiMeta';
import { AutopilotControl } from './AutopilotControl';
import { distancePct, type DistanceGroup, type DistanceRow } from './kpiDistance';
import { KpiSignalBoard, type SignalVariant } from './KpiSignalBoard';

// TEMP prototype switcher — A/B how "Needs attention" combines with "Distance
// to target". Removed at consolidation (only the winner survives).
const SIGNAL_VARIANTS: SegmentedTab<SignalVariant>[] = [
  { id: 'separate', label: 'Separate (today)' },
  { id: 'unified', label: 'Unified board' },
  { id: 'split', label: 'Split panes' },
];

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
  // Context map (active project) — resolves each KPI's context/group name so the
  // Distance-to-target section can group by context (the retired "By context"
  // view, folded in here). KPIs whose context isn't in the active project's map
  // fall into "Ungrouped".
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const contexts = useSystemStore((s) => s.contexts);
  const contextGroups = useSystemStore((s) => s.contextGroups);
  const fetchContexts = useSystemStore((s) => s.fetchContexts);
  const fetchContextGroups = useSystemStore((s) => s.fetchContextGroups);

  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [signalVariant, setSignalVariant] = useState<SignalVariant>('separate');

  useEffect(() => {
    if (!activeProjectId) return;
    void fetchContexts(activeProjectId);
    void fetchContextGroups(activeProjectId);
  }, [activeProjectId, fetchContexts, fetchContextGroups]);

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
  const contextName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contexts) m.set(c.id, c.name);
    return m;
  }, [contexts]);
  const groupName = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of contextGroups) m.set(g.id, g.name);
    return m;
  }, [contextGroups]);

  // Distance-to-target rows grouped by context. Each group's rows are sorted by
  // KPI name (asc); groups are named-context-first (alpha), Ungrouped last.
  const distanceGroups = useMemo<DistanceGroup[]>(() => {
    const groups = new Map<string, DistanceGroup>();
    for (const { kpi, d } of paced) {
      const cn = kpi.context_id ? contextName.get(kpi.context_id) : undefined;
      const gn = !cn && kpi.context_group_id ? groupName.get(kpi.context_group_id) : undefined;
      let key: string, label: string, order: number;
      if (cn) { key = `ctx:${kpi.context_id}`; label = cn; order = 0; }
      else if (gn) { key = `grp:${kpi.context_group_id}`; label = gn; order = 0; }
      else { key = 'ungrouped'; label = t.kpis.rollup_ungrouped; order = 1; }
      let entry = groups.get(key);
      if (!entry) { entry = { key, label, order, rows: [] }; groups.set(key, entry); }
      const row: DistanceRow = {
        id: kpi.id,
        name: kpi.name,
        project: projectName(kpi.project_id),
        pct: distancePct(kpi) ?? 0,
        fill: TRACK_COLOR[d.track],
        current: kpi.current_value,
        target: kpi.target_value,
        unit: kpi.unit,
        track: d.track,
        reason: kpiOffTrackReason(kpi),
      };
      entry.rows.push(row);
    }
    const arr = [...groups.values()];
    for (const e of arr) e.rows.sort((a, b) => a.name.localeCompare(b.name));
    arr.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    return arr;
  }, [paced, contextName, groupName, projectName, t]);

  const trendModel = useMemo(() => {
    const series = filtered
      .map((kpi) => {
        const ms = kpiTrends[kpi.id] ?? [];
        const pts = ms
          .map((m) => ({
            t: new Date(m.measured_at.replace(' ', 'T')).getTime(),
            v: normValue(kpi, m.value),
          }))
          .filter((p): p is { t: number; v: number } => Number.isFinite(p.t) && p.v != null);
        return { kpi, pts };
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
  }, [filtered, kpiTrends]);

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

      {/* TEMP prototype switcher (removed at consolidation) */}
      <div className="flex items-center gap-2">
        <span className="typo-caption text-foreground/60">Attention + Distance:</span>
        <SegmentedTabs
          tabs={SIGNAL_VARIANTS}
          activeTab={signalVariant}
          onTabChange={setSignalVariant}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel="Signal board prototype variant"
        />
      </div>

      {/* Needs attention + Distance to target — combined per the active variant. */}
      <KpiSignalBoard
        variant={signalVariant}
        offTrack={offTrack.map((o) => o.kpi)}
        distanceGroups={distanceGroups}
        projectName={projectName}
        onOpen={onOpen}
      />

      {/* Trend — progress vs target over time */}
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
                    formatter={(id: string) =>
                      trendModel.series.find((s) => s.kpi.id === id)?.kpi.name ?? id
                    }
                  />
                  {trendModel.series.map(({ kpi }) => (
                    <R.Line
                      key={kpi.id}
                      dataKey={kpi.id}
                      type="monotone"
                      connectNulls
                      stroke={TRACK_COLOR[paceDescriptor(kpi).track]}
                      strokeWidth={2}
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
