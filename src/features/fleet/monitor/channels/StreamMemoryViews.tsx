import { useTeamMemories } from '@/features/teams/sub_teamMemory/useTeamMemories';
import MemoryTimeline from '@/features/teams/sub_teamMemory/components/timeline/MemoryTimeline';
import RunDiffView from '@/features/teams/sub_teamMemory/components/diff/RunDiffView';
import type { MemoryMode } from './lensModel';

/**
 * MEMORY'S ANALYTICAL VIEWS inside the Stream (D2).
 *
 * The run-grouped timeline and the run-to-run diff have no equivalent in a flat
 * log — they answer "what did this team LEARN between two runs?", which no
 * amount of filtering a stream can express. So they survive the consolidation as
 * alternate renderers of the memory lens rather than being lost with the retired
 * Team-memory pane.
 *
 * Gated (D8): both compare runs of ONE team, so they only appear when memory is
 * the sole active kind AND a single channel is scoped. The Stream enforces that
 * before mounting this; `teamId` is therefore always the one scoped team.
 */
export function StreamMemoryViews({
  teamId, mode, onExit,
}: {
  teamId: string;
  mode: Exclude<MemoryMode, 'list'>;
  onExit: () => void;
}) {
  // useTeamMemories fetches on mount and owns its own refresh cadence.
  const { memories, stats, onFilterByRun } = useTeamMemories(teamId);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      {mode === 'timeline' ? (
        <MemoryTimeline memories={memories} stats={stats} onFilterRun={onFilterByRun} activeRunFilter={null} />
      ) : (
        <RunDiffView stats={stats} onClose={onExit} />
      )}
    </div>
  );
}
