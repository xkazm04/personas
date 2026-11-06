import { useEffect } from 'react';
import { Bot, Trash2, ExternalLink, RefreshCw, RotateCw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { GitLabAgent } from '@/api/system/gitlab';
import { useSystemStore } from "@/stores/systemStore";
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { pipelineForAgent } from './pipelineHelpers';
import Button from '@/features/shared/components/buttons/Button';
import { StateMark } from '@/features/shared/components/display/StateMark';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface GitLabAgentListProps {
  projectId: number | null;
  agents: GitLabAgent[];
  onFetchAgents: (projectId: number) => Promise<unknown>;
  onUndeploy: (projectId: number, agentId: string) => Promise<void>;
  onRedeploy: (agentName: string) => Promise<unknown>;
  redeployingAgentId: string | null;
}

export function GitLabAgentList({
  projectId,
  agents,
  onFetchAgents,
  onUndeploy,
  onRedeploy,
  redeployingAgentId,
}: GitLabAgentListProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (projectId) {
      onFetchAgents(projectId);
    }
  }, [projectId, onFetchAgents]);

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="typo-body text-ink-1">{t.gitlab.select_project_to_view_agents}</p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        size="sm"
        title={t.gitlab.no_duo_agents}
        description={t.gitlab.deploy_persona_hint}
        action={{ label: t.common.refresh, icon: RefreshCw, onClick: () => onFetchAgents(projectId) }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="typo-body text-ink-1">{t.gitlab.agents_deployed.replace('{count}', String(agents.length))}</p>
        <Button
          type="button"
          onClick={() => onFetchAgents(projectId)}
          variant="ghost"
          size="sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.common.refresh}
        </Button>
      </div>

      {agents.map((agent) => (
        <div
          key={agent.id}
          className="p-3 rounded-modal border border-hair bg-surface-1 flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-card bg-status-warning/10 border border-status-warning/20 flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-status-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="typo-body text-ink-2 truncate">{agent.name}</p>
            {agent.description && (
              <p className="typo-body text-ink-1 truncate">{agent.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <PipelineStatusBadge projectId={projectId} agentName={agent.name} />
            <Button
              type="button"
              onClick={() => onRedeploy(agent.name)}
              disabled={redeployingAgentId === agent.name}
              tooltip={t.gitlab.redeploy_agent}
              variant="ghost"
              size="icon-sm"
            >
              {redeployingAgentId === agent.name ? (
                <LoadingSpinner size="xs" />
              ) : (
                <RotateCw className="w-4 h-4" />
              )}
            </Button>
            {sanitizeExternalUrl(agent.webUrl) && (
              <Tooltip content={t.gitlab.open_in_gitlab}>
                <a
                  href={sanitizeExternalUrl(agent.webUrl)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-card hover:bg-surface-2 text-ink-1 hover:text-ink-2 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Tooltip>
            )}
            <Button
              type="button"
              onClick={() => onUndeploy(projectId, agent.id)}
              tooltip={t.gitlab.undeploy_agent}
              variant="ghost"
              size="icon-sm"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline status badge (reads latest pipeline from store)
// ---------------------------------------------------------------------------

function PipelineStatusBadge({ projectId, agentName }: { projectId: number; agentName: string }) {
  const { t, tx } = useTranslation();
  const pipelines = useSystemStore((s) => s.gitlabPipelines);
  const fetchPipelines = useSystemStore((s) => s.gitlabFetchPipelines);

  useEffect(() => {
    if (pipelines.length === 0) {
      fetchPipelines(projectId);
    }
  }, [projectId, pipelines.length, fetchPipelines]);

  // THIS agent's pipeline, or nothing. `pipelines[0]` is the project's latest
  // and was being painted on every row, so a sibling's failed build sat next to
  // this agent's Undeploy button (see pipelineForAgent).
  const latest = pipelineForAgent(pipelines, agentName);
  if (!latest) return null;

  const STATE: Record<string, 'success' | 'error' | 'running' | 'queued'> = {
    success: 'success',
    failed: 'error',
    running: 'running',
    pending: 'queued',
  };

  return (
    <Tooltip content={tx(t.gitlab.agent_pipeline_title, { agent: agentName, ref: latest.ref, status: latest.status })}>
      <span data-testid={`agent-pipeline-${agentName}`} className="inline-flex">
        <StateMark state={STATE[latest.status] ?? 'neutral'} label={latest.status} />
      </span>
    </Tooltip>
  );
}
