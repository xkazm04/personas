import { useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import type { GitLabJob } from '@/api/system/gitlab';
import { StatusIcon, statusBg, formatDuration } from './pipelineHelpers';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { useTranslation } from '@/i18n/useTranslation';

const LOG_PAINT_LINES = 200;

function tailLines(text: string, n: number): string {
  let cuts = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === '\n') {
      cuts += 1;
      if (cuts >= n) return text.slice(i + 1);
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Job log viewer
// ---------------------------------------------------------------------------

function JobLogViewer({ log }: { log: string | null }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLPreElement>(null);
  const painted = useMemo(() => (log ? tailLines(log, LOG_PAINT_LINES) : ''), [log]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [painted]);

  if (log == null) {
    return (
      <div
        className="max-h-72 rounded-card bg-black/40 p-3 space-y-1.5 animate-fade-in"
        style={{ animationDelay: '120ms' }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="block h-3 rounded bg-primary/[0.06]"
            style={{ width: `${72 - i * 8}%` }}
          />
        ))}
      </div>
    );
  }

  if (log.length === 0) {
    return (
      <div className="text-center py-4 typo-body text-foreground">{t.gitlab.no_log_output}</div>
    );
  }

  return (
    <pre
      ref={scrollRef}
      className="max-h-72 overflow-auto rounded-card bg-black/40 p-3 typo-code font-mono text-foreground whitespace-pre-wrap break-all leading-relaxed scrollbar-thin"
    >
      {painted}
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
  const { t } = useTranslation();
  const jobLog = useSystemStore((s) => s.gitlabJobLog);
  const fetchJobLog = useSystemStore((s) => s.gitlabFetchJobLog);

  const handleToggle = () => {
    if (!isExpanded) {
      fetchJobLog(projectId, job.id);
    }
    onToggle();
  };

  return (
    <div className={`rounded-modal border ${statusBg(job.status)}`}>
      <button
        type="button"
        onClick={handleToggle}
        className="w-full text-left p-2.5 flex items-center gap-2.5"
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-foreground" />
        )}
        <StatusIcon status={job.status} />
        <div className="flex-1 min-w-0">
          <span className="typo-body font-medium text-foreground/85">{job.name}</span>
          <span className="typo-caption text-foreground ml-2">{job.stage}</span>
        </div>
        {job.duration != null && (
          <span className="typo-caption text-foreground">{formatDuration(job.duration)}</span>
        )}
        {sanitizeExternalUrl(job.webUrl) && (
          <a
            href={sanitizeExternalUrl(job.webUrl)!}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1 rounded hover:bg-secondary/50 text-foreground hover:text-foreground/70 transition-colors"
            title={t.gitlab.open_in_gitlab}
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
