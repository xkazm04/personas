import { useCallback, useEffect, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { listCredentials } from '@/api/vault/credentials';
import { silentCatch } from '@/lib/silentCatch';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import {
  fetchSentryStats,
  fetchSentryOrgs,
  splitSentrySlug,
  type MonitoringStats,
} from '../sub_overview/adapters';

/**
 * Connection states for the Monitoring Observability surface — the app-monitoring
 * analog of `useLlmPinpoints`, mirroring the same 6-state model:
 * - `empty`       — no monitoring credential exists in the vault.
 * - `unmapped`    — a monitoring credential exists but this project isn't fully
 *                   linked (no credential assigned, or assigned but no project
 *                   slug picked yet).
 * - `unsupported` — a credential is assigned but its stats adapter isn't wired
 *                   (e.g. Better Stack — role member, no adapter yet).
 * - `loading` / `connected` / `error` — self-explanatory.
 */
export type MonConnState =
  | 'empty'
  | 'unmapped'
  | 'unsupported'
  | 'loading'
  | 'connected'
  | 'error';

/**
 * Service types treated as traditional app-monitoring connectors. Sentry ships a
 * live stats adapter; Better Stack is a catalog `monitoring` connector without an
 * adapter yet (renders as `unsupported`). Kept a narrow explicit set — the same
 * shape as `LLM_TRACKING_SERVICE_TYPES` — so future error/uptime tools opt in
 * deliberately.
 */
export const MONITORING_SERVICE_TYPES = new Set(['sentry', 'betterstack']);
/** Which of the above actually have a live stats adapter. */
const MONITORING_ADAPTERS = new Set(['sentry']);

export function isMonitoringCred(c: PersonaCredential): boolean {
  return MONITORING_SERVICE_TYPES.has(c.serviceType.toLowerCase());
}

// Module-scoped warm cache (docs/design/overview-loading.md, law 1) — mirrors
// useLlmPinpoints's cache. Local useState, not store-backed, and the page
// unmounts on every DevTools tab switch, so a return visit within the same
// session would otherwise cold-start the stat tiles every time.
let cachedProjectId: string | null = null;
let cachedStats: MonitoringStats | null = null;
let cachedCred: PersonaCredential | null = null;

/**
 * Data layer for the Monitoring Overview tab. Resolves the active project's
 * `monitoring_credential_id` + `monitoring_project_slug`, fetches the summary
 * stats through the existing Sentry adapter, and exposes the reload callback.
 */
export function useMonitoringPinpoints() {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );

  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [credLoaded, setCredLoaded] = useState(false);

  const warmForProject = !!activeProjectId && activeProjectId === cachedProjectId && cachedStats !== null;
  const [state, setState] = useState<MonConnState>(warmForProject ? 'connected' : 'loading');
  const [stats, setStats] = useState<MonitoringStats | null>(warmForProject ? cachedStats : null);
  const [error, setError] = useState<string | null>(null);
  const [cred, setCred] = useState<PersonaCredential | null>(warmForProject ? cachedCred : null);

  useEffect(() => {
    listCredentials()
      .then((creds) => {
        setCredentials(creds);
        setCredLoaded(true);
      })
      .catch((err: unknown) => {
        silentCatch('useMonitoringPinpoints:listCredentials')(err);
        setCredLoaded(true);
      });
  }, []);

  const monCreds = credentials.filter(isMonitoringCred);

  const load = useCallback(async () => {
    if (!activeProject || !credLoaded) return;
    const credId = activeProject.monitoring_credential_id;
    const slug = activeProject.monitoring_project_slug;
    setError(null);

    if (!credId) {
      setState(monCreds.length > 0 ? 'unmapped' : 'empty');
      setCred(null);
      return;
    }
    const c = credentials.find((x) => x.id === credId);
    if (!c) {
      setState('unmapped');
      setCred(null);
      return;
    }
    setCred(c);

    const serviceType = c.serviceType.toLowerCase();
    if (!MONITORING_ADAPTERS.has(serviceType)) {
      setState('unsupported');
      return;
    }
    if (!slug) {
      // Credential assigned but no project slug picked yet — needs the picker.
      setState('unmapped');
      return;
    }

    setState('loading');
    try {
      const [storedOrg, storedProject] = splitSentrySlug(slug);
      let orgSlug = storedOrg;
      const projectSlug = storedProject ?? slug;
      if (!orgSlug) {
        const orgs = await fetchSentryOrgs(credId);
        if (orgs.length === 1 && orgs[0]) {
          orgSlug = orgs[0].slug;
        } else {
          setState('unmapped');
          return;
        }
      }
      const s = await fetchSentryStats(credId, orgSlug, projectSlug);
      setStats(s);
      setState('connected');
      cachedProjectId = activeProjectId;
      cachedStats = s;
      cachedCred = c;
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeProject, activeProjectId, credentials, credLoaded, monCreds.length]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    activeProjectId,
    activeProject,
    credLoaded,
    monCreds,
    cred,
    state,
    stats,
    error,
    reload: load,
  };
}

export type MonitoringPinpointsData = ReturnType<typeof useMonitoringPinpoints>;
