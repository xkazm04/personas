import { useEffect, useRef, useState } from 'react';
import { listTeamMemoriesByRun } from '@/api/pipeline/teamMemories';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { silentCatch } from '@/lib/silentCatch';

export interface RunDiffSummary {
  added: number;
  removed: number;
}

/** Don't fan out unboundedly on teams with long run histories. */
const MAX_RUNS = 12;

/**
 * Ceiling on the per-mount memo below. It only ever holds the runs one panel
 * session actually looked at, and the reaper is the unmount that drops the
 * whole ref — this bound is the guard for a very long-lived session that keeps
 * filtering across a large history.
 */
const MAX_CACHED_RUNS = 64;

/**
 * Per-run "+added / −removed vs the previous run" summaries for the memory
 * timeline. Fetches each run's full memory set (the panel's paged list is
 * incomplete) and diffs consecutive runs by memory id — the same matching
 * rule as `computeMemoryDiff`. The oldest run counts everything as added.
 */
export function useRunDiffSummaries(runIdsChronological: string[]): Map<string, RunDiffSummary> {
  const [summaries, setSummaries] = useState<Map<string, RunDiffSummary>>(new Map());
  const key = runIdsChronological.join(',');
  // Per-mount memo of each run's fetched memory set. A run's history is
  // append-only and only its NEWEST run can still be growing, so every older
  // run in the window is served from here instead of re-issuing its IPC call.
  // This is what makes the round trip the user actually performs — filter to
  // one run, then clear the filter — cost one call instead of thirteen.
  const cacheRef = useRef<Map<string, TeamMemory[]>>(new Map());

  useEffect(() => {
    if (runIdsChronological.length === 0) {
      setSummaries(new Map());
      return;
    }
    let cancelled = false;
    const recent = runIdsChronological.slice(-MAX_RUNS);
    const cache = cacheRef.current;
    // The window's newest run is the only one that can have gained memories
    // since it was last read, so it is always re-fetched.
    const liveRunId = recent[recent.length - 1];
    const fetchRun = (id: string): Promise<TeamMemory[]> => {
      const hit = id !== liveRunId ? cache.get(id) : undefined;
      if (hit) return Promise.resolve(hit);
      return listTeamMemoriesByRun(id).then((set) => {
        // Recorded even when this effect run has been superseded — the work is
        // already paid for and the next pass should not repeat it.
        cache.set(id, set);
        while (cache.size > MAX_CACHED_RUNS) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        return set;
      });
    };
    // Whether the window's oldest run is genuinely the first run in history.
    // When it is not, its predecessor was never fetched, so it has no baseline
    // to be compared against — and "everything counted as added" would be a
    // fabricated claim on the one marker where the reader cannot check.
    const windowIsWholeHistory = recent.length === runIdsChronological.length;
    Promise.all(recent.map(fetchRun))
      .then((sets) => {
        if (cancelled) return;
        const next = new Map<string, RunDiffSummary>();
        for (let i = 0; i < recent.length; i++) {
          const current = sets[i]!;
          if (i === 0) {
            // No summary at all when the baseline is off the edge of the
            // window: the marker then shows no delta rather than a wrong one.
            if (windowIsWholeHistory) next.set(recent[i]!, { added: current.length, removed: 0 });
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
