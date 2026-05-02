import { useState, useEffect, useCallback } from 'react';
import { Play, RefreshCw, ExternalLink, FileText } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from "@/stores/systemStore";
import { Button } from '@/features/shared/components/buttons';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { usePolling, POLLING_CONFIG } from '@/hooks/utility/timing/usePolling';
import { StatusIcon, statusColor } from './pipelineHelpers';
import { PipelineRow } from './PipelineRow';
import { JobRow } from './JobRow';
import { usePipelineNotifications } from '../hooks/usePipelineNotifications';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface GitLabPipelineViewerProps {
  projectId: number | null;
}

export function GitLabPipelineViewer({ projectId }: GitLabPipelineViewerProps) {
  const { t } = useTranslation();
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null);

  const pipelines = useSystemStore((s) => s.gitlabPipelines);
  const activePipeline = useSystemStore((s) => s.gitlabActivePipeline);
  const jobs = useSystemStore((s) => s.gitlabPipelineJobs);
  const loading = useSystemStore((s) => s.gitlabPipelineLoading);
  const triggering = useSystemStore((s) => s.gitlabTriggeringPipeline);

  const fetchPipelines = useSystemStore((s) => s.gitlabFetchPipelines);
  const triggerPipeline = useSystemStore((s) => s.gitlabTriggerPipelineAction);
  const selectPipeline = useSystemStore((s) => s.gitlabSelectPipeline);
  const refreshPipeline = useSystemStore((s) => s.gitlabRefreshPipeline);
  const clearPipelineState = useSystemStore((s) => s.gitlabClearPipelineState);

  // Desktop notifications + in-app notification center on pipeline status transitions
  usePipelineNotifications(pipelines, projectId);

  useEffect(() => {
    if (projectId) {
      fetchPipelines(projectId);
    }
    return () => clearPipelineState();
  }, [projectId, fetchPipelines, clearPipelineState]);

  // Auto-refresh running pipelines (visibility-aware: pauses when tab hidden)
  const activePipelineId = activePipeline?.id ?? null;
  const activePipelineStatus = activePipeline?.status ?? null;
  const isRunning = activePipelineStatus === 'running' || activePipelineStatus === 'pending';

  const refreshActivePipeline = useCallback(() => {
    if (projectId && activePipelineId) {
      return refreshPipeline(projectId, activePipelineId);
    }
  }, [projectId, activePipelineId, refreshPipeline]);

  usePolling(refreshActivePipeline, {
    ...POLLING_CONFIG.pipelineRefresh,
    enabled: !!projectId && !!activePipelineId && isRunning,
  });

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="typo-body text-foreground">{t.gitlab.select_project_for_pipelines}</p>
      </div>
    );
  }

  const handleTrigger = async () => {
    await triggerPipeline(projectId);
  };

  const handleSelectPipeline = (pipelineId: number) => {
    setExpandedJobId(null);
    selectPipeline(projectId, pipelineId);
  };

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <p className="typo-body text-foreground">
          {pipelines.length > 0 ? `${pipelines.length} pipeline(s)` : t.gitlab.no_pipelines}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={() => fetchPipelines(projectId)}
            disabled={loading}
          >
            {t.common.refresh}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={triggering ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
            loading={triggering}
            onClick={handleTrigger}
            disabled={triggering}
            accentColor="orange"
          >
            {t.gitlab.trigger_pipeline}
          </Button>
        </div>
      </div>

      {/* Pipeline list + detail split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: pipeline list */}
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1 scrollbar-thin">
          {loading && pipelines.length === 0 ? (
            null
          ) : pipelines.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-modal bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                <FileText className="w-6 h-6 text-orange-400/60" />
              </div>
              <p className="typo-body text-foreground">{t.gitlab.no_pipelines_yet}</p>
              <p className="typo-caption text-foreground mt-1">{t.gitlab.trigger_to_start}</p>
            </div>
          ) : (
            pipelines.map((p) => (
              <PipelineRow
                key={p.id}
                pipeline={p}
                isActive={activePipeline?.id === p.id}
                onSelect={() => handleSelectPipeline(p.id)}
              />
            ))
          )}
        </div>

        {/* Right: job detail */}
        <div>
          {activePipeline ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusIcon status={activePipeline.status} />
                  <span className="typo-body font-medium text-foreground/90">
                    {t.gitlab.pipeline_hash}{activePipeline.id}
                  </span>
                  <span className={`typo-caption capitalize ${statusColor(activePipeline.status)}`}>
                    {activePipeline.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {sanitizeExternalUrl(activePipeline.webUrl) && (
                    <a
                      href={sanitizeExternalUrl(activePipeline.webUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-card hover:bg-secondary/50 text-foreground hover:text-foreground/70 transition-colors"
                      title={t.gitlab.open_in_gitlab}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => refreshPipeline(projectId, activePipeline.id)}
                    title={t.gitlab.refresh_pipeline}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Jobs list */}
              <div className="space-y-2">
                {jobs.length === 0 && loading ? (
                  null
                ) : jobs.length === 0 ? (
                  <p className="typo-body text-foreground text-center py-4">{t.gitlab.no_jobs_found}</p>
                ) : (
                  jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      projectId={projectId}
                      isExpanded={expandedJobId === job.id}
                      onToggle={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                    />
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[200px] typo-body text-foreground">
              {t.gitlab.select_pipeline_to_view}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
