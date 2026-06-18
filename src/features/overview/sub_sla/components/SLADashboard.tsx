import { toastCatch } from "@/lib/silentCatch";
import { useTranslation } from '@/i18n/useTranslation';
import { useState, useEffect } from 'react';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { Shield, AlertTriangle, Clock, Wrench, TrendingUp, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { getSlaDashboard } from '@/api/overview/sla';
import type { SlaDashboardData } from '@/api/overview/sla';
import { DAY_OPTIONS, formatPercent, formatDuration, slaColor } from '../libs/slaHelpers';
import { rateToHealth, HEALTH_STATUS_TOKEN } from '@/lib/design/statusTokens';
import { SlaCard, PersonaRow, DailyTrendChart } from './SLACard';

interface SLADashboardProps {
  /** When true, render without ContentBox/ContentHeader so the dashboard can
   * be embedded inside another page (e.g. the Reliability tab inside
   * PersonaHealthDashboard). Day-range picker moves inline next to the
   * stat cards. */
  embedded?: boolean;
}

export default function SLADashboard({ embedded = false }: SLADashboardProps) {
  const { t, tx } = useTranslation();
  const [data, setData] = useState<SlaDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number>(30);
  const debouncedDays = useDebounce(days, 300);
  const [expandedPersona, setExpandedPersona] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSlaDashboard(debouncedDays)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(toastCatch("SLADashboard:fetchSlaDashboard", "Failed to load SLA metrics"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedDays]);

  const togglePersona = (id: string) => setExpandedPersona((prev) => (prev === id ? null : id));

  const dayPicker = (
    <div className="flex items-center gap-1.5">
      {DAY_OPTIONS.map((d) => (
        <button key={d} onClick={() => setDays(d)} className={`px-2.5 py-1 typo-caption rounded-modal transition-colors ${days === d ? 'bg-primary/15 text-primary border border-primary/30' : 'text-foreground hover:text-foreground/80 hover:bg-primary/5 border border-transparent'}`}>
          {d}d
        </button>
      ))}
    </div>
  );

  const body = (loading && !data) ? null
    : !data ? <InlineErrorBanner severity="info" message={t.overview.sla.no_data} />
    : (
      <div className="space-y-6">
        {embedded ? (
          // Compact row: day filter + 2 primary metrics (success rate, avg latency)
          <div className="flex items-center gap-3 flex-wrap rounded-modal border border-primary/10 bg-secondary/5 shadow-elevation-1 p-3">
            {dayPicker}
            <div className="h-8 w-px bg-primary/10 mx-1" />
            <CompactMetric
              icon={<Shield className="w-3.5 h-3.5" />}
              label={t.overview.sla.success_rate}
              value={formatPercent(data.global.success_rate)}
              sub={tx(t.overview.sla.executions_summary, { successful: Number(data.global.successful), total: Number(data.global.successful) + Number(data.global.failed) })}
              color={slaColor(data.global.success_rate)}
            />
            <CompactMetric
              icon={<Clock className="w-3.5 h-3.5" />}
              label={t.overview.sla.avg_latency}
              value={formatDuration(data.global.avg_duration_ms)}
              sub={tx(t.overview.sla.active_agents, { count: Number(data.global.active_persona_count) })}
              color="blue"
            />
            <div className="ml-auto flex items-center gap-3">
              <CompactMetric
                icon={<AlertTriangle className="w-3.5 h-3.5" />}
                label={t.overview.sla.open_issues}
                value={String(data.healing_summary.open_issues)}
                sub={tx(t.overview.sla.circuit_breakers, { count: Number(data.healing_summary.circuit_breaker_count) })}
                color={Number(data.healing_summary.open_issues) > 0 ? 'amber' : 'emerald'}
              />
              <CompactMetric
                icon={<Wrench className="w-3.5 h-3.5" />}
                label={t.overview.sla.auto_healed}
                value={String(data.healing_summary.auto_fixed_count)}
                sub={tx(t.overview.sla.known_patterns, { count: Number(data.healing_summary.knowledge_patterns) })}
                color="violet"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SlaCard label={t.overview.sla.success_rate} value={formatPercent(data.global.success_rate)} sub={tx(t.overview.sla.executions_summary, { successful: Number(data.global.successful), total: Number(data.global.successful) + Number(data.global.failed) })} color={slaColor(data.global.success_rate)} icon={<Shield className="w-4 h-4" />} tooltip={t.overview.sla.success_rate_tooltip} />
            <SlaCard label={t.overview.sla.avg_latency} value={formatDuration(data.global.avg_duration_ms)} sub={tx(t.overview.sla.active_agents, { count: Number(data.global.active_persona_count) })} color="blue" icon={<Clock className="w-4 h-4" />} tooltip={tx(t.overview.sla.windowed_tooltip, { days })} />
            <SlaCard label={t.overview.sla.open_issues} value={String(data.healing_summary.open_issues)} sub={tx(t.overview.sla.circuit_breakers, { count: Number(data.healing_summary.circuit_breaker_count) })} color={Number(data.healing_summary.open_issues) > 0 ? 'amber' : 'emerald'} icon={<AlertTriangle className="w-4 h-4" />} scope={t.overview.sla.all_time_badge} tooltip={t.overview.sla.open_issues_tooltip} />
            <SlaCard label={t.overview.sla.auto_healed} value={String(data.healing_summary.auto_fixed_count)} sub={tx(t.overview.sla.known_patterns, { count: Number(data.healing_summary.knowledge_patterns) })} color="violet" icon={<Wrench className="w-4 h-4" />} scope={t.overview.sla.all_time_badge} tooltip={t.overview.sla.auto_healed_tooltip} />
          </div>
        )}

        {data.daily_trend.length > 0 && (
          <div className="rounded-modal border border-primary/10 bg-secondary/5 shadow-elevation-1 overflow-hidden">
            <SectionHeader icon={TrendingUp} title={tx(t.overview.sla.daily_success_rate, { days })} accent="text-status-info" />
            <div className="p-5">
              <DailyTrendChart points={data.daily_trend.map((p) => ({ date: p.date, success_rate: p.success_rate, total: Number(p.total) }))} />
            </div>
          </div>
        )}

        <div className="rounded-modal border border-primary/10 bg-secondary/5 shadow-elevation-2 overflow-hidden">
          <div className={`h-0.5 ${HEALTH_STATUS_TOKEN[rateToHealth(data.global.success_rate)].icon} opacity-60`} />
          <SectionHeader icon={Users} title={t.overview.sla.per_agent} accent="text-primary" />
          {data.persona_stats.length === 0 ? (
            <div className="px-5 py-8 text-center typo-body text-foreground">{t.overview.sla.no_agent_data}</div>
          ) : (
            <div className="divide-y divide-primary/5">
              {data.persona_stats.map((ps) => (
                <PersonaRow key={ps.persona_id} stats={ps} expanded={expandedPersona === ps.persona_id} onToggle={() => togglePersona(ps.persona_id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    );

  if (embedded) {
    return body;
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title={t.overview.sla.title}
        subtitle={t.overview.sla.subtitle}
        actions={dayPicker}
      />

      <ContentBody centered>
        {body}
      </ContentBody>
    </ContentBox>
  );
}

function SectionHeader({ icon: Icon, title, accent }: { icon: LucideIcon; title: string; accent: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-3 border-b border-primary/10">
      <div className="w-8 h-8 rounded-card border border-primary/10 bg-secondary/30 flex items-center justify-center shrink-0">
        <Icon className={`w-4 h-4 ${accent}`} />
      </div>
      <h2 className="typo-heading text-foreground/90">{title}</h2>
    </div>
  );
}

function CompactMetric({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub: string; color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-rose-400',
    blue: 'text-blue-400',
    violet: 'text-violet-400',
  };
  const tone = colorMap[color] ?? 'text-foreground';
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={`flex items-center justify-center w-7 h-7 rounded-card bg-secondary/30 border border-primary/10 ${tone}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`typo-heading tabular-nums ${tone}`}>{value}</span>
          <span className="typo-caption uppercase tracking-wider text-foreground font-mono">{label}</span>
        </div>
        <div className="typo-caption text-foreground truncate">{sub}</div>
      </div>
    </div>
  );
}
