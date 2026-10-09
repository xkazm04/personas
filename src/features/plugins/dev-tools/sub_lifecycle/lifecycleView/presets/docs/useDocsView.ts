// The docs preset's state, shared by the estate map, its toolbar and the
// resolution list: the filter (status chips + path search), the doc selected
// (a cell clicked, a row pressed), the rows expanded, whether the long clean
// group is open, and the request to bring a picked doc's row into view. Every
// figure is derived here once, so the map and the list never disagree.
import { useCallback, useMemo, useState } from 'react';

import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

import { asDocStatus, docsToFix, type DocStatus } from '../docsModel';
import { matchBacklog } from './backlogMatch';
import { buildEstate, countByStatus, filterGroups, isFiltering, matchesFilter, queryTerms, sharedDirPrefix, toggleStatus, type DocsFilter } from './estateModel';

export interface FocusRequest {
  path: string;
  /** Bumped per request, so picking the same doc again still scrolls to it. */
  n: number;
}

export function useDocsView(rows: LifecycleDocRow[], related: LifecycleRelatedItem[]) {
  const [statuses, setStatuses] = useState<ReadonlySet<DocStatus>>(() => new Set());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [cleanOpen, setCleanOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);

  const filter: DocsFilter = useMemo(() => ({ statuses, query }), [statuses, query]);
  const filtering = isFiltering(filter);
  const tiles = useMemo(() => buildEstate(rows), [rows]);
  const prefix = useMemo(() => sharedDirPrefix(tiles), [tiles]);
  const counts = useMemo(() => countByStatus(rows), [rows]);
  const groups = useMemo(() => filterGroups(rows, filter), [rows, filter]);
  const toFix = useMemo(() => docsToFix(rows), [rows]);
  const backlog = useMemo(() => matchBacklog(rows.map((r) => r.docPath), related), [rows, related]);
  const shown = groups.reduce((n, g) => n + g.docs.length, 0);
  // The clean group is the long, quiet one: folded unless asked for, by its button, its chip or a search.
  const cleanShown = cleanOpen || statuses.has('clean') || queryTerms(query).length > 0;

  const toggleRow = useCallback((path: string) => {
    setSelected(path);
    setExpanded((was) => {
      const next = new Set(was);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const clearFilter = useCallback(() => { setStatuses(new Set()); setQuery(''); }, []);

  /** A cell picked on the map: its row is shown (the filter yields if it hid it), opened and brought into view. */
  const pick = useCallback((path: string) => {
    const row = rows.find((r) => r.docPath === path);
    if (!row) return;
    if (!matchesFilter(row, filter)) clearFilter();
    if (asDocStatus(row.status) === 'clean') setCleanOpen(true);
    setSelected(path);
    setExpanded((was) => new Set(was).add(path));
    setFocus((f) => ({ path, n: (f?.n ?? 0) + 1 }));
  }, [rows, filter, clearFilter]);

  return {
    filter, filtering, tiles, prefix, counts, groups, shown, total: rows.length, toFix, backlog,
    selected, expanded, cleanShown, focus,
    setQuery,
    toggleStatus: (s: DocStatus) => setStatuses((was) => toggleStatus(was, s)),
    clearFilter,
    toggleClean: () => setCleanOpen((o) => !o),
    toggleRow,
    pick,
  };
}

export type DocsView = ReturnType<typeof useDocsView>;
