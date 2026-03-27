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

  useEffect(() => {
    if (stableKey === prevKeyRef.current || uniquePersonaIds.length === 0) return;
    prevKeyRef.current = stableKey;

    let cancelled = false;
    setIsLoading(true);

    (async () => {
      const statsMap: Record<string, HealthDataPoint[]> = {};

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
          statsMap[personaId] = daily.map((d) => ({
            date: d.date,
            count: d.count,
            successRate: d.success_rate,
            cost: d.cost,
          }));
        }
      }

      if (cancelled) return;

      // Map persona stats back to deployment row IDs
      const mapped: DeploymentHealthMap = {};
      for (const entry of personaEntries) {
        const data = statsMap[entry.personaId];
        if (data) mapped[entry.id] = data;
      }

      setHealthMap(mapped);
      setIsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [stableKey]);

  return { healthMap, isLoading };
}
