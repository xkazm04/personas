import { useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Cpu, Plus } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { AgentSection } from './CronAgentCard';
import { seedMockCronAgent } from '@/api/pipeline/triggers';
import { createLogger } from "@/lib/log";

const logger = createLogger("cron-agents");

export default function CronAgentsPage() {
  const { t, tx } = useTranslation();
  const { cronAgents, loading, fetchCronAgents } = useOverviewStore(useShallow((s) => ({
    cronAgents: s.cronAgents,
    loading: s.cronAgentsLoading,
    fetchCronAgents: s.fetchCronAgents,
  })));

  useEffect(() => { fetchCronAgents(); }, [fetchCronAgents]);

  const handleSeedCron = useCallback(async () => {
    try { await seedMockCronAgent(); await fetchCronAgents(); }
    catch (err) { logger.error('Failed to seed mock cron agent', { error: err }); }
  }, [fetchCronAgents]);

  const headless = cronAgents.filter((a) => a.headless);
  const interactive = cronAgents.filter((a) => !a.headless);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Cpu className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.overview.cron.title}
        subtitle={t.overview.cron.subtitle}
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            {import.meta.env.DEV && (
              <button onClick={handleSeedCron} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl typo-heading bg-amber-500/10 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20 transition-colors" title={t.overview.cron.seed_tooltip}>
                <Plus className="w-3.5 h-3.5" /> {t.overview.cron.mock_schedule}
              </button>
            )}
            <span className="px-2 py-0.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              {tx(t.overview.cron.scheduled_count, { count: cronAgents.length })}
            </span>
            <span className="px-2 py-0.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {tx(t.overview.cron.headless_count, { count: headless.length })}
            </span>
          </div>
        }
      />

      <ContentBody centered>
        {loading && cronAgents.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground/70">
            <LoadingSpinner size="lg" className="mr-2" />
            {t.overview.cron.loading}
          </div>
        ) : cronAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground/70">
            <Cpu className="w-8 h-8 opacity-40" />
            <p className="text-sm">{t.overview.cron.no_agents}</p>
            <p className="text-xs">{t.overview.cron.no_agents_hint}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {headless.length > 0 && (
              <AgentSection title={t.overview.cron.headless_section} agents={headless} />
            )}
            {interactive.length > 0 && (
              <AgentSection
                title={headless.length > 0 ? t.overview.cron.interactive_section : t.overview.cron.scheduled_section}
                agents={interactive}
              />
            )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
