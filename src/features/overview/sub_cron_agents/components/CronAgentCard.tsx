import {
  Clock, AlertTriangle, CheckCircle2, XCircle, Pause,
} from 'lucide-react';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { formatInterval, formatRelative } from '../libs/cronHelpers';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';

function AgentSection({ title, agents }: { title: string; agents: CronAgent[] }) {
  return (
    <div>
      <h2 className="typo-heading text-foreground mb-3">{title}</h2>
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
    !agent.trigger_enabled || !agent.persona_enabled ? 'text-foreground' :
    agent.recent_executions === 0 ? 'text-foreground' :
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
    <div className={`flex items-center gap-3 px-4 py-3 rounded-modal border transition-colors ${
      disabled
        ? 'border-primary/5 bg-primary/[0.02] opacity-60'
        : 'border-primary/10 bg-primary/[0.03] hover:bg-primary/[0.05]'
    }`}>
      <PersonaIcon icon={agent.persona_icon} color={agent.persona_color} display="pop"
        frameStyle={{
          backgroundColor: agent.persona_color ? `${agent.persona_color}20` : 'var(--color-primary-5)',
          color: agent.persona_color || 'var(--color-muted-foreground)',
        }} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="typo-heading text-foreground/90 truncate">{agent.persona_name}</span>
          {agent.headless && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
              headless
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground mt-0.5">
          <Clock className="w-3 h-3 shrink-0" />
          <span className="font-mono">{schedule}</span>
          {agent.cron_expression && (
            <span className="text-amber-400/50 text-[10px] font-medium">UTC</span>
          )}
          {agent.description && (
            <>
              <span className="text-foreground">·</span>
              <span className="truncate">{agent.description}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right shrink-0">
        {agent.next_trigger_at ? (
          <div className="text-xs text-foreground">
            <span className="text-foreground">next </span>
            {formatRelative(agent.next_trigger_at)}
          </div>
        ) : (
          <div className="text-xs text-foreground">--</div>
        )}
        {agent.last_triggered_at && (
          <div className="text-[10px] text-foreground mt-0.5">
            last {formatRelative(agent.last_triggered_at)}
          </div>
        )}
      </div>

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

export { AgentSection, AgentRow };
