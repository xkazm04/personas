import { useEffect } from 'react';
import { Bot, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import type { GitLabAgent } from '@/api/gitlab';

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
          className="mt-3 flex items-center gap-1.5 mx-auto px-3 py-1.5 text-sm rounded-lg border border-primary/15 text-muted-foreground/70 hover:text-foreground/80 transition-colors"
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
          className="flex items-center gap-1.5 px-2 py-1 text-sm rounded-md text-muted-foreground/60 hover:text-foreground/80 transition-colors"
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
            {agent.webUrl && (
              <button
                onClick={() => window.open(agent.webUrl!, '_blank')}
                className="p-1.5 rounded-md hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
                title="Open in GitLab"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => onUndeploy(projectId, agent.id)}
              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors"
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
