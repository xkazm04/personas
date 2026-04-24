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
  /**
   * `true` once the source stores have produced a usable snapshot. During
   * initial hydration (before `useUnifiedInbox` and the persona/credential
   * stores resolve) this is `false` so consumers can render their empty /
   * skeleton state instead of treating all-zeros as "definitively empty".
   */
  isHydrated: boolean;
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
  const personasRaw = useAgentStore((s) => s.personas);
  const credentialsRaw = useVaultStore((s) => s.credentials);
  const executionDashboard = useOverviewStore((s) => s.executionDashboard);
  const user = useAuthStore((s) => s.user);
  const inboxRaw = useUnifiedInbox();

  return useMemo(() => {
    // Guard the hook boundary: during first paint a Zustand slice may not yet
    // have run its initializer, and `useUnifiedInbox` can transiently return
    // `undefined` before its memo resolves. Defaulting to `[]` here keeps the
    // Simple home page from blanking with a `Cannot read properties of
    // undefined (reading 'filter')` on mount.
    const personas = personasRaw ?? [];
    const credentials = credentialsRaw ?? [];
    const inbox = inboxRaw ?? [];
    const isHydrated =
      personasRaw !== undefined && credentialsRaw !== undefined && inboxRaw !== undefined;

    const name =
      user?.display_name ?? (user?.email ? user.email.split('@')[0] ?? null : null);
    const activePersonas = personas.filter((p) => p.enabled !== false);
    const okCreds = credentials.filter((c) => c.healthcheck_last_success === true);
    // Avoid `.at(-1)` — not every TS target in this repo includes it. Using
    // explicit index access keeps us compatible with ES2021 and the plan
    // semantics are identical (empty array → undefined → fall back to 0).
    const points = executionDashboard?.daily_points;
    const todayPoint = points && points.length > 0 ? points[points.length - 1] : undefined;
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
