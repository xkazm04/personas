import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listAuditIncidents,
  getAuditIncidentsSummary,
  type AuditIncident,
  type AuditIncidentSummary,
  type IncidentFilters,
} from '@/api/overview/incidents';

const DEFAULT_LIMIT = 100;
const REFRESH_INTERVAL_MS = 30_000;

export interface UseIncidentsDataResult {
  incidents: AuditIncident[];
  summary: AuditIncidentSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
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
  const inFlightRef = useRef(false);

  // Stable filter key for the dependency array.
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const [rows, sum] = await Promise.all([
        listAuditIncidents(filters, DEFAULT_LIMIT, 0),
        getAuditIncidentsSummary(),
      ]);
      setIncidents(rows);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
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

  return { incidents, summary, loading, error, refresh };
}
