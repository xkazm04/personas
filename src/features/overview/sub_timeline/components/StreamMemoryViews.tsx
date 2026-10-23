import { useEffect, useState } from 'react';
import { useTeamMemories } from '@/features/teams/sub_teamMemory/useTeamMemories';
import MemoryTimeline from '@/features/teams/sub_teamMemory/components/timeline/MemoryTimeline';
import RunDiffView from '@/features/teams/sub_teamMemory/components/diff/RunDiffView';
import type { MemoryMode } from '../libs/lensModel';

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
  // The hook keeps the run filter in a ref (the panel owns the filter UI), so the
  // timeline's clear control needs the active run mirrored here. Passing a constant
  // null hid it and left a clicked run filter with no way back.
  const [activeRun, setActiveRun] = useState<string | null>(null);
  useEffect(() => { setActiveRun(null); }, [teamId]);
  const filterRun = (runId: string | null) => { setActiveRun(runId); onFilterByRun(runId); };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      {mode === 'timeline' ? (
        <MemoryTimeline memories={memories} stats={stats} onFilterRun={filterRun} activeRunFilter={activeRun} />
      ) : (
        <RunDiffView stats={stats} onClose={onExit} />
      )}
    </div>
  );
}
