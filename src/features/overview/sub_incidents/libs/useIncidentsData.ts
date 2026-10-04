import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';
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
  /** In flight for the KPI strip ONLY — retires independently of `loading`. */
  summaryLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** True when the fetch hit `DEFAULT_LIMIT` — the list may be missing older rows. */
  truncated: boolean;
}

/**
 * Fetch the inbox list and the KPI summary, refreshing every 30s and on filter
 * change. Filters are stable-referenced via JSON.stringify so callers can pass
 * an inline object without re-fetching on every render.
 *
 * **Two regions, two cycles** (overview-loading law 6, 2026-10-03). This hook
 * used to run one `Promise.all([list, summary])` behind one `setLoading(false)`,
 * so the KPI strip and the ledger appeared on the same frame and each waited on
 * the other's command. They are separate regions of the surface and now hold
 * separate flags, separate request tokens and separate settles. This is NOT a
 * speed-up and must never be sold as one: `tauriInvoke` has no concurrency
 * limiter, the two calls overlapped before and overlap now, and a fan-out over
 * N already costs max(latency). It makes each region START SHOWING when its own
 * data lands instead of when the slower of the two does.
 */
export function useIncidentsData(filters: IncidentFilters): UseIncidentsDataResult {
  const [incidents, setIncidents] = useState<AuditIncident[]>([]);
  const [summary, setSummary] = useState<AuditIncidentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Monotonic request token. A plain boolean in-flight guard couldn't tell a
  // duplicate poll (drop it) from a NEW request after a filter change (must run):
  // it dropped the filter-change refetch, so the list showed stale-filter rows
  // for up to the 30s poll interval. With a token, overlapping requests are
  // allowed and only the newest response is applied (out-of-order-safe too).
  const reqSeqRef = useRef(0);
  // The summary is global (no filter dimension), so it carries its OWN token:
  // a filter change supersedes the list's request without superseding a
  // summary request that is still legitimately in flight.
  const summarySeqRef = useRef(0);

  // Stable filter key for the dependency array.
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const refreshList = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    try {
      const rows = await listAuditIncidents(filters, DEFAULT_LIMIT, 0);
      if (seq !== reqSeqRef.current) return; // superseded by a newer request
      setIncidents(rows);
      setTruncated(rows.length >= DEFAULT_LIMIT);
      setError(null);
    } catch (e) {
      if (seq === reqSeqRef.current) setError(String(e));
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // A summary failure never becomes the surface's error: the ledger is the
  // surface, the KPI strip is a header on it. It keeps its last good numbers.
  const refreshSummary = useCallback(async () => {
    const seq = ++summarySeqRef.current;
    setSummaryLoading(true);
    try {
      const sum = await getAuditIncidentsSummary();
      if (seq !== summarySeqRef.current) return;
      setSummary(sum);
    } catch (e) {
      // Never becomes the surface's error (see above), but it still leaves a
      // breadcrumb: the strip silently showing stale numbers is exactly the
      // kind of failure that has to be visible in Sentry.
      silentCatch('useIncidentsData:summary')(e);
    } finally {
      if (seq === summarySeqRef.current) setSummaryLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    // Both are started here and neither awaits the other's state write; the
    // combined promise exists only so an ACTION (a resolve, the Refresh
    // button) can await "both rounds are done".
    await Promise.all([refreshList(), refreshSummary()]);
  }, [refreshList, refreshSummary]);

  // Two effects, not one: the list re-runs on every filter change, the global
  // summary does not (it has no filter dimension). Keeping them in one effect
  // is what made the strip re-ghost on a filter click.
  useEffect(() => {
    void refreshList();
    const id = window.setInterval(() => { void refreshList(); }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshList]);

  useEffect(() => {
    void refreshSummary();
    const id = window.setInterval(() => { void refreshSummary(); }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshSummary]);

  return { incidents, summary, loading, summaryLoading, error, refresh, truncated };
}
