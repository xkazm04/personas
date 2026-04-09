import { silentCatch } from "@/lib/silentCatch";
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { Shield, AlertTriangle, Clock, Wrench } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useOverviewTranslation } from '@/features/overview/i18n/useOverviewTranslation';
import { getSlaDashboard } from '@/api/overview/sla';
import type { SlaDashboardData } from '@/api/overview/sla';
import { dashboardContainer, dashboardItem } from '@/features/templates/animationPresets';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { DAY_OPTIONS, formatPercent, formatDuration, slaColor } from '../libs/slaHelpers';
import { SlaCard, PersonaRow, DailyTrendChart } from './SLACard';

export default function SLADashboard() {
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
      .catch(silentCatch("SLADashboard:fetchSlaDashboard"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debouncedDays]);

  const { t } = useOverviewTranslation();
  const { shouldAnimate } = useMotion();
  const togglePersona = (id: string) => setExpandedPersona((prev) => (prev === id ? null : id));

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
              <button key={d} onClick={() => setDays(d)} className={`px-2.5 py-1 text-xs rounded-xl transition-colors ${days === d ? 'bg-primary/15 text-primary border border-primary/30' : 'text-muted-foreground/70 hover:text-foreground/80 hover:bg-primary/5 border border-transparent'}`}>
                {d}d
              </button>
            ))}
          </div>
        }
      />

      <ContentBody centered>
        <AnimatePresence mode="wait">
        {loading && !data ? (
          <motion.div
            key="loading"
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={shouldAnimate ? { opacity: 0 } : undefined}
            className="flex items-center justify-center py-16"
          >
            <LoadingSpinner size="xl" className="text-primary/60" />
          </motion.div>
        ) : !data ? (
          <motion.div
            key="empty"
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={shouldAnimate ? { opacity: 0 } : undefined}
          >
            <EmptyState variant="metrics" heading={t.emptyState.sla_title} description={t.emptyState.sla_subtitle} />
          </motion.div>
        ) : (
          <motion.div
            key={`sla-${days}`}
            className="space-y-6"
            variants={shouldAnimate ? dashboardContainer : undefined}
            initial={shouldAnimate ? "hidden" : false}
            animate="show"
            exit={shouldAnimate ? { opacity: 0, transition: { duration: 0.15 } } : undefined}
          >
            <motion.div variants={shouldAnimate ? dashboardItem : undefined} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SlaCard label="Success Rate" value={formatPercent(data.global.success_rate)} sub={`${data.global.successful}/${data.global.successful + data.global.failed} decided`} color={slaColor(data.global.success_rate)} icon={<Shield className="w-4 h-4" />} />
              <SlaCard label="Avg Latency" value={formatDuration(data.global.avg_duration_ms)} sub={`${data.global.active_persona_count} active agents`} color="blue" icon={<Clock className="w-4 h-4" />} />
              <SlaCard label="Open Issues" value={String(data.healing_summary.open_issues)} sub={`${data.healing_summary.circuit_breaker_count} circuit breakers`} color={data.healing_summary.open_issues > 0 ? 'amber' : 'emerald'} icon={<AlertTriangle className="w-4 h-4" />} />
              <SlaCard label="Auto-Healed" value={String(data.healing_summary.auto_fixed_count)} sub={`${data.healing_summary.knowledge_patterns} known patterns`} color="violet" icon={<Wrench className="w-4 h-4" />} />
            </motion.div>

            {data.daily_trend.length > 0 && (
              <motion.div variants={shouldAnimate ? dashboardItem : undefined} className="rounded-xl border border-primary/10 bg-card-bg p-5 space-y-3">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Daily Success Rate -- {days} Days</h2>
                <DailyTrendChart points={data.daily_trend} />
              </motion.div>
            )}

            <motion.div variants={shouldAnimate ? dashboardItem : undefined} className="rounded-xl border border-primary/10 bg-card-bg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-primary/10">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Per-Agent Reliability</h2>
              </div>
              {data.persona_stats.length === 0 ? (
                <div className="px-5 py-8 text-center typo-body text-foreground">{t.emptyState.sla_no_agents}</div>
              ) : (
                <div className="divide-y divide-primary/5">
                  {data.persona_stats.map((ps) => (
                    <PersonaRow key={ps.persona_id} stats={ps} expanded={expandedPersona === ps.persona_id} onToggle={() => togglePersona(ps.persona_id)} />
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>
      </ContentBody>
    </ContentBox>
  );
}
