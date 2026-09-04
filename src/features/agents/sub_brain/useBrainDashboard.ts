import { useCallback, useEffect, useState } from 'react';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { getPersonaBrainDashboard } from '@/api/agents/personaBrain';
import { listPersonaResponsibilities } from '@/api/agents/responsibilities';
import type { PersonaBrainDashboard } from '@/lib/bindings/PersonaBrainDashboard';
import { silentCatch } from '@/lib/silentCatch';

/** The roster row the coverage tile needs — id + title, nothing else. */
export interface CharterRef {
  id: string;
  title: string;
}

export interface BrainDashboardState {
  dashboard: PersonaBrainDashboard | null;
  charters: CharterRef[];
  /** `true` only while the FIRST fetch for this persona is in flight. */
  isLoading: boolean;
  /**
   * The dashboard read failed. Distinct from "the persona has nothing yet":
   * an error must never be painted as an empty brain.
   */
  failed: boolean;
  /**
   * The charter roster read failed. The coverage tile MUST distinguish this
   * from "this persona holds no charters" — the second is an answer, the first
   * is a missing measurement.
   */
  chartersFailed: boolean;
  reload: () => void;
}

/**
 * Module-scoped warm caches (loading pattern v2, mechanic 4): the Life tab's
 * lazy sections fully unmount on nav-away, so a remount paints the last read
 * instead of re-ghosting. Multi-entry (keyed by persona) → `createModuleCache`
 * with a named cap, never a hand-rolled Map.
 *
 * Separate from `sub_life/lifeCache.ts` on purpose: that module is shared with
 * the Responsibilities surface and this one is the Brain dashboard's own.
 */
const OPTS = { ttlMs: 60_000, maxSize: 8 } as const;
const dashboardCache = createModuleCache<string, PersonaBrainDashboard>(OPTS);
const chartersCache = createModuleCache<string, CharterRef[]>(OPTS);

/**
 * One read for the whole Brain dashboard, plus the charter roster the coverage
 * tile diffs against (`get_persona_brain_dashboard` returns only the charters
 * that HAVE episodes — the absence set is the difference against the roster).
 */
export function useBrainDashboard(personaId: string): BrainDashboardState {
  const [dashboard, setDashboard] = useState<PersonaBrainDashboard | null>(
    () => dashboardCache.get(personaId) ?? null,
  );
  const [charters, setCharters] = useState<CharterRef[]>(
    () => chartersCache.get(personaId) ?? [],
  );
  const [isLoading, setIsLoading] = useState(!dashboardCache.has(personaId));
  const [failed, setFailed] = useState(false);
  const [chartersFailed, setChartersFailed] = useState(false);
  const [epoch, setEpoch] = useState(0);

  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setDashboard(dashboardCache.get(personaId) ?? null);
    setCharters(chartersCache.get(personaId) ?? []);
    setFailed(false);
    setChartersFailed(false);
    Promise.all([
      getPersonaBrainDashboard(personaId),
      listPersonaResponsibilities(personaId).catch((err) => {
        // The roster is the coverage tile's second input; losing it degrades
        // that one tile to "charters unavailable" and must not blank the rest.
        silentCatch('brain:listCharters')(err);
        if (alive) setChartersFailed(true);
        return null;
      }),
    ])
      .then(([view, roster]) => {
        dashboardCache.set(personaId, view);
        if (alive) setDashboard(view);
        if (roster == null) return;
        const refs = roster.map((r) => ({ id: r.id, title: r.title }));
        chartersCache.set(personaId, refs);
        if (alive) setCharters(refs);
      })
      .catch((err) => {
        silentCatch('brain:dashboard')(err);
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [personaId, epoch]);

  return { dashboard, charters, isLoading, failed, chartersFailed, reload };
}
