/**
 * useSimpleSummary — derived snapshot for Simple-mode variants.
 *
 * Produces a tiny struct describing "who the user is", "what happened today",
 * "how many assistants are active", "how many integrations are healthy", and
 * "how many inbox items need attention". All fields are derived from existing
 * Zustand stores — this hook introduces zero new IPC surface.
 *
 * Consumed by Phase 07 Mosaic (header summary stats), and later Phase 08
 * Console / Phase 09 Inbox for consistent top-level counters.
 *
 * Source truths:
 *   - personas: useAgentStore
 *   - credentials: useVaultStore
 *   - executionDashboard: useOverviewStore (last daily_points bucket = today)
 *   - user: useAuthStore
 *   - inbox: useUnifiedInbox (same keystone hook every variant reads)
 *
 * Persona.enabled is non-nullable (see src/lib/bindings/Persona.ts), so the
 * "enabled !== false" guard here is defensive against future binding drift.
 *
 * A credential is considered "connected" only when
 * `healthcheck_last_success === true`. A null value means "unknown / never
 * tested" — we treat unknown as NOT ok because we can't prove the credential
 * works. This matches HealthStatusBar.tsx's conservative reading.
 *
 * `runsToday` reads the last element of `executionDashboard.daily_points`.
 * If the dashboard hasn't been fetched yet, or the array is empty, we fall
 * back to 0 rather than throw. The backend orders daily_points chronologically
 * so `.at(-1)` is always "today" when present.
 */
import { useMemo } from 'react';

import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useVaultStore } from '@/stores/vaultStore';

import { useUnifiedInbox } from './useUnifiedInbox';

export interface SimpleSummary {
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
}

/**
 * Map an hour-of-day integer (0-23) to the "morning / afternoon / evening"
 * bucket used for greeting copy. Midnight-noon = morning, noon-6pm =
 * afternoon, 6pm-midnight = evening.
 */
function bucketOfHour(h: number): SimpleSummary['greetingKind'] {
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/**
 * Aggregate Simple-mode header counters from the five source stores / hooks.
 *
 * Memoized on the five inputs; re-runs only when one of the underlying arrays
 * changes identity. The `Date` call is inside the memo so re-renders during
 * the same minute return the same bucket without recomputing the dashboard
 * slice; a bucket transition only happens when something else triggers a
 * re-render, which is acceptable for greeting copy accuracy.
 */
export function useSimpleSummary(): SimpleSummary {
  const personas = useAgentStore((s) => s.personas);
  const credentials = useVaultStore((s) => s.credentials);
  const executionDashboard = useOverviewStore((s) => s.executionDashboard);
  const user = useAuthStore((s) => s.user);
  const inbox = useUnifiedInbox();

  return useMemo(() => {
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
    };
  }, [personas, credentials, executionDashboard, user, inbox]);
}
