/**
 * useCockpitSummary — derived snapshot for Cockpit widgets and inline cards.
 *
 * Produces a tiny struct describing "who the user is", "what happened today",
 * "how many assistants are active", "how many integrations are healthy", and
 * "how many inbox items need attention". All fields are derived from existing
 * Zustand stores — this hook introduces zero new IPC surface.
 *
 * Source truths:
 *   - personas: useAgentStore
 *   - credentials: useVaultStore
 *   - executionDashboard: useOverviewStore (last daily_points bucket = today)
 *   - user: useAuthStore
 *   - inbox: useUnifiedInbox
 *
 * A credential is considered "connected" only when
 * `healthcheck_last_success === true`. A null value means "unknown / never
 * tested" — we treat unknown as NOT ok because we can't prove the credential
 * works. This is intentionally conservative.
 */
import { useMemo } from 'react';

import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useVaultStore } from '@/stores/vaultStore';

import { useUnifiedInbox } from './useUnifiedInbox';

export interface CockpitSummary {
  /** Display name, email local-part, or null if no user is loaded. */
  greetingName: string | null;
  /** Time-of-day bucket derived from `new Date().getHours()` at render time. */
  greetingKind: 'morning' | 'afternoon' | 'evening';
  /** Total executions in today's daily bucket, or 0 if dashboard not loaded. */
  runsToday: number;
  /** Personas where `enabled !== false`. */
  activePersonaCount: number;
  /** Total persona count (enabled + disabled). */
  totalPersonaCount: number;
  /** Credentials with `healthcheck_last_success === true`. */
  connectedOk: number;
  /** Total credential count. */
  connectedTotal: number;
  /**
   * Count of inbox items that need the user's attention: pending approvals
   * plus any critical-severity item regardless of kind.
   */
  needsMeCount: number;
  /** Total inbox items (post-hook cap of 50). */
  inboxCount: number;
  /**
   * `true` once the source stores have produced a usable snapshot. During
   * initial hydration this is `false` so consumers can render their empty /
   * skeleton state instead of treating all-zeros as "definitively empty".
   */
  isHydrated: boolean;
}

function bucketOfHour(h: number): CockpitSummary['greetingKind'] {
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/**
 * Aggregate Cockpit header counters from the five source stores / hooks.
 *
 * Memoized on the five inputs; re-runs only when one of the underlying arrays
 * changes identity.
 */
export function useCockpitSummary(): CockpitSummary {
  const personasRaw = useAgentStore((s) => s.personas);
  const credentialsRaw = useVaultStore((s) => s.credentials);
  const executionDashboard = useOverviewStore((s) => s.executionDashboard);
  const user = useAuthStore((s) => s.user);
  const inboxRaw = useUnifiedInbox();

  return useMemo(() => {
    const personas = personasRaw ?? [];
    const credentials = credentialsRaw ?? [];
    const inbox = inboxRaw ?? [];
    const isHydrated =
      personasRaw !== undefined && credentialsRaw !== undefined && inboxRaw !== undefined;

    const name =
      user?.display_name ?? (user?.email ? user.email.split('@')[0] ?? null : null);
    const activePersonas = personas.filter((p) => p.enabled !== false);
    const okCreds = credentials.filter((c) => c.healthcheck_last_success === true);
    const todayPoint = executionDashboard?.daily_points?.at(-1);
    const needsMe = inbox.filter(
      (i) => i.kind === 'approval' || i.severity === 'critical',
    ).length;

    return {
      greetingName: name,
      greetingKind: bucketOfHour(new Date().getHours()),
      runsToday: todayPoint?.total_executions ?? 0,
      activePersonaCount: activePersonas.length,
      totalPersonaCount: personas.length,
      connectedOk: okCreds.length,
      connectedTotal: credentials.length,
      needsMeCount: needsMe,
      inboxCount: inbox.length,
      isHydrated,
    };
  }, [personasRaw, credentialsRaw, executionDashboard, user, inboxRaw]);
}
