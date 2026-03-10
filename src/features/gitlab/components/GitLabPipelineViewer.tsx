import { useState, useEffect } from 'react';
import { Play, RefreshCw, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
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

  const pipelines = usePersonaStore((s) => s.gitlabPipelines);
  const activePipeline = usePersonaStore((s) => s.gitlabActivePipeline);
  const jobs = usePersonaStore((s) => s.gitlabPipelineJobs);
  const loading = usePersonaStore((s) => s.gitlabPipelineLoading);
  const triggering = usePersonaStore((s) => s.gitlabTriggeringPipeline);

  const fetchPipelines = usePersonaStore((s) => s.gitlabFetchPipelines);
  const triggerPipeline = usePersonaStore((s) => s.gitlabTriggerPipelineAction);
  const selectPipeline = usePersonaStore((s) => s.gitlabSelectPipeline);
  const refreshPipeline = usePersonaStore((s) => s.gitlabRefreshPipeline);
  const clearPipelineState = usePersonaStore((s) => s.gitlabClearPipelineState);

  useEffect(() => {
    if (projectId) {
      fetchPipelines(projectId);
    }
    return () => clearPipelineState();
  }, [projectId, fetchPipelines, clearPipelineState]);

  // Auto-refresh running pipelines
  useEffect(() => {
    if (!projectId || !activePipeline) return;
    if (activePipeline.status !== 'running' && activePipeline.status !== 'pending') return;

    const interval = setInterval(() => {
      refreshPipeline(projectId, activePipeline.id);
    }, 5000);

    return () => clearInterval(interval);
  }, [projectId, activePipeline, refreshPipeline]);

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
          <button
            onClick={() => fetchPipelines(projectId)}
            disabled={loading}
            className="flex items-center gap-1.5 px-2 py-1 text-sm rounded-lg text-muted-foreground/60 hover:text-foreground/80 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-40"
          >
            {triggering ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Trigger Pipeline
          </button>
        </div>
      </div>

      {/* Pipeline list + detail split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: pipeline list */}
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1 scrollbar-thin">
          {loading && pipelines.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground/50 text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Loading pipelines...
            </div>
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
                  <button
                    onClick={() => refreshPipeline(projectId, activePipeline.id)}
                    className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
                    title="Refresh pipeline"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Jobs list */}
              <div className="space-y-2">
                {jobs.length === 0 && loading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground/50 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Loading jobs...
                  </div>
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
