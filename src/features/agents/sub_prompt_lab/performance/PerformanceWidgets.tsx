import { AlertTriangle, GitBranch, Calendar, TrendingUp, Layers, RefreshCw } from 'lucide-react';
import type { PromptPerformancePoint } from '@/lib/bindings/PromptPerformancePoint';
import type { MetricAnomaly } from '@/lib/bindings/MetricAnomaly';
import type { VersionMarker } from '@/lib/bindings/VersionMarker';
import { ANOMALY_LABEL, VERSION_COLORS, PERIOD_OPTIONS, fmtDate, fmtCost, fmtMs, fmtPct, useSummaryTotals } from './performanceHelpers';

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export interface TipEntry { name: string; value: number; color: string; dataKey: string }

export function DashTooltip({
  active, payload, label, formatter,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string;
  formatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background/95 backdrop-blur border border-foreground/10 rounded-xl shadow-2xl px-4 py-3 max-w-xs">
      {label && <p className="text-sm text-muted-foreground/80 mb-1.5">{fmtDate(label)}</p>}
      {payload.map((e, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
          <span className="text-foreground/80">{e.name}:</span>
          <span className="text-foreground font-medium font-mono">
            {formatter ? formatter(e.value, e.dataKey) : e.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Anomaly Dots ────────────────────────────────────────────────────────────

export function AnomalyDot({
  anomaly,
  onNavigate,
}: {
  anomaly: MetricAnomaly;
  onNavigate?: (executionId: string) => void;
}) {
  return (
    <button
      onClick={() => anomaly.execution_id && onNavigate?.(anomaly.execution_id)}
      className="group relative"
      title={`${ANOMALY_LABEL[anomaly.metric] ?? anomaly.metric}: ${anomaly.deviation_pct.toFixed(0)}% above baseline${anomaly.execution_id ? ' — click to inspect' : ''}`}
    >
      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm font-medium bg-red-500/15 text-red-400 border border-red-500/20 group-hover:bg-red-500/25 transition-colors">
        <AlertTriangle className="w-2.5 h-2.5" />
        {ANOMALY_LABEL[anomaly.metric] ?? anomaly.metric}
      </span>
    </button>
  );
}

// ─── Summary Cards ───────────────────────────────────────────────────────────

export function SummaryCards({ points }: { points: PromptPerformancePoint[] }) {
  const totals = useSummaryTotals(points);

  const cards = [
    { label: 'Total Executions', value: totals.totalExecs.toLocaleString(), sub: `${points.length} days` },
    { label: 'Avg Cost', value: fmtCost(totals.avgCost), sub: 'per execution' },
    { label: 'Median Latency', value: fmtMs(totals.medianLatency), sub: 'p50' },
    { label: 'Error Rate', value: fmtPct(totals.errorRate), sub: totals.errorRate > 0.2 ? 'high' : totals.errorRate > 0.05 ? 'moderate' : 'healthy' },
    { label: 'Token Ratio', value: `${totals.avgTokenRatio.toFixed(2)}x`, sub: 'out/in' },
  ];

  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2.5">
          <div className="text-sm uppercase tracking-wider text-muted-foreground/60 font-mono">{c.label}</div>
          <div className="text-lg font-semibold text-foreground/90 font-mono mt-0.5">{c.value}</div>
          <div className="text-sm text-muted-foreground/50">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard Toolbar ──────────────────────────────────────────────────────

interface DashboardToolbarProps {
  anomalyCount: number;
  days: number;
  setDays: (d: number) => void;
  compareMode: boolean;
  toggleCompare: () => void;
  onRefresh: () => void;
}

export function DashboardToolbar({ anomalyCount, days, setDays, compareMode, toggleCompare, onRefresh }: DashboardToolbarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary/70" />
        <h3 className="text-sm font-medium text-foreground/80">Performance</h3>
        {anomalyCount > 0 && (
          <span className="px-1.5 py-0.5 text-sm font-medium rounded-lg bg-red-500/10 text-red-400 border border-red-500/20">
            {anomalyCount} anomal{anomalyCount === 1 ? 'y' : 'ies'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 bg-secondary/30 rounded-lg p-0.5">
          {PERIOD_OPTIONS.map((p) => (
            <button key={p} onClick={() => setDays(p)} className={`px-2 py-1 text-sm font-mono rounded-lg transition-colors ${days === p ? 'bg-primary/15 text-foreground/80 border border-primary/20' : 'text-muted-foreground/50 hover:text-muted-foreground/70'}`}>{p}d</button>
          ))}
        </div>
        <button onClick={toggleCompare} className={`flex items-center gap-1 px-2 py-1 text-sm rounded-lg transition-colors ${compareMode ? 'bg-primary/15 text-primary/80 border border-primary/20' : 'text-muted-foreground/50 hover:text-muted-foreground/70 border border-transparent'}`}>
          <Layers className="w-3 h-3" />Compare
        </button>
        <button onClick={onRefresh} className="p-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Version Timeline ────────────────────────────────────────────────────────

export function VersionTimeline({ markers }: { markers: VersionMarker[] }) {
  if (markers.length === 0) return null;
  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="w-3.5 h-3.5 text-primary/60" />
        <h4 className="text-sm font-medium text-foreground/70 uppercase tracking-wider">Version Timeline</h4>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {markers.map((v) => (
          <div key={v.version_id} className="flex-shrink-0 flex items-center gap-2 px-2.5 py-1.5 bg-background/40 border border-border/20 rounded-xl">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: VERSION_COLORS[v.tag] ?? '#71717a' }} />
            <span className="text-sm font-mono text-foreground/80">v{v.version_number}</span>
            <span className="text-sm text-muted-foreground/50">{v.tag}</span>
            <span className="text-sm text-muted-foreground/60 flex items-center gap-0.5">
              <Calendar className="w-2.5 h-2.5" />
              {fmtDate(v.created_at.slice(0, 10))}
            </span>
            {v.change_summary && (
              <span className="text-sm text-muted-foreground/60 max-w-[120px] truncate" title={v.change_summary}>
                {v.change_summary}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
