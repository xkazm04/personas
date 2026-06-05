import { GitCommitVertical, ChevronRight } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { MemoryEntry, formatTime } from './TimelineItem';
import { useTranslation } from '@/i18n/useTranslation';

interface RunGroup {
  runId: string;
  memories: TeamMemory[];
  firstCreatedAt: string;
}

export type { RunGroup };

function shortRunId(runId: string): string {
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}

export function RunMarker({
  group,
  isExpanded,
  onToggle,
  onFilterRun,
  isFiltered,
}: {
  group: RunGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onFilterRun: (runId: string) => void;
  isFiltered: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      {/* Run header */}
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-modal border transition-colors text-left ${
          isFiltered
            ? 'bg-violet-500/15 border-violet-500/25'
            : 'bg-primary/5 border-primary/10 hover:border-primary/20'
        }`}
      >
        <div className="w-5 h-5 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
          <GitCommitVertical className="w-3 h-3 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="typo-code font-medium text-foreground font-mono truncate">
              {shortRunId(group.runId)}
            </span>
            <span className="typo-body text-violet-400/80 font-medium">
              {group.memories.length} memor{group.memories.length !== 1 ? 'ies' : 'y'}
            </span>
          </div>
          <span className="typo-body text-foreground">{formatTime(group.firstCreatedAt)}</span>
        </div>
        <ChevronRight className={`w-3 h-3 text-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Expanded memories */}
      {isExpanded && (
        <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-violet-500/15 pl-2.5">
          {group.memories.map((m) => (
            <MemoryEntry key={m.id} memory={m} />
          ))}
          {!isFiltered && (
            <button
              onClick={() => onFilterRun(group.runId)}
              className="typo-body text-violet-400/60 hover:text-violet-400 transition-colors pl-1 py-0.5"
            >
              {t.pipeline.filter_to_run}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
