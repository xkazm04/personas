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
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-modal border transition-colors ${
        isActive
          ? 'border-orange-500/30 bg-orange-500/5'
          : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <StatusIcon status={pipeline.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="typo-body font-medium text-foreground/90">#{pipeline.id}</span>
            <span className={`typo-caption font-medium capitalize ${statusColor(pipeline.status)}`}>
              {pipeline.status}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 typo-caption text-foreground">
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
        <ChevronRight className={`w-4 h-4 text-foreground transition-transform ${isActive ? 'rotate-90' : ''}`} />
      </div>
    </button>
  );
}
