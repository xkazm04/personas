import { useEffect, useState } from 'react';
import type { ResponsibilityMeasured } from '@/lib/bindings/ResponsibilityMeasured';
import { getResponsibilityMeasured } from '@/api/agents/responsibilityMeasured';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Warm cache of the per-charter measured aggregate, keyed by persona id
 * (loading pattern v2, mechanic 4). Multi-entry, so `createModuleCache` names
 * its cap and TTL rather than a hand-rolled Map. One fetch serves every charter
 * of the persona: the command returns the whole list.
 */
export const measuredCache = createModuleCache<string, ResponsibilityMeasured[]>({
  ttlMs: 5 * 60_000,
  maxSize: 8,
});

// One in-flight request per persona: the detail view remounts the card per
// charter, and each mount must not start its own IPC for the same list.
const inflight = new Map<string, Promise<void>>();

export interface CharterMeasuredResult {
  /** `null` = the charter has no measured passes (absent from the list). */
  measured: ResponsibilityMeasured | null;
  isLoading: boolean;
}

export function useCharterMeasured(personaId: string, responsibilityId: string): CharterMeasuredResult {
  const [rows, setRows] = useState<ResponsibilityMeasured[] | null>(() => measuredCache.get(personaId) ?? null);

  useEffect(() => {
    let cancelled = false;
    const cached = measuredCache.get(personaId);
    setRows(cached ?? null);
    if (!personaId || measuredCache.has(personaId)) return;
    let pending = inflight.get(personaId);
    if (!pending) {
      pending = getResponsibilityMeasured(personaId)
        .then((list) => measuredCache.set(personaId, list))
        .catch((err) => {
          silentCatch('responsibilities:measured')(err);
          // Settle as "nothing measured" so the ghost does not hang forever.
          measuredCache.set(personaId, []);
        })
        .finally(() => {
          inflight.delete(personaId);
        });
      inflight.set(personaId, pending);
    }
    void pending.then(() => {
      if (!cancelled) setRows(measuredCache.get(personaId) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  return {
    measured: rows?.find((m) => m.responsibilityId === responsibilityId) ?? null,
    isLoading: rows === null,
  };
}
