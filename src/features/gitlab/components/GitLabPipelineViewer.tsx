import { useState, useEffect, useRef } from 'react';
import {
  Play,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
  GitBranch,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { GitLabPipeline, GitLabJob } from '@/api/gitlab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'success':
      return 'text-emerald-400';
    case 'failed':
      return 'text-red-400';
    case 'running':
    case 'pending':
      return 'text-amber-400';
    case 'canceled':
    case 'skipped':
      return 'text-muted-foreground/50';
    default:
      return 'text-muted-foreground/70';
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500/10 border-emerald-500/20';
    case 'failed':
      return 'bg-red-500/10 border-red-500/20';
    case 'running':
    case 'pending':
      return 'bg-amber-500/10 border-amber-500/20';
    default:
      return 'bg-secondary/30 border-primary/10';
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-amber-400" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground/50" />;
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PipelineRow({
  pipeline,
  isActive,
  onSelect,
}: {
  pipeline: GitLabPipeline;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-xl border transition-colors ${
        isActive
          ? 'border-orange-500/30 bg-orange-500/5'
          : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <StatusIcon status={pipeline.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90">#{pipeline.id}</span>
            <span className={`text-xs font-medium capitalize ${statusColor(pipeline.status)}`}>
              {pipeline.status}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              {pipeline.ref}
            </span>
            <span>·</span>
            <span>{formatRelative(pipeline.createdAt)}</span>
            {pipeline.duration != null && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Timer className="w-3 h-3" />
                  {formatDuration(pipeline.duration)}
                </span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground/40 transition-transform ${isActive ? 'rotate-90' : ''}`} />
      </div>
    </button>
  );
}

function JobRow({
  job,
  projectId,
  isExpanded,
  onToggle,
}: {
  job: GitLabJob;
  projectId: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const jobLog = usePersonaStore((s) => s.gitlabJobLog);
  const fetchJobLog = usePersonaStore((s) => s.gitlabFetchJobLog);

  const handleToggle = () => {
    if (!isExpanded) {
      fetchJobLog(projectId, job.id);
    }
    onToggle();
  };

  return (
    <div className={`rounded-xl border ${statusBg(job.status)}`}>
      <button
        onClick={handleToggle}
        className="w-full text-left p-2.5 flex items-center gap-2.5"
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
        <StatusIcon status={job.status} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground/85">{job.name}</span>
          <span className="text-xs text-muted-foreground/50 ml-2">{job.stage}</span>
        </div>
        {job.duration != null && (
          <span className="text-xs text-muted-foreground/50">{formatDuration(job.duration)}</span>
        )}
        {job.webUrl && (
          <a
            href={job.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-secondary/50 text-muted-foreground/40 hover:text-foreground/70 transition-colors"
            title="Open in GitLab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          <JobLogViewer log={jobLog} />
        </div>
      )}
    </div>
  );
}

function JobLogViewer({ log }: { log: string | null }) {
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log]);

  if (log == null) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground/50 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading log…
      </div>
    );
  }

  if (log.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground/50">No log output</div>
    );
  }

  return (
    <pre
      ref={scrollRef}
      className="max-h-72 overflow-auto rounded-lg bg-black/40 p-3 text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed scrollbar-thin"
    >
      {log}
    </pre>
  );
}

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
              Loading pipelines…
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
                    Loading jobs…
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
