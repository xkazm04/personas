/**
 * Checklist done/total per goal, for every project the visible goals span.
 * One batched read per project (never per row), exactly as the retired Board
 * did. An absent entry means the goal has no checklist, so its progress is
 * manual.
 */
import { useEffect, useState } from 'react';

import * as devApi from '@/api/devTools/devTools';
import { mapWithConcurrency } from '@/lib/concurrency';
import { silentCatch } from '@/lib/silentCatch';

export interface ChecklistCount {
  done: number;
  total: number;
}

/** Local IPC read; width 10 keeps a 30+-project fleet off an unbounded burst. */
const GOAL_ITEMS_CONCURRENCY = 10;

export function useGoalChecklistCounts(projectIds: readonly string[], goalCount: number): ReadonlyMap<string, ChecklistCount> {
  const [counts, setCounts] = useState<ReadonlyMap<string, ChecklistCount>>(new Map());
  const key = [...projectIds].sort().join(',');

  useEffect(() => {
    if (projectIds.length === 0) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;
    mapWithConcurrency([...projectIds], GOAL_ITEMS_CONCURRENCY, (pid) => devApi.listGoalItemsForProject(pid))
      .then((lists) => {
        if (cancelled) return;
        const next = new Map<string, ChecklistCount>();
        for (const it of lists.flat()) {
          const c = next.get(it.goal_id) ?? { done: 0, total: 0 };
          c.total += 1;
          if (it.done) c.done += 1;
          next.set(it.goal_id, c);
        }
        setCounts(next);
      })
      .catch(silentCatch('useGoalChecklistCounts.load'));
    return () => { cancelled = true; };
    // `key` is the project set; `goalCount` catches within-project adds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, goalCount]);

  return counts;
}
