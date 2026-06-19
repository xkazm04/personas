import { useState } from 'react';
import { Network } from 'lucide-react';
import { useStructuredStream } from '@/hooks/execution/useStructuredStream';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';

interface Agent {
  type: string;
  desc: string;
  parent: string;
  status: string;
  tokens?: number;
  ms?: number;
}

/**
 * Live fan-out view for an execution's Task/Workflow subagents (P4 observability).
 * Accumulates `subagent_started`/`subagent_update` events off the structured
 * stream and lists each subagent with its status + token usage. Renders nothing
 * until a subagent appears (the common case — most executions don't fan out).
 * Live-only: subagent events aren't persisted yet, so a completed execution
 * viewed post-hoc shows nothing.
 */
export function SubagentTree({ executionId }: { executionId: string }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const [agents, setAgents] = useState<Map<string, Agent>>(new Map());

  useStructuredStream(executionId, {
    onSubagentStarted: (ev) =>
      setAgents((m) => {
        const n = new Map(m);
        n.set(ev.task_id, {
          type: ev.subagent_type,
          desc: ev.description,
          parent: ev.tool_use_id,
          status: 'running',
        });
        return n;
      }),
    onSubagentUpdate: (ev) =>
      setAgents((m) => {
        const a = m.get(ev.task_id);
        if (!a) return m;
        const n = new Map(m);
        n.set(ev.task_id, { ...a, status: ev.status, tokens: ev.total_tokens, ms: ev.duration_ms });
        return n;
      }),
  });

  if (agents.size === 0) return null;
  const list = Array.from(agents.values());

  return (
    <div className="rounded-modal border border-primary/20 bg-secondary/40 p-4 space-y-2">
      <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
        <Network className="w-3 h-3" />
        {e.subagents} ({list.length})
      </div>
      <div className="space-y-1.5">
        {list.map((a, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-input bg-secondary/40 px-2.5 py-1.5"
          >
            <span className="typo-body text-foreground truncate">
              {a.desc || a.type}
            </span>
            <span className="typo-code text-foreground/90 shrink-0 font-mono">
              {a.status}
              {a.tokens != null ? <> · <Numeric value={a.tokens} /></> : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
