import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Workflow,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Square,
  Clock,
  Terminal,
  RefreshCw,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useToastStore } from '@/stores/toastStore';
import { getWorkflowsOverview, getWorkflowJobOutput, cancelWorkflowJob } from '@/api/workflows';
import type { WorkflowsOverview, WorkflowJob } from '@/api/workflows';

const JOB_TYPE_LABELS: Record<string, string> = {
  n8n_transform: 'N8n Transform',
  template_adopt: 'Template Adopt',
  template_generate: 'Template Generate',
  query_debug: 'Query Debug',
};

const STATUS_FILTER_OPTIONS = ['all', 'running', 'completed', 'failed'] as const;
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

function statusBadgeClass(status: string): string {
  if (status === 'running') return 'bg-blue-500/15 text-blue-400 border-blue-500/25';
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
  if (status === 'failed') return 'bg-red-500/15 text-red-400 border-red-500/25';
  if (status === 'awaiting_answers') return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  return 'bg-secondary/60 text-muted-foreground border-primary/10';
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />;
  if (status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  if (status === 'awaiting_answers') return <Clock className="w-3.5 h-3.5 text-amber-400" />;
  return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
}

// ── Summary Cards ──────────────────────────────────────────────────────

function SummaryCards({ data }: { data: WorkflowsOverview }) {
  const cards = [
    { label: 'Total Jobs', value: data.total_count, color: 'text-foreground', bg: 'bg-secondary/40' },
    { label: 'Running', value: data.running_count, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Completed', value: data.completed_count, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Failed', value: data.failed_count, color: 'text-red-400', bg: 'bg-red-500/10' },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`${c.bg} rounded-xl border border-primary/10 px-4 py-3`}>
          <div className="text-[11px] text-muted-foreground/80 uppercase tracking-wide mb-1">{c.label}</div>
          <div className={`text-2xl font-semibold tabular-nums ${c.color}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Job Row ─────────────────────────────────────────────────────────────

function JobRow({
  job,
  expanded,
  onToggle,
  onCancel,
}: {
  job: WorkflowJob;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const [fullOutput, setFullOutput] = useState<string[] | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded && !fullOutput) {
      setLoadingOutput(true);
      getWorkflowJobOutput(job.job_type, job.job_id)
        .then(setFullOutput)
        .catch(() => setFullOutput(job.output_tail))
        .finally(() => setLoadingOutput(false));
    }
  }, [expanded, fullOutput, job.job_type, job.job_id, job.output_tail]);

  useEffect(() => {
    if (expanded && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [expanded, fullOutput]);

  const lines = fullOutput ?? job.output_tail;
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;

  return (
    <div className="border border-primary/10 rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors text-left"
      >
        <StatusIcon status={job.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {JOB_TYPE_LABELS[job.job_type] || job.job_type}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusBadgeClass(job.status)}`}>
              {job.status.replace(/_/g, ' ')}
            </span>
          </div>
          {!expanded && lastLine && (
            <div className="text-[11px] text-muted-foreground/70 truncate mt-0.5 font-mono">
              {lastLine}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-muted-foreground/60 tabular-nums">
            {job.line_count} lines
          </span>
          <span className="text-[11px] text-muted-foreground/60 tabular-nums flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatElapsed(job.elapsed_secs)}
          </span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground/50" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground/50" />
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-primary/10 bg-black/20">
          {/* Actions bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/5">
            <span className="text-[11px] text-muted-foreground/60 font-mono truncate flex-1">
              ID: {job.job_id}
            </span>
            {job.status === 'running' && (
              <button
                onClick={(e) => { e.stopPropagation(); onCancel(); }}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25 transition-colors"
              >
                <Square className="w-3 h-3" />
                Cancel
              </button>
            )}
          </div>

          {/* Error message */}
          {job.error && (
            <div className="px-4 py-2 text-[12px] text-red-400 bg-red-500/5 border-b border-primary/5">
              {job.error}
            </div>
          )}

          {/* Output log */}
          <div
            ref={outputRef}
            className="max-h-64 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground/80"
          >
            {loadingOutput ? (
              <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground/50">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading output...
              </div>
            ) : lines.length > 0 ? (
              lines.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  <span className="text-muted-foreground/30 select-none mr-2 inline-block w-6 text-right">{i + 1}</span>
                  {line}
                </div>
              ))
            ) : (
              <div className="text-muted-foreground/40 py-4 text-center">No output yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────────────

export default function WorkflowsDashboard() {
  const [data, setData] = useState<WorkflowsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    getWorkflowsOverview()
      .then(setData)
      .catch(() => { /* intentional: non-critical — background dashboard poll */ })
      .finally(() => setLoading(false));
  }, []);

  // Initial load + auto-refresh every 2s when any jobs are running
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data && data.running_count > 0) {
      pollRef.current = setInterval(load, 2000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [data?.running_count, load]);

  const toggleJob = (key: string) => {
    setExpandedJob((prev) => (prev === key ? null : key));
  };

  const handleCancel = async (job: WorkflowJob) => {
    try {
      await cancelWorkflowJob(job.job_type, job.job_id);
      load();
    } catch {
      useToastStore.getState().addToast('Failed to cancel workflow job', 'error');
    }
  };

  const filteredJobs = (data?.jobs ?? []).filter((j) => {
    if (statusFilter !== 'all' && j.status !== statusFilter) return false;
    if (typeFilter !== 'all' && j.job_type !== typeFilter) return false;
    return true;
  });

  const jobTypes = [...new Set((data?.jobs ?? []).map((j) => j.job_type))];

  return (
    <ContentBox>
      <ContentHeader
        icon={<Workflow className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Workflows"
        subtitle="Active and recent background operations across your workspace"
        actions={
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl bg-secondary/60 text-muted-foreground hover:text-foreground border border-primary/10 hover:border-primary/20 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <ContentBody>
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground/60">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading workflows...
          </div>
        ) : !data || data.total_count === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Terminal className="w-10 h-10 text-muted-foreground/20" />
            <div className="text-sm text-muted-foreground/60">No background jobs running or recent</div>
            <div className="text-[11px] text-muted-foreground/40">
              Jobs appear here when you run N8n transforms, template adoptions, template generation, or query debugging
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Summary cards */}
            <SummaryCards data={data} />

            {/* Filters */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                {STATUS_FILTER_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`text-[11px] px-2.5 py-1 rounded-xl border transition-colors capitalize ${
                      statusFilter === f
                        ? 'bg-violet-500/15 text-violet-400 border-violet-500/25'
                        : 'bg-secondary/40 text-muted-foreground/70 border-primary/10 hover:text-foreground'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              {jobTypes.length > 1 && (
                <>
                  <div className="w-px h-4 bg-primary/10" />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTypeFilter('all')}
                      className={`text-[11px] px-2.5 py-1 rounded-xl border transition-colors ${
                        typeFilter === 'all'
                          ? 'bg-violet-500/15 text-violet-400 border-violet-500/25'
                          : 'bg-secondary/40 text-muted-foreground/70 border-primary/10 hover:text-foreground'
                      }`}
                    >
                      All types
                    </button>
                    {jobTypes.map((t) => (
                      <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        className={`text-[11px] px-2.5 py-1 rounded-xl border transition-colors ${
                          typeFilter === t
                            ? 'bg-violet-500/15 text-violet-400 border-violet-500/25'
                            : 'bg-secondary/40 text-muted-foreground/70 border-primary/10 hover:text-foreground'
                        }`}
                      >
                        {JOB_TYPE_LABELS[t] || t}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Job list */}
            <div className="flex flex-col gap-2">
              {filteredJobs.length === 0 ? (
                <div className="text-[12px] text-muted-foreground/50 text-center py-8">
                  No jobs match the current filters
                </div>
              ) : (
                filteredJobs.map((job) => {
                  const key = `${job.job_type}:${job.job_id}`;
                  return (
                    <JobRow
                      key={key}
                      job={job}
                      expanded={expandedJob === key}
                      onToggle={() => toggleJob(key)}
                      onCancel={() => handleCancel(job)}
                    />
                  );
                })
              )}
            </div>

            {/* Auto-refresh indicator */}
            {data.running_count > 0 && (
              <div className="flex items-center gap-1.5 text-[10px] text-blue-400/60">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Auto-refreshing while jobs are running
              </div>
            )}
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
