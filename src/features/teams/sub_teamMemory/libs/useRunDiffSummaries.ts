import { useEffect, useState } from 'react';
import { listTeamMemoriesByRun } from '@/api/pipeline/teamMemories';
import { silentCatch } from '@/lib/silentCatch';

export interface RunDiffSummary {
  added: number;
  removed: number;
}

/** Don't fan out unboundedly on teams with long run histories. */
const MAX_RUNS = 12;

/**
 * Per-run "+added / −removed vs the previous run" summaries for the memory
 * timeline. Fetches each run's full memory set (the panel's paged list is
 * incomplete) and diffs consecutive runs by memory id — the same matching
 * rule as `computeMemoryDiff`. The oldest run counts everything as added.
 */
export function useRunDiffSummaries(runIdsChronological: string[]): Map<string, RunDiffSummary> {
  const [summaries, setSummaries] = useState<Map<string, RunDiffSummary>>(new Map());
  const key = runIdsChronological.join(',');

  useEffect(() => {
    if (runIdsChronological.length === 0) {
      setSummaries(new Map());
      return;
    }
    let cancelled = false;
    const recent = runIdsChronological.slice(-MAX_RUNS);
    Promise.all(recent.map((id) => listTeamMemoriesByRun(id)))
      .then((sets) => {
        if (cancelled) return;
        const next = new Map<string, RunDiffSummary>();
        for (let i = 0; i < recent.length; i++) {
          const current = sets[i]!;
          if (i === 0) {
            next.set(recent[i]!, { added: current.length, removed: 0 });
            continue;
          }
          const prev = sets[i - 1]!;
          const prevIds = new Set(prev.map((m) => m.id));
          const currentIds = new Set(current.map((m) => m.id));
          next.set(recent[i]!, {
            added: current.filter((m) => !prevIds.has(m.id)).length,
            removed: prev.filter((m) => !currentIds.has(m.id)).length,
          });
        }
        setSummaries(next);
      })
      .catch(silentCatch('teamMemory/useRunDiffSummaries:fetch'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key encodes the array's content
  }, [key]);

  return summaries;
}
