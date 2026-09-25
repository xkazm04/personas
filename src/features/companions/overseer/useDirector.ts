import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { navigateToCompanions } from '@/features/companions/navigation';
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
  type DirectorReport,
  type DirectorVerdictRow,
} from '@/api/director';
import type { Persona } from '@/lib/bindings/Persona';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Single source of truth for every Director surface — the command-center route
 * and the slimmed Agents-page teaser both consume this hook instead of each
 * re-implementing the same fetch + action wiring.
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
  /**
   * The report from the most recent completed batch, or null when none has run
   * in this session. `run_director_batch` returns evaluated / emitted / skipped
   * counts (plus the freshness-skipped persona NAMES) precisely so the caller
   * can say what the cycle did; discarding it made a no-op freshness skip
   * indistinguishable from a real coaching cycle that spent LLM budget.
   */
  lastReport: DirectorReport | null;
  /**
   * True when the most recent `getDirectorPortfolio` read REJECTED. Reads here
   * are best-effort and keep the prior value, which is why the caller needs
   * this: without it a failed read is indistinguishable from an empty roster
   * (ready, portfolio null, inScope 0) and the tab paints its first-run hero
   * over a dead backend. See `directorSurface.ts`.
   */
  portfolioError: boolean;
  /** True when the most recent `listDirectorVerdicts` read rejected. */
  verdictsError: boolean;
  brainEnabled: boolean;
  vaultConfigured: boolean;
  /** Selected value-rollup window in days, or null to use the backend default (30). */
  period: number | null;
  setPeriod: (days: number | null) => void;
  refresh: () => void;
  runBatch: () => Promise<DirectorReport>;
  runOnPersona: (personaId: string) => Promise<void>;
  setStarred: (personaId: string, starred: boolean) => Promise<void>;
  setBrainEnabled: (enabled: boolean) => void;
  /** Navigate to the Director surface (Overview › Director sub-tab). */
  openDirector: () => void;
}

export interface UseDirectorOptions {
  /**
   * Defer the Director data fetch (portfolio, verdicts, brain flag,
   * vault-availability) until the Director persona is confirmed present in
   * the agent store. For surfaces that mount unconditionally alongside other
   * content (e.g. the personas-page teaser) rather than behind explicit user
   * navigation — avoids firing the cluster on every page load when Director
   * isn't seeded for this install/tier. Default `false` preserves the
   * original eager-fetch-on-mount behavior for surfaces (the Director
   * command-center tab) that need `ready` to resolve even when `director`
   * turns out to be absent, so they can render their own empty state instead
   * of hanging on a spinner forever.
   */
  lazy?: boolean;
}

export function useDirector(options: UseDirectorOptions = {}): UseDirector {
  const { lazy = false } = options;
  const personas = useAgentStore((s) => s.personas);

  const director = useMemo(
    () => personas.find((p) => p.trust_origin === 'system' && p.name === 'Director'),
    [personas],
  );

  const [portfolio, setPortfolio] = useState<DirectorPortfolio | null>(null);
  const [verdicts, setVerdicts] = useState<DirectorVerdictRow[]>([]);
  const [lastReport, setLastReport] = useState<DirectorReport | null>(null);
  const [portfolioError, setPortfolioError] = useState(false);
  const [verdictsError, setVerdictsError] = useState(false);
  const [brainEnabled, setBrainEnabledState] = useState(false);
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriodState] = useState<number | null>(null);

  const refresh = useCallback(() => {
    setRefreshing(true);
    // Portfolio is the paint-critical payload (KPIs + roster). Apply each
    // sibling as it lands so brain/verdicts/vault never gate first content.
    // A rejection used to be dropped on the floor: no state, no breadcrumb,
    // and `ready` flipped regardless, so a failed fetch painted as an empty
    // scope. Each lane now records its own failure.
    getDirectorPortfolio(period ?? undefined)
      .then((p) => {
        setPortfolio(p);
        setPortfolioError(false);
      })
      .catch((err) => {
        setPortfolioError(true);
        silentCatch('useDirector:portfolio')(err);
      })
      .finally(() => {
        setReady(true);
        setRefreshing(false);
      });
    listDirectorVerdicts()
      .then((v) => {
        setVerdicts(v);
        setVerdictsError(false);
      })
      .catch((err) => {
        setVerdictsError(true);
        silentCatch('useDirector:verdicts')(err);
      });
    getDirectorBrainEnabled()
      .then(setBrainEnabledState)
      .catch(silentCatch('useDirector:brain'));
    obsidianAvailable()
      .then((a) => setVaultConfigured(a.vaultConfigured))
      .catch(silentCatch('useDirector:vault'));
  }, [period]);

  // Refetch on mount and whenever the selected period changes (refresh closes
  // over `period`, so it's a fresh callback per window). `lazy` callers (the
  // always-mounted DirectorPanel teaser) additionally wait for the Director
  // persona to be confirmed present — derived from the agentStore's
  // already-loaded personas, no extra IPC — before firing; that's the gate
  // that keeps the four Director reads (portfolio, verdicts, brain flag,
  // vault-availability) off installs/tiers where Director isn't seeded, and
  // off the very first paint before the persona roster resolves. Non-lazy
  // callers (the Director command-center tab, reached only by explicit user
  // navigation) keep the original eager behavior — they must still resolve
  // `ready` even when `director` turns out to be absent, so their empty
  // state (not an infinite spinner) can render.
  useEffect(() => {
    if (lazy && !director) return;
    refresh();
  }, [refresh, lazy, director]);

  const setPeriod = useCallback((days: number | null) => setPeriodState(days), []);

  const runBatch = useCallback(async () => {
    try {
      const report = await runDirectorBatch();
      setLastReport(report);
      return report;
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

  // Overseer's reviews page left Overview on 2026-09-22; it is the Companions
  // section's `overseer:reviews` destination now.
  const openDirector = useCallback(() => {
    navigateToCompanions('overseer:reviews');
  }, []);

  return {
    ready,
    refreshing,
    director,
    personas,
    portfolio,
    verdicts,
    lastReport,
    portfolioError,
    verdictsError,
    brainEnabled,
    vaultConfigured,
    period,
    setPeriod,
    refresh,
    runBatch,
    runOnPersona,
    setStarred,
    setBrainEnabled,
    openDirector,
  };
}
