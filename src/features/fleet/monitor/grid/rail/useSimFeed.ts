// useSimFeed — a `RailFeed` over simulated rows.
//
// It grows a window exactly as `useRailFeeds`' own `useWindow` does, and for
// the same reason: the rail's infinite-load path is real code with a real
// virtualizer behind it, and a simulation that handed every row over at once
// would leave the one branch a 46-row queue exists to exercise untouched.
//
// SCOPING is applied here too, because a rail that ignored the board's column
// scope while simulating would make the header click look broken. It is a NAME
// test, which is what the review feed's own scope is (`railFilter`'s header
// explains what that can and cannot see); a simulated row's project reaches it
// through the group header it opens or the `Project Role` in its source line.

import { useCallback, useMemo, useState } from 'react';
import type { RailFeed } from './useRailFeeds';
import type { RailRow } from './railModel';
import { normalizeName, type RailProjectFilter } from './railFilter';

/** Same page size as the real feeds, so the two behave identically. */
const PAGE = 30;

/** Stable empty list — a fresh `[]` per render re-invalidates every memo below. */
const NO_ROWS: RailRow[] = [];

function inScope(row: RailRow, filter: RailProjectFilter): boolean {
  if (row.groupHeader && filter.names.has(normalizeName(row.groupHeader))) return true;
  const source = normalizeName(row.source);
  if (!source) return false;
  if (filter.names.has(source)) return true;
  // A source line reads "<Project> <Role>", and the column is scoped by the
  // project. A prefix test is the honest match for that shape; anything looser
  // would start matching projects by their first word.
  for (const name of filter.names) {
    if (name.length > 2 && source.startsWith(name)) return true;
  }
  return false;
}

export function useSimFeed(rows: RailRow[] | null, filter: RailProjectFilter | null): RailFeed {
  const all = useMemo(() => {
    if (!rows) return NO_ROWS;
    return filter ? rows.filter((row) => inScope(row, filter)) : rows;
  }, [rows, filter]);

  const [take, setTake] = useState(PAGE);
  const loadMore = useCallback(() => setTake((n) => n + PAGE), []);

  return useMemo(
    () => ({
      rows: all.length > take ? all.slice(0, take) : all,
      loading: false,
      hasMore: all.length > take,
      loadMore,
      total: all.length,
    }),
    [all, take, loadMore],
  );
}
