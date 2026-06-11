// KPI dashboard (P5 round 2) — a CHART-FIRST command center over ALL
// projects' KPIs, built on the app's recharts stack (LazyChart wrapper).
// Visual hierarchy: a needs-attention strip (off-track KPIs as destructive
// chips), a summary stat row, then two charts — "Distance to target"
// (horizontal pace-colored bars, one per KPI) and "Trend" (progress-vs-target
// lines from the measurement series). Everything clicks through to the
// detail drawer; prose lives THERE, not on the dashboard. Filter by project.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gauge } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { StatCard } from '@/features/shared/components/display/StatCard';
import { LazyChart } from '@/features/shared/charts/RechartsWrapper';
import { paceDescriptor, kpiProgressPct } from './kpiMath';
import { TRACK_COLOR } from './kpiMeta';

const CHART_ROW_H = 38;

/** Progress toward target as 0–115% (overshoot visible), direction-aware. */
function distancePct(kpi: DevKpi): number | null {
  const pct = kpiProgressPct(kpi);
  if (pct != null) return Math.min(115, pct);
  // No baseline: simple ratio against the target.
  const { current_value: cur, target_value: target } = kpi;
  if (cur == null || target == null || target === 0) return null;
  const ratio = kpi.direction === 'down' ? target / Math.max(cur, 1e-9) : cur / target;
  return Math.min(115, Math.round(ratio * 100));
}

/** Normalize one measurement onto the same axis for the trend chart. */
function normValue(kpi: DevKpi, v: number): number | null {
  const { target_value: target, baseline_value: baseline } = kpi;
  if (target == null) return null;
  if (baseline != null && baseline !== target) {
    return Math.round(((v - baseline) / (target - baseline)) * 100);
  }
  if (target === 0) return null;
  return Math.round((kpi.direction === 'down' ? target / Math.max(v, 1e-9) : v / target) * 100);
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
  const { t, tx } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const projects = useSystemStore((s) => s.projects);
  const kpiTrends = useSystemStore((s) => s.kpiTrends);
  const fetchKpiTrends = useSystemStore((s) => s.fetchKpiTrends);

  const [projectFilter, setProjectFilter] = useState<string | null>(null);

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

  const activeIdsKey = useMemo(() => active.map((k) => k.id).join(','), [active]);
  useEffect(() => {
    if (activeIdsKey) void fetchKpiTrends(activeIdsKey.split(','));
  }, [activeIdsKey, fetchKpiTrends]);

  const paced = useMemo(() => filtered.map((k) => ({ kpi: k, d: paceDescriptor(k) })), [filtered]);
  const offTrack = paced.filter((p) => p.d.track === 'off-track');
  const onTrack = paced.filter((p) => p.d.track === 'on-track').length;
  const met = paced.filter((p) => p.d.track === 'met').length;

  // --- chart models -----------------------------------------------------
  const distanceData = useMemo(
    () =>
      paced
        .map(({ kpi, d }) => ({
          id: kpi.id,
          name: kpi.name,
          project: projectName(kpi.project_id),
          pct: distancePct(kpi) ?? 0,
          fill: TRACK_COLOR[d.track],
          current: kpi.current_value,
          target: kpi.target_value,
          unit: kpi.unit,
        }))
        .sort((a, b) => a.pct - b.pct),
    [paced, projectName],
  );

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
        icon={Gauge}
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

      {/* Needs attention — the only loud element on the page */}
      {offTrack.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-card border border-destructive/30 bg-destructive/5 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
          <span className="typo-label text-foreground">{t.kpis.attention_label}</span>
          {offTrack.map(({ kpi }) => (
            <button
              key={kpi.id}
              type="button"
              onClick={() => onOpen(kpi.id)}
              className="typo-caption text-foreground rounded-interactive border border-destructive/40 bg-destructive/10 hover:bg-destructive/20 transition-colors px-2 py-0.5 tabular-nums"
              data-testid={`kpi-attention-${kpi.id}`}
            >
              {kpi.name} · {kpi.current_value ?? '—'}/{kpi.target_value ?? '—'} {kpi.unit}
            </button>
          ))}
        </div>
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

      {/* Distance to target — pace-colored horizontal bars, click → drawer */}
      <section className="rounded-card border border-primary/15 bg-secondary/10 p-4">
        <h3 className="typo-label text-foreground mb-2">{t.kpis.chart_distance_title}</h3>
        <LazyChart
          fallback={<div className="h-24" />}
          render={(R) => (
            <R.ResponsiveContainer width="100%" height={distanceData.length * CHART_ROW_H + 30}>
              <R.BarChart
                data={distanceData}
                layout="vertical"
                margin={{ top: 0, right: 36, bottom: 0, left: 8 }}
                onClick={(state) => {
                  const payload = (
                    state as unknown as { activePayload?: Array<{ payload?: { id?: string } }> }
                  )?.activePayload?.[0]?.payload;
                  if (payload?.id) onOpen(payload.id);
                }}
              >
                <R.XAxis
                  type="number"
                  domain={[0, 115]}
                  tickFormatter={(v: number) => `${v}%`}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                />
                <R.YAxis
                  type="category"
                  dataKey="name"
                  width={210}
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                />
                <R.ReferenceLine x={100} stroke="var(--success)" strokeDasharray="4 3" />
                <R.Tooltip
                  cursor={{ fill: 'var(--secondary)', opacity: 0.3 }}
                  contentStyle={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={((value: unknown, _n: unknown, item: unknown) => {
                    const p = (
                      item as { payload?: { current?: number | null; target?: number | null; unit?: string; project?: string } }
                    )?.payload;
                    const cur = p?.current ?? '—';
                    const tgt = p?.target ?? '—';
                    return [`${String(value)}% — ${cur} / ${tgt} ${p?.unit ?? ''}`, p?.project ?? ''];
                  }) as never}
                />
                <R.Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={16} cursor="pointer">
                  {distanceData.map((row) => (
                    <R.Cell key={row.id} fill={row.fill} />
                  ))}
                </R.Bar>
              </R.BarChart>
            </R.ResponsiveContainer>
          )}
        />
        <p className="typo-caption text-foreground opacity-70 mt-1">{t.kpis.chart_distance_hint}</p>
      </section>

      {/* Trend — progress vs target over time */}
      {trendModel && (
        <section className="rounded-card border border-primary/15 bg-secondary/10 p-4">
          <h3 className="typo-label text-foreground mb-2">{t.kpis.chart_trend_title}</h3>
          <LazyChart
            fallback={<div className="h-48" />}
            render={(R) => (
              <R.ResponsiveContainer width="100%" height={220}>
                <R.LineChart data={trendModel.rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
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
                  <R.ReferenceLine y={100} stroke="var(--success)" strokeDasharray="4 3" />
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
          <p className="typo-caption text-foreground opacity-70 mt-1">
            {tx(t.kpis.chart_trend_hint, { count: trendModel.series.length })}
          </p>
        </section>
      )}
    </div>
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
