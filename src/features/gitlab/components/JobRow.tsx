import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import type { GitLabJob } from '@/api/system/gitlab';
import { StatusIcon, statusBg, formatDuration } from './pipelineHelpers';

// ---------------------------------------------------------------------------
// Job log viewer
// ---------------------------------------------------------------------------

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
        Loading log...
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
// Job row
// ---------------------------------------------------------------------------

interface JobRowProps {
  job: GitLabJob;
  projectId: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export function JobRow({ job, projectId, isExpanded, onToggle }: JobRowProps) {
  const jobLog = useSystemStore((s) => s.gitlabJobLog);
  const fetchJobLog = useSystemStore((s) => s.gitlabFetchJobLog);

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
