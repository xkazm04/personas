import { useEffect } from 'react';
import { Cpu, Loader2 } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { usePersonaStore } from '@/stores/personaStore';
import { AgentSection } from './CronAgentCard';

export default function CronAgentsPage() {
  const cronAgents = usePersonaStore((s) => s.cronAgents);
  const loading = usePersonaStore((s) => s.cronAgentsLoading);
  const fetchCronAgents = usePersonaStore((s) => s.fetchCronAgents);

  useEffect(() => { fetchCronAgents(); }, [fetchCronAgents]);

  const headless = cronAgents.filter((a) => a.headless);
  const interactive = cronAgents.filter((a) => !a.headless);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Cpu className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Cron Agents"
        subtitle="Background agents running on scheduled intervals"
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <span className="px-2 py-0.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              {cronAgents.length} scheduled
            </span>
            <span className="px-2 py-0.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {headless.length} headless
            </span>
          </div>
        }
      />

      <ContentBody centered>
        {loading && cronAgents.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground/70">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading cron agents...
          </div>
        ) : cronAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground/70">
            <Cpu className="w-8 h-8 opacity-40" />
            <p className="text-sm">No scheduled agents found.</p>
            <p className="text-xs">Create a schedule trigger on any agent to see it here.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {headless.length > 0 && (
              <AgentSection title="Headless Background Agents" agents={headless} />
            )}
            {interactive.length > 0 && (
              <AgentSection
                title={headless.length > 0 ? 'Interactive Scheduled Agents' : 'Scheduled Agents'}
                agents={interactive}
              />
            )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
