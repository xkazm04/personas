import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

// Every Overview mount used to call GitHub (3 HTTP requests) and Sentry (2)
// TWICE: loadRepoStats resolved the credential and wrote it into
// `activeRepoCredId`, which was one of its own deps, so the load effect fired
// again; and the effect keyed on the `activeProject` OBJECT, so every
// fetchProjects() (a Refresh, a pipeline save) re-ran both loads on top of
// the explicit ones. These tests count the adapter calls.

const fetchGitHubStats = vi.hoisted(() => vi.fn());
const fetchSentryStats = vi.hoisted(() => vi.fn());
const listCredentials = vi.hoisted(() => vi.fn());

vi.mock('@/api/vault/credentials', () => ({ listCredentials }));
vi.mock('../adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../adapters')>()),
  fetchGitHubStats,
  fetchSentryStats,
  fetchSentryOrgs: vi.fn(async () => []),
}));

type Project = {
  id: string;
  github_url: string | null;
  monitoring_credential_id: string | null;
  monitoring_project_slug: string | null;
};

let state: { activeProjectId: string | null; projects: Project[]; fetchProjects: () => void };
const listeners = new Set<() => void>();

vi.mock('@/stores/systemStore', async () => {
  const React = await import('react');
  return {
  useSystemStore: (selector: (s: typeof state) => unknown) =>
    // Minimal external store: re-render subscribers when `state` is replaced.
    React.useSyncExternalStore(
      (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); },
      () => selector(state),
    ),
  };
});

function setState(next: Partial<typeof state>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function project(): Project {
  return {
    id: 'p1',
    github_url: 'https://github.com/acme/app',
    monitoring_credential_id: 's1',
    monitoring_project_slug: 'acme/app',
  };
}

const creds = [
  { id: 'gh1', name: 'GitHub', serviceType: 'github', metadata: null },
  { id: 'gh2', name: 'GitHub (bot)', serviceType: 'github', metadata: null },
  { id: 's1', name: 'Sentry', serviceType: 'sentry', metadata: null },
] as PersonaCredential[];

import { useOverviewData } from '../useOverviewData';

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  listCredentials.mockResolvedValue(creds);
  fetchGitHubStats.mockResolvedValue({
    openIssues: 1, openPullRequests: 0, commitsLastWeek: 3, defaultBranch: 'main', lastPushAt: null,
  });
  fetchSentryStats.mockResolvedValue({ unresolvedIssues: 0, eventsLast24h: 0, eventsLastWeek: 0 });
  // Fresh object identities on every fetchProjects, exactly like the store.
  const fetchProjects = vi.fn(() => setState({ projects: [project()] }));
  state = { activeProjectId: 'p1', projects: [project()], fetchProjects };
});

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

describe('useOverviewData fetch count', () => {
  it('loads repo and monitoring stats once per mount', async () => {
    const { result } = renderHook(() => useOverviewData());
    await waitFor(() => expect(result.current.repoState).toBe('connected'));
    await settle();
    expect(fetchGitHubStats).toHaveBeenCalledTimes(1);
    expect(fetchSentryStats).toHaveBeenCalledTimes(1);
  });

  it('a Refresh loads each source once, not once more per new project object', async () => {
    const { result } = renderHook(() => useOverviewData());
    await waitFor(() => expect(result.current.repoState).toBe('connected'));
    await settle();
    fetchGitHubStats.mockClear();
    fetchSentryStats.mockClear();

    act(() => result.current.refresh());
    await settle();
    expect(fetchGitHubStats).toHaveBeenCalledTimes(1);
    expect(fetchSentryStats).toHaveBeenCalledTimes(1);
  });

  it('still reloads when the operator pins another repo credential', async () => {
    const { result } = renderHook(() => useOverviewData());
    await waitFor(() => expect(result.current.repoState).toBe('connected'));
    await settle();
    fetchGitHubStats.mockClear();

    act(() => result.current.setActiveRepoCredId('gh2'));
    await settle();
    expect(fetchGitHubStats).toHaveBeenCalledTimes(1);
    expect(fetchGitHubStats.mock.calls[0]![0]).toBe('gh2');
    expect(result.current.activeRepoCredId).toBe('gh2');
  });
});
