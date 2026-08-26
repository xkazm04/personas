import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import { incidentDaysOpen, severityRank } from './incidentTaxonomy';

/**
 * Sort + paginate the incident list for the ledger surfaces.
 *
 * Grouping is gone (the inbox is a flat ledger), so ordering and paging are the
 * whole model. Paging is client-side over the already-fetched window — the
 * fetch is capped at `DEFAULT_LIMIT` upstream, so this keeps the DOM to one
 * page (25/50/100 rows) instead of rendering the whole window, which is the
 * performance practice the other Overview tables get from virtualization.
 */

export type IncidentSortKey = 'created' | 'severity' | 'source' | 'persona' | 'state' | 'age';
export type SortDirection = 'asc' | 'desc';

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface IncidentLedgerState {
  /** The rows for the current page. */
  page: AuditIncident[];
  /** Every row in sort order (all pages) — keyboard triage walks this. */
  sorted: AuditIncident[];
  pageIndex: number;
  pageCount: number;
  pageSize: PageSize;
  /** 1-based index of the first row on this page (0 when empty). */
  rangeStart: number;
  /** 1-based index of the last row on this page (0 when empty). */
  rangeEnd: number;
  total: number;
  sortKey: IncidentSortKey;
  sortDir: SortDirection;
  /** Click a column: same key flips direction, a new key adopts its default. */
  toggleSort: (key: IncidentSortKey) => void;
  setPageIndex: (index: number) => void;
  setPageSize: (size: PageSize) => void;
}

/** Descending is the useful default for time and severity; ascending for names. */
const DEFAULT_DIR: Record<IncidentSortKey, SortDirection> = {
  created: 'desc',
  severity: 'desc',
  source: 'asc',
  persona: 'asc',
  state: 'asc',
  age: 'desc',
};

/** Open first, then acknowledged/in-progress, then closed — triage order. */
const STATE_RANK: Record<string, number> = {
  open: 0,
  acknowledged: 1,
  in_progress: 2,
  resolved: 3,
  dismissed: 4,
};

function compare(a: AuditIncident, b: AuditIncident, key: IncidentSortKey): number {
  switch (key) {
    case 'severity':
      return severityRank(b.severity) - severityRank(a.severity);
    case 'source':
      return a.sourceTable.localeCompare(b.sourceTable);
    case 'persona':
      return (a.personaName ?? '').localeCompare(b.personaName ?? '');
    case 'state':
      return (STATE_RANK[a.status] ?? 9) - (STATE_RANK[b.status] ?? 9);
    case 'age':
      return incidentDaysOpen(b.createdAt) - incidentDaysOpen(a.createdAt);
    case 'created':
    default:
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  }
}

export function useIncidentLedger(
  incidents: AuditIncident[],
  opts?: { initialSortKey?: IncidentSortKey; initialPageSize?: PageSize },
): IncidentLedgerState {
  const [sortKey, setSortKey] = useState<IncidentSortKey>(opts?.initialSortKey ?? 'created');
  const [sortDir, setSortDir] = useState<SortDirection>(DEFAULT_DIR[opts?.initialSortKey ?? 'created']);
  const [pageSize, setPageSizeState] = useState<PageSize>(opts?.initialPageSize ?? 25);
  const [pageIndex, setPageIndex] = useState(0);

  const sorted = useMemo(() => {
    // `compare` is written descending-first (newest / most severe first), so an
    // ascending sort is its negation — one comparator, no duplicated ordering.
    const rows = [...incidents].sort((a, b) => compare(a, b, sortKey));
    return sortDir === 'asc' ? rows.reverse() : rows;
  }, [incidents, sortKey, sortDir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // A shrinking result set (a filter, or rows being resolved away) must never
  // strand the view on a page that no longer exists.
  useEffect(() => {
    setPageIndex((i) => Math.min(i, pageCount - 1));
  }, [pageCount]);

  // A new sort is a new reading order — start it from the top.
  const toggleSort = useCallback((key: IncidentSortKey) => {
    setSortKey((prevKey) => {
      setSortDir((prevDir) => (prevKey === key ? (prevDir === 'desc' ? 'asc' : 'desc') : DEFAULT_DIR[key]));
      return key;
    });
    setPageIndex(0);
  }, []);

  const setPageSize = useCallback((size: PageSize) => {
    setPageSizeState(size);
    setPageIndex(0);
  }, []);

  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const start = safeIndex * pageSize;
  const page = useMemo(() => sorted.slice(start, start + pageSize), [sorted, start, pageSize]);

  return {
    page,
    sorted,
    pageIndex: safeIndex,
    pageCount,
    pageSize,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + pageSize, total),
    total,
    sortKey,
    sortDir,
    toggleSort,
    setPageIndex,
    setPageSize,
  };
}
