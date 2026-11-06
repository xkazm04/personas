import { GitCommitVertical, ChevronRight } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { MemoryEntry } from './TimelineItem';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { RunDiffSummary } from '../../libs/useRunDiffSummaries';

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
  diff,
  isExpanded,
  onToggle,
  onFilterRun,
  isFiltered,
}: {
  group: RunGroup;
  diff?: RunDiffSummary;
  isExpanded: boolean;
  onToggle: () => void;
  onFilterRun: (runId: string) => void;
  isFiltered: boolean;
}) {
  const { t, tx } = useTranslation();
  return (
    <div className="relative">
      {/* Run header */}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-modal border transition-colors text-left ${
          isFiltered
            ? 'bg-role-agent/15 border-role-agent/25'
            : 'bg-surface-1 border-hair hover:border-hair'
        }`}
      >
        <div className="w-5 h-5 rounded-full bg-role-agent/20 border border-role-agent/30 flex items-center justify-center flex-shrink-0">
          <GitCommitVertical className="w-3 h-3 text-role-agent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="typo-code text-foreground truncate">
              {shortRunId(group.runId)}
            </span>
            <span className="typo-body text-role-agent">
              {tx(group.memories.length === 1 ? t.pipeline.timeline_memories_one : t.pipeline.timeline_memories_other, { count: group.memories.length })}
            </span>
            {/* What this run changed vs its predecessor (full per-run sets, not the paged list) */}
            {diff && (diff.added > 0 || diff.removed > 0) && (
              <span className="flex items-center gap-1 typo-caption flex-shrink-0" title={t.pipeline.timeline_diff_tooltip}>
                {diff.added > 0 && <span className="text-status-success">+{diff.added}</span>}
                {diff.removed > 0 && <span className="text-status-error">−{diff.removed}</span>}
              </span>
            )}
          </div>
          <RelativeTime timestamp={group.firstCreatedAt} className="typo-body text-foreground" />
        </div>
        <ChevronRight className={`w-3 h-3 text-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {/* Expanded memories */}
      {isExpanded && (
        <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-role-agent/15 pl-2.5">
          {group.memories.map((m) => (
            <MemoryEntry key={m.id} memory={m} />
          ))}
          {!isFiltered && (
            <button
              type="button"
              onClick={() => onFilterRun(group.runId)}
              className="typo-body text-role-agent hover:text-role-agent transition-colors pl-1 py-0.5"
            >
              {t.pipeline.filter_to_run}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
