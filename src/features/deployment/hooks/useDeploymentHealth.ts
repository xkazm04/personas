import { useEffect, useState, useRef } from 'react';
import { cloudExecutionStats } from '@/api/system/cloud';
import type { HealthDataPoint } from '../components/DeploymentHealthSparkline';

interface DeploymentHealthMap {
  [deploymentId: string]: HealthDataPoint[];
}

/**
 * Fetches CloudExecutionStats for each unique personaId in the deployment list,
 * then maps the daily_breakdown back to each deployment row by its ID.
 *
 * Deployments with the same persona share the same stats.
 * GitLab deployments (no personaId) are skipped.
 */
export function useDeploymentHealth(
  rows: Array<{ id: string; personaId: string | null }>,
): { healthMap: DeploymentHealthMap; isLoading: boolean } {
  const [healthMap, setHealthMap] = useState<DeploymentHealthMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const prevKeyRef = useRef('');

  // Build a stable key from sorted unique persona IDs to avoid re-fetching
  const personaEntries = rows
    .filter((r) => r.personaId)
    .map((r) => ({ id: r.id, personaId: r.personaId! }));

  const uniquePersonaIds = [...new Set(personaEntries.map((e) => e.personaId))].sort();
  const stableKey = uniquePersonaIds.join(',');
  // Track deployment row IDs so re-mapping triggers when deployments change
  const deploymentIdsKey = personaEntries.map((e) => e.id).sort().join(',');
  const personaEntriesRef = useRef(personaEntries);
  personaEntriesRef.current = personaEntries;

  // Cache fetched stats so re-mapping doesn't require re-fetching
  const statsCache = useRef<Record<string, HealthDataPoint[]>>({});

  useEffect(() => {
    const needsFetch = stableKey !== prevKeyRef.current && uniquePersonaIds.length > 0;
    if (!needsFetch) {
      // Persona IDs unchanged — just re-map with current deployment rows
      const entries = personaEntriesRef.current;
      if (entries.length === 0) return;
      const mapped: DeploymentHealthMap = {};
      for (const entry of entries) {
        const data = statsCache.current[entry.personaId];
        if (data) mapped[entry.id] = data;
      }
      setHealthMap(mapped);
      setIsLoading(false);
      return;
    }

    prevKeyRef.current = stableKey;
    let cancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const newStats: Record<string, HealthDataPoint[]> = {};

        // Fetch stats for each unique personaId (7-day window)
        const results = await Promise.allSettled(
          uniquePersonaIds.map(async (pid) => {
            const stats = await cloudExecutionStats(pid, 7);
            return { personaId: pid, daily: stats.daily_breakdown };
          }),
        );

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { personaId, daily } = result.value;
            newStats[personaId] = daily.map((d) => ({
              date: d.date,
              count: d.count,
              successRate: d.success_rate,
              cost: d.cost,
            }));
          }
        }

        if (cancelled) return;

        statsCache.current = newStats;

        // Map persona stats back to deployment row IDs
        const entries = personaEntriesRef.current;
        const mapped: DeploymentHealthMap = {};
        for (const entry of entries) {
          const data = newStats[entry.personaId];
          if (data) mapped[entry.id] = data;
        }

        setHealthMap(mapped);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [stableKey, deploymentIdsKey]);

  return { healthMap, isLoading };
}
