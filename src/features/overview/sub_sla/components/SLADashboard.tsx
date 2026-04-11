import { toastCatch } from "@/lib/silentCatch";
import { useTranslation } from '@/i18n/useTranslation';
import { useState, useEffect } from 'react';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { Shield, AlertTriangle, Clock, Wrench } from 'lucide-react';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { getSlaDashboard } from '@/api/overview/sla';
import type { SlaDashboardData } from '@/api/overview/sla';
import { DAY_OPTIONS, formatPercent, formatDuration, slaColor } from '../libs/slaHelpers';
import { SlaCard, PersonaRow, DailyTrendChart } from './SLACard';

export default function SLADashboard() {
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

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title={t.overview.sla.title}
        subtitle={t.overview.sla.subtitle}
        actions={
          <div className="flex items-center gap-1.5">
            {DAY_OPTIONS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`px-2.5 py-1 text-xs rounded-xl transition-colors ${days === d ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground/70 hover:text-foreground/80 hover:bg-primary/5 border border-transparent'}`}>
                {d}d
              </button>
            ))}
          </div>
        }
      />

      <ContentBody centered>
        {loading && !data ? (
          null
        ) : !data ? (
          <InlineErrorBanner severity="info" message={t.overview.sla.no_data} />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SlaCard label={t.overview.sla.success_rate} value={formatPercent(data.global.success_rate)} sub={`${data.global.successful}/${data.global.successful + data.global.failed} decided`} color={slaColor(data.global.success_rate)} icon={<Shield className="w-4 h-4" />} />
              <SlaCard label={t.overview.sla.avg_latency} value={formatDuration(data.global.avg_duration_ms)} sub={`${data.global.active_persona_count} active agents`} color="blue" icon={<Clock className="w-4 h-4" />} />
              <SlaCard label={t.overview.sla.open_issues} value={String(data.healing_summary.open_issues)} sub={`${data.healing_summary.circuit_breaker_count} circuit breakers`} color={data.healing_summary.open_issues > 0 ? 'amber' : 'emerald'} icon={<AlertTriangle className="w-4 h-4" />} />
              <SlaCard label={t.overview.sla.auto_healed} value={String(data.healing_summary.auto_fixed_count)} sub={`${data.healing_summary.knowledge_patterns} known patterns`} color="violet" icon={<Wrench className="w-4 h-4" />} />
            </div>

            {data.daily_trend.length > 0 && (
              <div className="rounded-xl border border-primary/10 bg-card-bg p-5 space-y-3">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">{tx(t.overview.sla.daily_success_rate, { days })}</h2>
                <DailyTrendChart points={data.daily_trend} />
              </div>
            )}

            <div className="rounded-xl border border-primary/10 bg-card-bg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-primary/10">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">{t.overview.sla.per_agent}</h2>
              </div>
              {data.persona_stats.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground/60">{t.overview.sla.no_agent_data}</div>
              ) : (
                <div className="divide-y divide-primary/5">
                  {data.persona_stats.map((ps) => (
                    <PersonaRow key={ps.persona_id} stats={ps} expanded={expandedPersona === ps.persona_id} onToggle={() => togglePersona(ps.persona_id)} />
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
