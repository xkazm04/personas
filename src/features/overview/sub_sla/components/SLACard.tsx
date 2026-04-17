import { useTranslation } from '@/i18n/useTranslation';
import { Activity, AlertTriangle, Clock, ChevronDown, ChevronUp, Zap, TrendingUp, TrendingDown, Wrench } from 'lucide-react';
import type { PersonaSlaStats } from '@/api/overview/sla';
import { formatPercent, formatDuration, formatMtbf } from '../libs/slaHelpers';
import { rateToHealth, healthClasses, HEALTH_STATUS_TOKEN } from '@/lib/design/statusTokens';

export function SlaCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub: string; color: string; icon: React.ReactNode;
}) {
  const colorMap: Record<string, string> = {
    emerald: healthClasses('healthy'),
    amber: healthClasses('warning'),
    red: healthClasses('critical'),
    blue: healthClasses('info'),
    violet: `text-violet-400 bg-violet-500/10 border-violet-500/20`,
  };
  const cls = colorMap[color] || colorMap['emerald'];

  return (
    <div className={`rounded-modal border p-4 ${cls}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="typo-label font-mono opacity-80">{label}</span>
      </div>
      <div className="typo-data-lg">{value}</div>
      <div className="text-xs opacity-60 mt-1">{sub}</div>
    </div>
  );
}

export function PersonaRow({ stats, expanded, onToggle }: {
  stats: PersonaSlaStats; expanded: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation();
  const rateHealth = HEALTH_STATUS_TOKEN[rateToHealth(stats.success_rate)];
  const rateColor = rateHealth.text;
  const rateBg = `${rateHealth.bg} ${rateHealth.border}`;

  return (
    <div>
      <button onClick={onToggle} className="w-full px-5 py-3 flex items-center gap-4 hover:bg-primary/5 transition-colors text-left">
        <div className="flex-1 min-w-0">
          <span className="typo-heading text-foreground/90 truncate block">{stats.persona_name}</span>
          <span className="text-xs text-foreground">{stats.total_executions} executions</span>
        </div>
        <span className={`typo-heading px-2.5 py-0.5 rounded-full border ${rateColor} ${rateBg}`}>{formatPercent(stats.success_rate)}</span>
        {stats.consecutive_failures > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">{stats.consecutive_failures} failing</span>}
        {stats.auto_healed_count > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25">{stats.auto_healed_count} healed</span>}
        {expanded ? <ChevronUp className="w-4 h-4 text-foreground" /> : <ChevronDown className="w-4 h-4 text-foreground" />}
      </button>

      {expanded && (
        <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat icon={<Activity className="w-3.5 h-3.5" />} label={t.overview.sla_card.successful} value={String(stats.successful)} />
          <MiniStat icon={<AlertTriangle className="w-3.5 h-3.5" />} label={t.overview.sla_card.failed} value={String(stats.failed)} />
          <MiniStat icon={<Clock className="w-3.5 h-3.5" />} label={t.overview.sla_card.avg_latency} value={formatDuration(stats.avg_duration_ms)} />
          <MiniStat icon={<Zap className="w-3.5 h-3.5" />} label={t.overview.sla_card.p95_latency} value={formatDuration(stats.p95_duration_ms)} />
          <MiniStat icon={<TrendingUp className="w-3.5 h-3.5" />} label={t.overview.sla_card.cost} value={`$${stats.total_cost_usd.toFixed(2)}`} />
          <MiniStat icon={<TrendingDown className="w-3.5 h-3.5" />} label={t.overview.sla_card.mtbf} value={stats.mtbf_seconds != null ? formatMtbf(stats.mtbf_seconds) : 'N/A'} />
          <MiniStat icon={<Wrench className="w-3.5 h-3.5" />} label={t.overview.sla_card.auto_healed} value={String(stats.auto_healed_count)} />
          <MiniStat icon={<AlertTriangle className="w-3.5 h-3.5" />} label={t.overview.sla_card.cancelled} value={String(stats.cancelled)} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/10 px-3 py-2">
      <div className="flex items-center gap-1.5 text-foreground mb-0.5">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="typo-heading text-foreground/90">{value}</div>
    </div>
  );
}

export function DailyTrendChart({ points }: { points: { date: string; success_rate: number; total: number }[] }) {
  if (points.length === 0) return null;
  const barWidth = Math.max(4, Math.min(16, Math.floor(600 / points.length)));

  return (
    <div className="flex items-end gap-px h-24 overflow-x-auto overflow-y-hidden">
      {points.map((p, i) => {
        const color = `${HEALTH_STATUS_TOKEN[rateToHealth(p.success_rate)].icon}/60`;
        return (
          <div key={i} className="flex flex-col items-center justify-end flex-shrink-0" style={{ width: barWidth }} title={`${p.date}: ${formatPercent(p.success_rate)} (${p.total} runs)`}>
            <div
              className={`animate-fade-in w-full rounded-t-sm ${color}`}
            />
          </div>
        );
      })}
    </div>
  );
}
