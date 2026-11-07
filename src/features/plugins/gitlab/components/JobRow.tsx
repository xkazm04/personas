import { useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import type { GitLabJob } from '@/api/system/gitlab';
import { StatusIcon, statusBg, formatDuration } from './pipelineHelpers';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PressSurface } from '@/features/shared/components/buttons';
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
            className="block h-3 rounded-interactive bg-surface-2"
            style={{ width: `${72 - i * 8}%` }}
          />
        ))}
      </div>
    );
  }

  if (log.length === 0) {
    return (
      <EmptyState art="report" size="sm" title={t.gitlab.no_log_output} />
    );
  }

  return (
    <pre
      ref={scrollRef}
      className="max-h-72 overflow-auto rounded-card bg-black/40 p-3 typo-code text-ink-1 whitespace-pre-wrap break-all scrollbar-thin"
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
      <PressSurface onPress={handleToggle} className="w-full p-2.5 flex items-center gap-2.5">
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-ink-1" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-ink-1" />
        )}
        <StatusIcon status={job.status} />
        <div className="flex-1 min-w-0 truncate">
          <span className="typo-body text-ink-2">{job.name}</span>
          <span className="typo-caption text-ink-2 ml-2">{job.stage}</span>
        </div>
        {job.duration != null && (
          <span className="typo-caption text-ink-2">{formatDuration(job.duration)}</span>
        )}
        {sanitizeExternalUrl(job.webUrl) && (
          <Tooltip content={t.gitlab.open_in_gitlab}>
            <a
              href={sanitizeExternalUrl(job.webUrl)!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-interactive hover:bg-surface-2 text-ink-1 hover:text-ink-2 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Tooltip>
        )}
      </PressSurface>

      {isExpanded && (
        <div className="px-3 pb-3">
          <JobLogViewer log={jobLog} />
        </div>
      )}
    </div>
  );
}
