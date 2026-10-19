import { useCallback, useEffect, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { listCredentials } from '@/api/vault/credentials';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import {
  detectRepoProvider,
  parseGitHubUrl,
  parseGitLabUrl,
  fetchGitHubStats,
  fetchGitLabStats,
  fetchSentryStats,
  fetchSentryOrgs,
  splitSentrySlug,
  type RepoStats,
  type MonitoringStats,
  type RepoProvider,
} from './adapters';
import { formatErr } from './overviewHelpers';
import { silentCatch } from '@/lib/silentCatch';

export type ConnectionState = 'empty' | 'unmapped' | 'connected' | 'loading' | 'error';

// Module-scoped warm cache (docs/design/overview-loading.md, law 1: "data on
// screen is sacred"). repoStats/monitorStats are local useState, not
// store-backed, and DevToolsPage renders each tab via `{tab === 'x' && <X/>}`
// — a genuine unmount/remount on every tab switch. Without this, returning to
// Overview within the same session cold-started the vital-signs tiles and
// connections rail every time. Stashing the last-fetched stats keyed by
// project lets a return visit paint real numbers on frame 1 and refresh
// silently behind them; only a truly first-ever visit sees the loading ghost.
let cachedProjectId: string | null = null;
let cachedRepoStats: RepoStats | null = null;
let cachedMonitorStats: MonitoringStats | null = null;

export function isGitHubCred(c: PersonaCredential): boolean {
  if (c.serviceType === 'github' || c.serviceType === 'github_actions') return true;
  if (!c.metadata) return false;
  try {
    const meta = JSON.parse(c.metadata) as { platform_type?: string };
    return meta?.platform_type === 'github' || meta?.platform_type === 'github_actions';
  } catch { return false; }
}

export function isGitLabCred(c: PersonaCredential): boolean {
  if (c.serviceType === 'gitlab') return true;
  if (!c.metadata) return false;
  try {
    const meta = JSON.parse(c.metadata) as { platform_type?: string };
    return meta?.platform_type === 'gitlab';
  } catch { return false; }
}

/**
 * Vault credentials that can serve as the repo connector for a project URL.
 *
 * The stats path already routes GitHub and GitLab separately
 * (`detectRepoProvider` -> `fetchGitHubStats` / `fetchGitLabStats`), so the
 * editor must offer the same two providers: a GitHub-only picker left a
 * GitLab project unable to bind the credential its own vitals would use, and
 * the tiles sat on `unmapped` unless a GitHub credential happened to exist.
 *
 * With no detectable provider (empty or self-hosted URL) both are offered and
 * each option names its provider, so the choice is never ambiguous.
 */
export function repoConnectorOptions(
  credentials: PersonaCredential[],
  repoUrl: string | null | undefined,
): { id: string; name: string }[] {
  const provider = repoUrl ? detectRepoProvider(repoUrl) : null;
  return credentials
    .filter((c) => (
      provider === 'gitlab' ? isGitLabCred(c)
        : provider === 'github' ? isGitHubCred(c)
          : isGitHubCred(c) || isGitLabCred(c)
    ))
    .map((c) => ({
      id: c.id,
      name: provider ? c.name : `${c.name} (${isGitLabCred(c) ? 'GitLab' : 'GitHub'})`,
    }));
}

/**
 * Single source of truth for the dev-tools Overview page data layer. Holds
 * credential listing, repo+monitoring stats, and the dependent reload
 * callbacks. Every variant of the Overview consumes this hook so they share
 * the same in-flight requests + cached results.
 */
export function useOverviewData() {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const fetchProjects = useSystemStore((s) => s.fetchProjects);

  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [credLoaded, setCredLoaded] = useState(false);

  const warmForProject = !!activeProjectId && activeProjectId === cachedProjectId;
  const [repoState, setRepoState] = useState<ConnectionState>(warmForProject && cachedRepoStats ? 'connected' : 'loading');
  const [repoProvider, setRepoProvider] = useState<RepoProvider | null>(null);
  const [repoStats, setRepoStats] = useState<RepoStats | null>(warmForProject ? cachedRepoStats : null);
  const [repoError, setRepoError] = useState<string | null>(null);
  // Two ids, on purpose. `pinnedRepoCredId` is the operator's pick and is an
  // input of the load; `activeRepoCredId` is what the last load resolved and
  // is only displayed. When one state did both, the load's own write
  // (null -> resolved id) changed its deps and fetched every source twice.
  const [pinnedRepoCredId, setPinnedRepoCredId] = useState<string | null>(null);
  const [activeRepoCredId, setResolvedRepoCredId] = useState<string | null>(null);
  const setActiveRepoCredId = useCallback((id: string | null) => {
    setPinnedRepoCredId(id);
    setResolvedRepoCredId(id);
  }, []);

  const [monitorState, setMonitorState] = useState<ConnectionState>(warmForProject && cachedMonitorStats ? 'connected' : 'loading');
  const [monitorStats, setMonitorStats] = useState<MonitoringStats | null>(warmForProject ? cachedMonitorStats : null);
  const [monitorError, setMonitorError] = useState<string | null>(null);

  useEffect(() => {
    listCredentials().then((creds) => {
      setCredentials(creds);
      setCredLoaded(true);
    }).catch((err: unknown) => {
      silentCatch('useOverviewData:listCredentials')(err);
      setCredLoaded(true);
    });
  }, []);

  const repoCreds = credentials.filter((c) => isGitHubCred(c) || isGitLabCred(c));
  const sentryCreds = credentials.filter((c) => c.serviceType === 'sentry');

  // Primitive inputs, not the `activeProject` object: fetchProjects() hands
  // back fresh objects, and keying on identity re-ran both loads after every
  // Refresh on top of the explicit ones.
  const repoUrl = activeProject?.github_url ?? null;
  const hasProject = !!activeProject;
  const monitorCredId = activeProject?.monitoring_credential_id ?? null;
  const monitorSlug = activeProject?.monitoring_project_slug ?? null;

  const loadRepoStats = useCallback(async () => {
    if (!repoUrl || !credLoaded) return;

    const url = repoUrl;
    const provider = detectRepoProvider(url);
    setRepoProvider(provider);
    setRepoError(null);

    if (!provider) {
      setRepoState('error');
      setRepoError(`Cannot detect repo provider from URL: ${url}`);
      return;
    }

    const stickyCred = pinnedRepoCredId ? credentials.find((c) => c.id === pinnedRepoCredId) : undefined;
    const matchesProvider = (c: PersonaCredential) => provider === 'github' ? isGitHubCred(c) : isGitLabCred(c);
    const cred = (stickyCred && matchesProvider(stickyCred)) ? stickyCred
      : credentials.find(matchesProvider);
    if (!cred) {
      setRepoState('unmapped');
      setResolvedRepoCredId(null);
      return;
    }
    setResolvedRepoCredId(cred.id);

    setRepoState('loading');
    try {
      let stats: RepoStats;
      if (provider === 'github') {
        const parsed = parseGitHubUrl(url);
        if (!parsed) { setRepoState('error'); setRepoError(`Could not parse GitHub URL: ${url}`); return; }
        stats = await fetchGitHubStats(cred.id, parsed.owner, parsed.repo);
      } else {
        const parsed = parseGitLabUrl(url);
        if (!parsed) { setRepoState('error'); setRepoError(`Could not parse GitLab URL: ${url}`); return; }
        stats = await fetchGitLabStats(cred.id, parsed.path);
      }
      setRepoStats(stats);
      setRepoState('connected');
      cachedProjectId = activeProjectId;
      cachedRepoStats = stats;
    } catch (err) {
      setRepoState('error');
      setRepoError(`${formatErr(err)} — using credential "${cred.name}" (${cred.serviceType})`);
    }
  }, [repoUrl, activeProjectId, credentials, credLoaded, pinnedRepoCredId]);

  const loadMonitorStats = useCallback(async () => {
    if (!hasProject || !credLoaded) return;

    const credId = monitorCredId;
    const slug = monitorSlug;
    setMonitorError(null);

    if (!credId || !slug) {
      setMonitorState(sentryCreds.length > 0 ? 'unmapped' : 'empty');
      return;
    }

    const cred = credentials.find((c) => c.id === credId);
    if (!cred) {
      setMonitorState('unmapped');
      return;
    }

    setMonitorState('loading');
    try {
      const [storedOrg, storedProject] = splitSentrySlug(slug);
      let orgSlug = storedOrg;
      const projectSlug = storedProject ?? slug;

      if (!orgSlug) {
        const orgs = await fetchSentryOrgs(credId);
        if (orgs.length === 1 && orgs[0]) {
          orgSlug = orgs[0].slug;
        } else {
          setMonitorState('unmapped');
          return;
        }
      }

      const stats = await fetchSentryStats(credId, orgSlug, projectSlug);
      setMonitorStats(stats);
      setMonitorState('connected');
      cachedProjectId = activeProjectId;
      cachedMonitorStats = stats;
    } catch (err) {
      setMonitorState('error');
      setMonitorError(formatErr(err));
    }
  }, [hasProject, monitorCredId, monitorSlug, activeProjectId, credentials, credLoaded, sentryCreds.length]);

  useEffect(() => {
    if (!credLoaded || !hasProject) return;
    if (repoUrl) {
      loadRepoStats();
    } else {
      setRepoState(repoCreds.length > 0 ? 'unmapped' : 'empty');
    }
    loadMonitorStats();
  }, [credLoaded, hasProject, repoUrl, loadRepoStats, loadMonitorStats, repoCreds.length]);

  const refresh = useCallback(() => {
    fetchProjects();
    loadRepoStats();
    loadMonitorStats();
  }, [fetchProjects, loadRepoStats, loadMonitorStats]);

  return {
    activeProjectId,
    activeProject,
    credentials,
    credLoaded,
    repoCreds,
    sentryCreds,
    repoState,
    repoProvider,
    repoStats,
    repoError,
    activeRepoCredId,
    setActiveRepoCredId,
    monitorState,
    monitorStats,
    monitorError,
    loadRepoStats,
    loadMonitorStats,
    refresh,
  };
}

export type OverviewData = ReturnType<typeof useOverviewData>;
