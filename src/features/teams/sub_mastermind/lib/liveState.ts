// Live operational signals for Mastermind islands. Island colour used to derive
// ONLY from static passport readiness scores; this module wires two live inputs
// on top, with an honest fallback:
//   • real monitoring errors — from each project's bound monitoring credential
//     (dev_projects.monitoring_credential_id) via the SAME Sentry stats adapter
//     the Observability tab uses. A project with no supported monitoring
//     credential is simply absent from the map → readiness-only colour (no fake
//     green, no fake red).
//   • fleet attention — any awaiting_input or stale session on a project raises
//     a "needs you" marker.
//
// The combination logic is pure + unit-tested (see liveState.test.ts); the
// async fetch (loadMonitoringSummaries) is the only IPC-touching part.
import {
  fetchSentryStats, fetchSentryOrgs, splitSentrySlug,
  type MonitoringStats,
} from '@/features/plugins/dev-tools/sub_overview/adapters';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import { silentCatch } from '@/lib/silentCatch';

import type { FleetNode, IslandState } from './types';

/** Compact live monitoring rollup for one project (subset of MonitoringStats). */
export type MonitoringSummary = MonitoringStats;

/** Where an island's colour came from — surfaced in the banner tooltip so the
 *  operator knows whether they're looking at static readiness or a live signal. */
export type IslandStateSource = 'readiness' | 'errors';

/** Monitoring health severity from a summary. `error` = actively receiving
 *  events in the last 24h (fresh errors); `warn` = open unresolved issues but
 *  quiet; `none` = clean or unknown. */
export function monitoringSeverity(s: MonitoringSummary | undefined): 'error' | 'warn' | 'none' {
  if (!s) return 'none';
  if (s.eventsLast24h > 0) return 'error';
  if ((s.unresolvedIssues ?? 0) > 0) return 'warn';
  return 'none';
}

/** Combine static readiness state with live monitoring severity. Fresh errors
 *  flip the island to error-state; quiet-but-open issues bump a healthy/
 *  building island down to warning; otherwise readiness stands unchanged. When
 *  no summary is bound the readiness colour is returned verbatim. */
export function combineIslandState(
  readiness: IslandState,
  s: MonitoringSummary | undefined,
): { state: IslandState; source: IslandStateSource } {
  const sev = monitoringSeverity(s);
  if (sev === 'error') return { state: 'critical', source: 'errors' };
  if (sev === 'warn') {
    const state: IslandState = readiness === 'healthy' || readiness === 'building' ? 'warning' : readiness;
    return { state, source: 'errors' };
  }
  return { state: readiness, source: 'readiness' };
}

/** A project "needs you" when any of its fleet sessions is awaiting input or
 *  has gone stale (a live CLI blocked on the operator). */
export function computeAttention(fleet: readonly FleetNode[]): boolean {
  return fleet.some((n) => n.state === 'awaiting_input' || n.state === 'stale');
}

/** Service types with a live monitoring stats adapter (mirrors the
 *  Observability tab's MONITORING_ADAPTERS — only Sentry today). */
const SENTRY = 'sentry';

/** Bound the number of concurrent Sentry stat fetches. */
async function boundedForEach<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await fn(items[i]!);
      }
    }),
  );
}

/**
 * Fetch live monitoring stats for every project with a bound, supported
 * monitoring credential (bounded concurrency). Reuses the Observability tab's
 * Sentry adapter — no fork. Projects without a supported credential, or whose
 * per-project fetch fails, are simply absent from the returned map (honest
 * unknown → readiness-only colour). Throws only if it can't run at all.
 */
export async function loadMonitoringSummaries(
  projects: readonly DevProject[],
  credentials: readonly PersonaCredential[],
): Promise<Map<string, MonitoringSummary>> {
  const credById = new Map(credentials.map((c) => [c.id, c]));
  const targets = projects.filter((p) => {
    const cid = p.monitoring_credential_id;
    if (!cid) return false;
    const c = credById.get(cid);
    return Boolean(c && c.serviceType.toLowerCase() === SENTRY);
  });

  const out = new Map<string, MonitoringSummary>();
  await boundedForEach(targets, 4, async (p) => {
    const credId = p.monitoring_credential_id;
    if (!credId) return;
    const [orgSlug, projectSlug] = splitSentrySlug(p.monitoring_project_slug);
    if (!projectSlug) return; // no project configured → honestly unknown
    let org = orgSlug;
    if (!org) {
      const orgs = await fetchSentryOrgs(credId).catch(() => []);
      org = orgs[0]?.slug ?? null;
    }
    if (!org) return;
    try {
      out.set(p.id, await fetchSentryStats(credId, org, projectSlug));
    } catch (err) {
      // One project's stats failing is non-fatal — leave it unknown.
      silentCatch('mastermind liveState.loadMonitoringSummaries')(err);
    }
  });
  return out;
}
