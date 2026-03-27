import { useEffect } from 'react';
import {
  Cpu,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Pause,
  Bot,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { formatRelative } from './libs/cronHelpers';

export default function CronAgentsPage() {
  const { cronAgents, loading, fetchCronAgents } = useOverviewStore(useShallow((s) => ({
    cronAgents: s.cronAgents,
    loading: s.cronAgentsLoading,
    fetchCronAgents: s.fetchCronAgents,
  })));

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
            <LoadingSpinner size="lg" className="mr-2" />
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

function AgentSection({ title, agents }: { title: string; agents: CronAgent[] }) {
  return (
    <div>
      <h2 className="typo-heading text-muted-foreground/80 mb-3">{title}</h2>
      <div className="grid gap-2">
        {agents.map((agent) => (
          <AgentRow key={agent.trigger_id} agent={agent} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ agent }: { agent: CronAgent }) {
  const failureRate = agent.recent_executions > 0
    ? agent.recent_failures / agent.recent_executions
    : 0;

  const healthColor =
    !agent.trigger_enabled || !agent.persona_enabled ? 'text-muted-foreground/50' :
    agent.recent_executions === 0 ? 'text-muted-foreground/50' :
    failureRate === 0 ? 'text-emerald-400' :
    failureRate < 0.6 ? 'text-amber-400' :
    'text-red-400';

  const HealthIcon =
    !agent.trigger_enabled || !agent.persona_enabled ? Pause :
    agent.recent_executions === 0 ? Clock :
    failureRate === 0 ? CheckCircle2 :
    failureRate < 0.6 ? AlertTriangle :
    XCircle;

  const schedule = agent.cron_expression
    ? agent.cron_expression
    : agent.interval_seconds
      ? `every ${formatInterval(agent.interval_seconds)}`
      : 'no schedule';

  const disabled = !agent.trigger_enabled || !agent.persona_enabled;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
      disabled
        ? 'border-primary/5 bg-primary/[0.02] opacity-60'
        : 'border-primary/10 bg-primary/[0.03] hover:bg-primary/[0.05]'
    }`}>
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
        style={{
          backgroundColor: agent.persona_color ? `${agent.persona_color}20` : 'var(--color-primary-5)',
          color: agent.persona_color || 'var(--color-muted-foreground)',
        }}
      >
        {agent.persona_icon || <Bot className="w-4 h-4" />}
      </div>

      {/* Name + schedule */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="typo-heading text-foreground/90 truncate">{agent.persona_name}</span>
          {agent.headless && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
              headless
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/70 mt-0.5">
          <Clock className="w-3 h-3 shrink-0" />
          <span className="font-mono">{schedule}</span>
          {agent.description && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="truncate">{agent.description}</span>
            </>
          )}
        </div>
      </div>

      {/* Next run */}
      <div className="text-right shrink-0">
        {agent.next_trigger_at ? (
          <div className="text-xs text-muted-foreground/70">
            <span className="text-muted-foreground/50">next </span>
            {formatRelative(agent.next_trigger_at)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground/60">--</div>
        )}
        {agent.last_triggered_at && (
          <div className="text-[10px] text-muted-foreground/50 mt-0.5">
            last {formatRelative(agent.last_triggered_at)}
          </div>
        )}
      </div>

      {/* Health */}
      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        <HealthIcon className={`w-4 h-4 ${healthColor}`} />
        {agent.recent_executions > 0 && (
          <span className={`text-xs font-mono ${healthColor}`}>
            {agent.recent_executions - agent.recent_failures}/{agent.recent_executions}
          </span>
        )}
      </div>
    </div>
  );
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

