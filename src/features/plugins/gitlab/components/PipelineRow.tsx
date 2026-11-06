import { ChevronRight, Timer, GitBranch } from 'lucide-react';
import type { GitLabPipeline } from '@/api/system/gitlab';
import { StatusIcon, statusColor, formatDuration, formatRelative } from './pipelineHelpers';

interface PipelineRowProps {
  pipeline: GitLabPipeline;
  isActive: boolean;
  onSelect: () => void;
}

export function PipelineRow({ pipeline, isActive, onSelect }: PipelineRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-modal border transition-colors ${
        isActive
          ? 'border-status-warning/30 bg-status-warning/5'
          : 'border-hair bg-surface-1 hover:bg-surface-2'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <StatusIcon status={pipeline.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-body text-ink-2">#{pipeline.id}</span>
            <span className={`typo-caption capitalize ${statusColor(pipeline.status)}`}>
              {pipeline.status}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 typo-caption text-ink-2">
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
        <ChevronRight className={`w-4 h-4 text-ink-1 transition-transform ${isActive ? 'rotate-90' : ''}`} />
      </div>
    </button>
  );
}
