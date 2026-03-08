import { Activity, AlertTriangle, Clock, ChevronDown, ChevronUp, Zap, TrendingUp, TrendingDown, Wrench } from 'lucide-react';
import type { PersonaSlaStats } from '@/api/sla';
import { formatPercent, formatDuration, formatMtbf } from '../libs/slaHelpers';

export function SlaCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub: string; color: string; icon: React.ReactNode;
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

export function PersonaRow({ stats, expanded, onToggle }: {
  stats: PersonaSlaStats; expanded: boolean; onToggle: () => void;
}) {
  const rateColor = stats.success_rate >= 0.99 ? 'text-emerald-400' : stats.success_rate >= 0.95 ? 'text-amber-400' : 'text-red-400';
  const rateBg = stats.success_rate >= 0.99 ? 'bg-emerald-500/10 border-emerald-500/20' : stats.success_rate >= 0.95 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';

  return (
    <div>
      <button onClick={onToggle} className="w-full px-5 py-3 flex items-center gap-4 hover:bg-primary/5 transition-colors text-left">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground/90 truncate block">{stats.persona_name}</span>
          <span className="text-xs text-muted-foreground/60">{stats.total_executions} executions</span>
        </div>
        <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full border ${rateColor} ${rateBg}`}>{formatPercent(stats.success_rate)}</span>
        {stats.consecutive_failures > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">{stats.consecutive_failures} failing</span>}
        {stats.auto_healed_count > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">{stats.auto_healed_count} healed</span>}
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/50" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/50" />}
      </button>

      {expanded && (
        <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat icon={<Activity className="w-3.5 h-3.5" />} label="Successful" value={String(stats.successful)} />
          <MiniStat icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Failed" value={String(stats.failed)} />
          <MiniStat icon={<Clock className="w-3.5 h-3.5" />} label="Avg Latency" value={formatDuration(stats.avg_duration_ms)} />
          <MiniStat icon={<Zap className="w-3.5 h-3.5" />} label="P95 Latency" value={formatDuration(stats.p95_duration_ms)} />
          <MiniStat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Cost" value={`$${stats.total_cost_usd.toFixed(2)}`} />
          <MiniStat icon={<TrendingDown className="w-3.5 h-3.5" />} label="MTBF" value={stats.mtbf_seconds != null ? formatMtbf(stats.mtbf_seconds) : 'N/A'} />
          <MiniStat icon={<Wrench className="w-3.5 h-3.5" />} label="Auto-Healed" value={String(stats.auto_healed_count)} />
          <MiniStat icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Cancelled" value={String(stats.cancelled)} />
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

export function DailyTrendChart({ points }: { points: { date: string; success_rate: number; total: number }[] }) {
  if (points.length === 0) return null;
  const maxTotal = Math.max(...points.map((p) => p.total), 1);
  const barWidth = Math.max(4, Math.min(16, Math.floor(600 / points.length)));

  return (
    <div className="flex items-end gap-px h-24 overflow-x-auto">
      {points.map((p, i) => {
        const h = Math.max(2, (p.total / maxTotal) * 80);
        const color = p.success_rate >= 0.99 ? 'bg-emerald-500/60' : p.success_rate >= 0.95 ? 'bg-amber-500/60' : 'bg-red-500/60';
        return (
          <div key={i} className="flex flex-col items-center justify-end flex-shrink-0" style={{ width: barWidth }} title={`${p.date}: ${formatPercent(p.success_rate)} (${p.total} runs)`}>
            <div className={`w-full rounded-t-sm ${color}`} style={{ height: h }} />
          </div>
        );
      })}
    </div>
  );
}
