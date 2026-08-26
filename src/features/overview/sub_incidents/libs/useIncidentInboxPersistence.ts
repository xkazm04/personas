import { useEffect, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import type { IncidentFilters } from '@/lib/bindings/IncidentFilters';
import { OPEN_ONLY_FILTERS as DEFAULT_FILTERS } from './incidentFilterDefaults';

const FILTERS_KEY = 'incidents:filters';
const LAST_SEEN_KEY = 'incidents:last-seen';

/**
 * Restore the persisted filter view, but only the stable dimensions
 * (status / severity / source). `since` is an absolute timestamp that would go
 * stale between sessions, and `persona_id` is a transient detail-modal drill-in
 * — both reset to null so the inbox never reopens into a stale deep-filter.
 */
function loadPersistedFilters(): IncidentFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const saved = JSON.parse(raw) as Partial<IncidentFilters>;
    return {
      statuses: saved.statuses ?? DEFAULT_FILTERS.statuses,
      severities: saved.severities ?? null,
      source_tables: saved.source_tables ?? null,
      persona_id: null,
      since: null,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export interface IncidentInboxPersistence {
  filters: IncidentFilters;
  setFilters: (next: IncidentFilters) => void;
  /**
   * The moment the user last left the inbox. Read once on mount and never
   * updated in-session — the marker is stamped on unmount, so "new since your
   * last visit" stays stable while you triage instead of quietly re-baselining
   * under the rows you are reading.
   */
  lastSeenAt: string | null;
}

/**
 * The inbox's two pieces of cross-session memory: the filter view it reopens
 * into, and the timestamp that decides which rows read as new.
 */
export function useIncidentInboxPersistence(): IncidentInboxPersistence {
  const [filters, setFilters] = useState<IncidentFilters>(loadPersistedFilters);
  const [lastSeenAt] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
  });

  useEffect(() => {
    try {
      const { statuses, severities, source_tables } = filters;
      localStorage.setItem(FILTERS_KEY, JSON.stringify({ statuses, severities, source_tables }));
    } catch (e) {
      silentCatch('incidents.filters.persist')(e);
    }
  }, [filters]);

  // Stamp "seen" on leaving so the next visit marks only what arrived while away.
  useEffect(() => {
    return () => {
      try { localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); }
      catch (e) { silentCatch('incidents.last-seen.persist')(e); }
    };
  }, []);

  return { filters, setFilters, lastSeenAt };
}
