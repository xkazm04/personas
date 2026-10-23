import { useCallback, useEffect, useState } from 'react';
import { listAutonomouslyHandledIncidents } from '@/api/overview/incidents';
import { silentCatch } from '@/lib/silentCatch';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

const LANE_LIMIT = 100;

export interface AutonomousIncidentsState {
  incidents: AuditIncident[];
  /** True until the first fetch settles (success or failure). */
  loading: boolean;
  /**
   * The last read failed. `incidents` then holds the last good list (empty if
   * none ever arrived), which is NOT "the system handled nothing": consumers
   * must not paint an empty failed read as a zero.
   */
  failed: boolean;
  refresh: () => Promise<void>;
}

/**
 * Incidents the system handled without a human click (today: the
 * incident-continuation loop's `continued_at` stamp).
 *
 * Fetched once by the inbox shell so the KPI tile's count and the autonomous
 * log render from the SAME list — two consumers, one IPC round-trip, and no
 * chance of the tile disagreeing with the rows it opens.
 */
export function useAutonomousIncidents(): AutonomousIncidentsState {
  const [incidents, setIncidents] = useState<AuditIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await listAutonomouslyHandledIncidents(LANE_LIMIT);
      setIncidents(rows);
      setFailed(false);
    } catch (err) {
      setFailed(true);
      silentCatch('useAutonomousIncidents:list')(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { incidents, loading, failed, refresh };
}
