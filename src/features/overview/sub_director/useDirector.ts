import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { obsidianAvailable } from '@/api/obsidianBrain';
import { setPersonaStarred } from '@/api/agents/personas';
import {
  getDirectorPortfolio,
  listDirectorVerdicts,
  getDirectorBrainEnabled,
  setDirectorBrainEnabled,
  runDirectorBatch,
  runDirectorOnPersona,
  type DirectorPortfolio,
  type DirectorVerdictRow,
} from '@/api/director';
import type { Persona } from '@/lib/bindings/Persona';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Single source of truth for every Director surface — the command-center route
 * and the slimmed Agents-page teaser both consume this hook instead of each
 * re-implementing the same `Promise.all` fetch + action wiring.
 *
 * Owns: the Director persona, portfolio analytics, the verdict feed, and Brain
 * state; exposes the scope/review/memory actions plus `openDirector()` for
 * deep-linking into the route. All reads are best-effort (a failed fetch leaves
 * the prior value and logs to Sentry); the caller renders loading via `ready`.
 */
export interface UseDirector {
  ready: boolean;
  refreshing: boolean;
  /** The system-owned Director persona, once the agent store has loaded it. */
  director: Persona | undefined;
  /** Every non-system persona (for the roster's "add to scope" picker). */
  personas: Persona[];
  portfolio: DirectorPortfolio | null;
  verdicts: DirectorVerdictRow[];
  brainEnabled: boolean;
  vaultConfigured: boolean;
  refresh: () => void;
  runBatch: () => Promise<void>;
  runOnPersona: (personaId: string) => Promise<void>;
  setStarred: (personaId: string, starred: boolean) => Promise<void>;
  setBrainEnabled: (enabled: boolean) => void;
  /** Navigate to the Director surface (Overview › Director sub-tab). */
  openDirector: () => void;
}

export function useDirector(): UseDirector {
  const personas = useAgentStore((s) => s.personas);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  const director = useMemo(
    () => personas.find((p) => p.trust_origin === 'system' && p.name === 'Director'),
    [personas],
  );

  const [portfolio, setPortfolio] = useState<DirectorPortfolio | null>(null);
  const [verdicts, setVerdicts] = useState<DirectorVerdictRow[]>([]);
  const [brainEnabled, setBrainEnabledState] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    Promise.allSettled([
      getDirectorPortfolio(),
      listDirectorVerdicts(),
      getDirectorBrainEnabled(),
      obsidianAvailable(),
    ])
      .then(([p, v, b, a]) => {
        if (p.status === 'fulfilled') setPortfolio(p.value);
        if (v.status === 'fulfilled') setVerdicts(v.value);
        if (b.status === 'fulfilled') setBrainEnabledState(b.value);
        if (a.status === 'fulfilled') setVaultConfigured(a.value.vaultConfigured);
      })
      .finally(() => {
        setReady(true);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runBatch = useCallback(async () => {
    try {
      await runDirectorBatch();
    } finally {
      refresh();
    }
  }, [refresh]);

  const runOnPersona = useCallback(
    async (personaId: string) => {
      try {
        await runDirectorOnPersona(personaId);
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  const setStarred = useCallback(
    async (personaId: string, starred: boolean) => {
      try {
        await setPersonaStarred(personaId, starred);
        await useAgentStore.getState().fetchPersonas();
      } catch (e) {
        silentCatch('useDirector:setStarred')(e);
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  const setBrainEnabled = useCallback((enabled: boolean) => {
    setBrainEnabledState(enabled); // optimistic
    setDirectorBrainEnabled(enabled).catch((e) => {
      setBrainEnabledState(!enabled); // revert
      silentCatch('useDirector:setBrainEnabled')(e);
    });
  }, []);

  const openDirector = useCallback(() => {
    setOverviewTab('director');
    setSidebarSection('overview');
  }, [setOverviewTab, setSidebarSection]);

  return {
    ready,
    refreshing,
    director,
    personas,
    portfolio,
    verdicts,
    brainEnabled,
    vaultConfigured,
    refresh,
    runBatch,
    runOnPersona,
    setStarred,
    setBrainEnabled,
    openDirector,
  };
}
