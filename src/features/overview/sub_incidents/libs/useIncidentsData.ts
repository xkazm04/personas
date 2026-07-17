import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listAuditIncidents,
  getAuditIncidentsSummary,
  type AuditIncident,
  type AuditIncidentSummary,
  type IncidentFilters,
} from '@/api/overview/incidents';

export const DEFAULT_LIMIT = 100;
const REFRESH_INTERVAL_MS = 30_000;

export interface UseIncidentsDataResult {
  incidents: AuditIncident[];
  summary: AuditIncidentSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** True when the fetch hit `DEFAULT_LIMIT` — the list may be missing older rows. */
  truncated: boolean;
}

/**
 * Fetch the inbox list and summary together, refreshing every 30s and on
 * filter change. Filters are stable-referenced via JSON.stringify so callers
 * can pass an inline object without re-fetching on every render.
 */
export function useIncidentsData(filters: IncidentFilters): UseIncidentsDataResult {
  const [incidents, setIncidents] = useState<AuditIncident[]>([]);
  const [summary, setSummary] = useState<AuditIncidentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Monotonic request token. A plain boolean in-flight guard couldn't tell a
  // duplicate poll (drop it) from a NEW request after a filter change (must run):
  // it dropped the filter-change refetch, so the list showed stale-filter rows
  // for up to the 30s poll interval. With a token, overlapping requests are
  // allowed and only the newest response is applied (out-of-order-safe too).
  const reqSeqRef = useRef(0);

  // Stable filter key for the dependency array.
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const refresh = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    try {
      const [rows, sum] = await Promise.all([
        listAuditIncidents(filters, DEFAULT_LIMIT, 0),
        getAuditIncidentsSummary(),
      ]);
      if (seq !== reqSeqRef.current) return; // superseded by a newer request
      setIncidents(rows);
      setSummary(sum);
      setTruncated(rows.length >= DEFAULT_LIMIT);
      setError(null);
    } catch (e) {
      if (seq === reqSeqRef.current) setError(String(e));
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { incidents, summary, loading, error, refresh, truncated };
}
