import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  AlertTriangle,
  Activity,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  Wrench,
  Zap,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { getSlaDashboard } from '@/api/overview/sla';
import type { SlaDashboardData, PersonaSlaStats } from '@/api/overview/sla';

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

export default function SLADashboard() {
  const [data, setData] = useState<SlaDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number>(30);
  const [expandedPersona, setExpandedPersona] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getSlaDashboard(days)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const togglePersona = (id: string) => {
    setExpandedPersona((prev) => (prev === id ? null : id));
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title="Agent Reliability SLA"
        subtitle="Uptime, failure rates, and healing metrics across your agent fleet"
        actions={
          <div className="flex items-center gap-1.5">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 text-xs rounded-xl transition-colors ${
                  days === d
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'text-muted-foreground/70 hover:text-foreground/80 hover:bg-primary/5 border border-transparent'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        }
      />

      <ContentBody centered>
        {loading && !data ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground/70">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading SLA data...
          </div>
        ) : !data ? (
          <div className="text-center py-20 text-muted-foreground/70">
            No execution data available.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Global SLA cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SlaCard
                label="Success Rate"
                value={formatPercent(data.global.success_rate)}
                sub={`${data.global.successful}/${data.global.total_executions} executions`}
                color={slaColor(data.global.success_rate)}
                icon={<Shield className="w-4 h-4" />}
              />
              <SlaCard
                label="Avg Latency"
                value={formatDuration(data.global.avg_duration_ms)}
                sub={`${data.global.active_persona_count} active agents`}
                color="blue"
                icon={<Clock className="w-4 h-4" />}
              />
              <SlaCard
                label="Open Issues"
                value={String(data.healing_summary.open_issues)}
                sub={`${data.healing_summary.circuit_breaker_count} circuit breakers`}
                color={data.healing_summary.open_issues > 0 ? 'amber' : 'emerald'}
                icon={<AlertTriangle className="w-4 h-4" />}
              />
              <SlaCard
                label="Auto-Healed"
                value={String(data.healing_summary.auto_fixed_count)}
                sub={`${data.healing_summary.knowledge_patterns} known patterns`}
                color="violet"
                icon={<Wrench className="w-4 h-4" />}
              />
            </div>

            {/* Daily trend */}
            {data.daily_trend.length > 0 && (
              <div className="rounded-xl border border-primary/10 bg-card-bg p-5 space-y-3">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                  Daily Success Rate — {days} Days
                </h2>
                <DailyTrendChart points={data.daily_trend} />
              </div>
            )}

            {/* Per-persona SLA table */}
            <div className="rounded-xl border border-primary/10 bg-card-bg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-primary/10">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                  Per-Agent Reliability
                </h2>
              </div>

              {data.persona_stats.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground/60">
                  No agents have executed in this period.
                </div>
              ) : (
                <div className="divide-y divide-primary/5">
                  {data.persona_stats.map((ps) => (
                    <PersonaRow
                      key={ps.persona_id}
                      stats={ps}
                      expanded={expandedPersona === ps.persona_id}
                      onToggle={() => togglePersona(ps.persona_id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SlaCard({
  label,
  value,
  sub,
  color,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  icon: React.ReactNode;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  };
  const cls = colorMap[color] || colorMap['emerald'];

  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-mono uppercase tracking-wider opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-60 mt-1">{sub}</div>
    </div>
  );
}

function PersonaRow({
  stats,
  expanded,
  onToggle,
}: {
  stats: PersonaSlaStats;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rateColor =
    stats.success_rate >= 0.99
      ? 'text-emerald-400'
      : stats.success_rate >= 0.95
        ? 'text-amber-400'
        : 'text-red-400';

  const rateBg =
    stats.success_rate >= 0.99
      ? 'bg-emerald-500/10 border-emerald-500/20'
      : stats.success_rate >= 0.95
        ? 'bg-amber-500/10 border-amber-500/20'
        : 'bg-red-500/10 border-red-500/20';

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full px-5 py-3 flex items-center gap-4 hover:bg-primary/5 transition-colors text-left"
      >
        {/* Name */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground/90 truncate block">
            {stats.persona_name}
          </span>
          <span className="text-xs text-muted-foreground/60">
            {stats.total_executions} executions
          </span>
        </div>

        {/* SLA badge */}
        <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full border ${rateColor} ${rateBg}`}>
          {formatPercent(stats.success_rate)}
        </span>

        {/* Consecutive failures indicator */}
        {stats.consecutive_failures > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">
            {stats.consecutive_failures} failing
          </span>
        )}

        {/* Auto-healed badge */}
        {stats.auto_healed_count > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">
            {stats.auto_healed_count} healed
          </span>
        )}

        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground/50" />
        )}
      </button>

      {expanded && (
        <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat icon={<Activity className="w-3.5 h-3.5" />} label="Successful" value={String(stats.successful)} />
          <MiniStat icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Failed" value={String(stats.failed)} />
          <MiniStat icon={<Clock className="w-3.5 h-3.5" />} label="Avg Latency" value={formatDuration(stats.avg_duration_ms)} />
          <MiniStat icon={<Zap className="w-3.5 h-3.5" />} label="P95 Latency" value={formatDuration(stats.p95_duration_ms)} />
          <MiniStat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Cost" value={`$${stats.total_cost_usd.toFixed(2)}`} />
          <MiniStat
            icon={<TrendingDown className="w-3.5 h-3.5" />}
            label="MTBF"
            value={stats.mtbf_seconds != null ? formatMtbf(stats.mtbf_seconds) : 'N/A'}
          />
          <MiniStat icon={<Wrench className="w-3.5 h-3.5" />} label="Auto-Healed" value={String(stats.auto_healed_count)} />
          <MiniStat
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
            label="Cancelled"
            value={String(stats.cancelled)}
          />
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 px-3 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground/60 mb-0.5">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-sm font-semibold text-foreground/90">{value}</div>
    </div>
  );
}

function DailyTrendChart({ points }: { points: { date: string; success_rate: number; total: number }[] }) {
  if (points.length === 0) return null;

  const maxTotal = Math.max(...points.map((p) => p.total), 1);
  const barWidth = Math.max(4, Math.min(16, Math.floor(600 / points.length)));

  return (
    <div className="flex items-end gap-px h-24 overflow-x-auto">
      {points.map((p, i) => {
        const h = Math.max(2, (p.total / maxTotal) * 80);
        const color =
          p.success_rate >= 0.99
            ? 'bg-emerald-500/60'
            : p.success_rate >= 0.95
              ? 'bg-amber-500/60'
              : 'bg-red-500/60';

        return (
          <div
            key={i}
            className="flex flex-col items-center justify-end flex-shrink-0"
            style={{ width: barWidth }}
            title={`${p.date}: ${formatPercent(p.success_rate)} (${p.total} runs)`}
          >
            <div
              className={`w-full rounded-t-sm ${color}`}
              style={{ height: h }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Formatters
// ============================================================================

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatMtbf(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function slaColor(rate: number): string {
  if (rate >= 0.99) return 'emerald';
  if (rate >= 0.95) return 'amber';
  return 'red';
}
