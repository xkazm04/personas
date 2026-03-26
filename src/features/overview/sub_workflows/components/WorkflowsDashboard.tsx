import { useState, useEffect, useCallback, useRef } from 'react';
import { Workflow, Terminal, RefreshCw } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useToastStore } from '@/stores/toastStore';
import { getWorkflowsOverview, cancelWorkflowJob } from '@/api/pipeline/workflows';
import type { WorkflowsOverview, WorkflowJob } from '@/api/pipeline/workflows';
import { STATUS_FILTER_OPTIONS, JOB_TYPE_LABELS, type StatusFilter } from '../workflowHelpers';
import { SummaryCards, JobRow } from './WorkflowCard';

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
      .catch(() => { /* intentional: non-critical */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (data && data.running_count > 0) {
      pollRef.current = setInterval(load, 2000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [data?.running_count, load]);

  const toggleJob = (key: string) => setExpandedJob((prev) => (prev === key ? null : key));

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
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-xl bg-secondary/60 text-muted-foreground hover:text-foreground border border-primary/10 hover:border-primary/20 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        }
      />

      <ContentBody>
        {loading && !data ? (
          null
        ) : !data || data.total_count === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Terminal className="w-10 h-10 text-muted-foreground/20" />
            <div className="text-sm text-muted-foreground/60">No background jobs running or recent</div>
            <div className="text-[11px] text-muted-foreground/60">
              Jobs appear here when you run N8n transforms, template adoptions, template generation, or query debugging
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
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
                      className={`text-[11px] px-2.5 py-1 rounded-xl border transition-colors ${typeFilter === 'all' ? 'bg-violet-500/15 text-violet-400 border-violet-500/25' : 'bg-secondary/40 text-muted-foreground/70 border-primary/10 hover:text-foreground'}`}
                    >
                      All types
                    </button>
                    {jobTypes.map((t) => (
                      <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        className={`text-[11px] px-2.5 py-1 rounded-xl border transition-colors ${typeFilter === t ? 'bg-violet-500/15 text-violet-400 border-violet-500/25' : 'bg-secondary/40 text-muted-foreground/70 border-primary/10 hover:text-foreground'}`}
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
                <div className="text-[12px] text-muted-foreground/50 text-center py-8">No jobs match the current filters</div>
              ) : (
                filteredJobs.map((job) => {
                  const key = `${job.job_type}:${job.job_id}`;
                  return <JobRow key={key} job={job} expanded={expandedJob === key} onToggle={() => toggleJob(key)} onCancel={() => handleCancel(job)} />;
                })
              )}
            </div>

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
