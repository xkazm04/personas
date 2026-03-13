import { useState, useEffect } from 'react';
import { Play, RefreshCw, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { Button } from '@/features/shared/components/buttons';
import { StatusIcon, statusColor } from './pipelineHelpers';
import { PipelineRow } from './PipelineRow';
import { JobRow } from './JobRow';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface GitLabPipelineViewerProps {
  projectId: number | null;
}

export function GitLabPipelineViewer({ projectId }: GitLabPipelineViewerProps) {
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

  useEffect(() => {
    if (projectId) {
      fetchPipelines(projectId);
    }
    return () => clearPipelineState();
  }, [projectId, fetchPipelines, clearPipelineState]);

  // Auto-refresh running pipelines -- use scalar deps to avoid interval churn
  const activePipelineId = activePipeline?.id ?? null;
  const activePipelineStatus = activePipeline?.status ?? null;
  useEffect(() => {
    if (!projectId || !activePipelineId) return;
    if (activePipelineStatus !== 'running' && activePipelineStatus !== 'pending') return;

    const interval = setInterval(() => {
      refreshPipeline(projectId, activePipelineId);
    }, 5000);

    return () => clearInterval(interval);
  }, [projectId, activePipelineId, activePipelineStatus, refreshPipeline]);

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted-foreground/70">Select a project in the Deploy tab to view pipelines.</p>
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
        <p className="text-sm text-muted-foreground/70">
          {pipelines.length > 0 ? `${pipelines.length} pipeline(s)` : 'No pipelines'}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={() => fetchPipelines(projectId)}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={triggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            loading={triggering}
            onClick={handleTrigger}
            disabled={triggering}
            accentColor="orange"
          >
            Trigger Pipeline
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
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                <FileText className="w-6 h-6 text-orange-400/60" />
              </div>
              <p className="text-sm text-muted-foreground/70">No pipelines yet</p>
              <p className="text-xs text-muted-foreground/50 mt-1">Trigger a pipeline to get started</p>
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
                  <span className="text-sm font-medium text-foreground/90">
                    Pipeline #{activePipeline.id}
                  </span>
                  <span className={`text-xs capitalize ${statusColor(activePipeline.status)}`}>
                    {activePipeline.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {activePipeline.webUrl && (
                    <a
                      href={activePipeline.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
                      title="Open in GitLab"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => refreshPipeline(projectId, activePipeline.id)}
                    title="Refresh pipeline"
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
                  <p className="text-sm text-muted-foreground/50 text-center py-4">No jobs found</p>
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
            <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-muted-foreground/50">
              Select a pipeline to view jobs
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
