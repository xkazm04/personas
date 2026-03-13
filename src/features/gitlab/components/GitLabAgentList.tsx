import { useEffect } from 'react';
import { Bot, Trash2, ExternalLink, RefreshCw, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import type { GitLabAgent } from '@/api/system/gitlab';
import { useSystemStore } from "@/stores/systemStore";

interface GitLabAgentListProps {
  projectId: number | null;
  agents: GitLabAgent[];
  onFetchAgents: (projectId: number) => Promise<void>;
  onUndeploy: (projectId: number, agentId: string) => Promise<void>;
}

export function GitLabAgentList({
  projectId,
  agents,
  onFetchAgents,
  onUndeploy,
}: GitLabAgentListProps) {
  useEffect(() => {
    if (projectId) {
      onFetchAgents(projectId);
    }
  }, [projectId, onFetchAgents]);

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground/70">Select a project in the Deploy tab to view agents.</p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
          <Bot className="w-6 h-6 text-orange-400/60" />
        </div>
        <p className="text-sm text-muted-foreground/80">No Duo Agents deployed</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Deploy a persona from the Deploy tab</p>
        <button
          onClick={() => onFetchAgents(projectId)}
          className="mt-3 flex items-center gap-1.5 mx-auto px-3 py-1.5 text-sm rounded-xl border border-primary/15 text-muted-foreground/70 hover:text-foreground/80 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground/70">{agents.length} agent(s) deployed</p>
        <button
          onClick={() => onFetchAgents(projectId)}
          className="flex items-center gap-1.5 px-2 py-1 text-sm rounded-lg text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {agents.map((agent) => (
        <div
          key={agent.id}
          className="p-3 rounded-xl border border-primary/10 bg-secondary/20 flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground/90 truncate">{agent.name}</p>
            {agent.description && (
              <p className="text-sm text-muted-foreground/60 truncate">{agent.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <PipelineStatusBadge projectId={projectId} />
            {agent.webUrl && (
              <a
                href={agent.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                title="Open in GitLab"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
            <button
              onClick={() => onUndeploy(projectId, agent.id)}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors"
              title="Undeploy agent"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline status badge (reads latest pipeline from store)
// ---------------------------------------------------------------------------

function PipelineStatusBadge({ projectId }: { projectId: number }) {
  const pipelines = useSystemStore((s) => s.gitlabPipelines);
  const fetchPipelines = useSystemStore((s) => s.gitlabFetchPipelines);

  useEffect(() => {
    if (pipelines.length === 0) {
      fetchPipelines(projectId);
    }
  }, [projectId, pipelines.length, fetchPipelines]);

  const latest = pipelines[0];
  if (!latest) return null;

  const cfg: Record<string, { icon: React.ReactNode; bg: string; text: string }> = {
    success: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      bg: 'bg-emerald-500/10 border-emerald-500/20',
      text: 'text-emerald-400',
    },
    failed: {
      icon: <XCircle className="w-3 h-3" />,
      bg: 'bg-red-500/10 border-red-500/20',
      text: 'text-red-400',
    },
    running: {
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
      bg: 'bg-amber-500/10 border-amber-500/20',
      text: 'text-amber-400',
    },
    pending: {
      icon: <Clock className="w-3 h-3" />,
      bg: 'bg-amber-500/10 border-amber-500/20',
      text: 'text-amber-400',
    },
  };

  const c = cfg[latest.status] ?? {
    icon: <Clock className="w-3 h-3" />,
    bg: 'bg-secondary/30 border-primary/10',
    text: 'text-muted-foreground/60',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-xs font-medium capitalize ${c.bg} ${c.text}`}
      title={`Latest pipeline: ${latest.status}`}
    >
      {c.icon}
      {latest.status}
    </span>
  );
}
