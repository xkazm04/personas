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

export type ConnectionState = 'empty' | 'unmapped' | 'connected' | 'loading' | 'error';

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

  const [repoState, setRepoState] = useState<ConnectionState>('loading');
  const [repoProvider, setRepoProvider] = useState<RepoProvider | null>(null);
  const [repoStats, setRepoStats] = useState<RepoStats | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [activeRepoCredId, setActiveRepoCredId] = useState<string | null>(null);

  const [monitorState, setMonitorState] = useState<ConnectionState>('loading');
  const [monitorStats, setMonitorStats] = useState<MonitoringStats | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);

  useEffect(() => {
    listCredentials().then((creds) => {
      setCredentials(creds);
      setCredLoaded(true);
    }).catch(() => setCredLoaded(true));
  }, []);

  const repoCreds = credentials.filter((c) => isGitHubCred(c) || isGitLabCred(c));
  const sentryCreds = credentials.filter((c) => c.serviceType === 'sentry');

  const loadRepoStats = useCallback(async () => {
    if (!activeProject?.github_url || !credLoaded) return;

    const url = activeProject.github_url;
    const provider = detectRepoProvider(url);
    setRepoProvider(provider);
    setRepoError(null);

    if (!provider) {
      setRepoState('error');
      setRepoError(`Cannot detect repo provider from URL: ${url}`);
      return;
    }

    const stickyCred = activeRepoCredId ? credentials.find((c) => c.id === activeRepoCredId) : undefined;
    const matchesProvider = (c: PersonaCredential) => provider === 'github' ? isGitHubCred(c) : isGitLabCred(c);
    const cred = (stickyCred && matchesProvider(stickyCred)) ? stickyCred
      : credentials.find(matchesProvider);
    if (!cred) {
      setRepoState('unmapped');
      setActiveRepoCredId(null);
      return;
    }
    setActiveRepoCredId(cred.id);

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
    } catch (err) {
      setRepoState('error');
      setRepoError(`${formatErr(err)} — using credential "${cred.name}" (${cred.serviceType})`);
    }
  }, [activeProject?.github_url, credentials, credLoaded, activeRepoCredId]);

  const loadMonitorStats = useCallback(async () => {
    if (!activeProject || !credLoaded) return;

    const credId = activeProject.monitoring_credential_id;
    const slug = activeProject.monitoring_project_slug;
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
    } catch (err) {
      setMonitorState('error');
      setMonitorError(formatErr(err));
    }
  }, [activeProject, credentials, credLoaded, sentryCreds.length]);

  useEffect(() => {
    if (!credLoaded || !activeProject) return;
    if (activeProject.github_url) {
      loadRepoStats();
    } else {
      setRepoState(repoCreds.length > 0 ? 'unmapped' : 'empty');
    }
    loadMonitorStats();
  }, [credLoaded, activeProject, loadRepoStats, loadMonitorStats, repoCreds.length]);

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
