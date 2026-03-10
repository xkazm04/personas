import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Square, Clock, Loader2 } from 'lucide-react';
import { getWorkflowJobOutput } from '@/api/pipeline/workflows';
import type { WorkflowJob } from '@/api/pipeline/workflows';
import { StatusIcon, statusBadgeClass, formatElapsed, JOB_TYPE_LABELS } from './workflowHelpers';

interface JobRowProps {
  job: WorkflowJob;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
}

export function JobRow({ job, expanded, onToggle, onCancel }: JobRowProps) {
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

          {job.error && (
            <div className="px-4 py-2 text-[12px] text-red-400 bg-red-500/5 border-b border-primary/5">
              {job.error}
            </div>
          )}

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
              <div className="text-muted-foreground/60 py-4 text-center">No output yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
