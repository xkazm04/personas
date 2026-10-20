import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/system/cloud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/system/cloud')>()),
  cloudListDeployments: vi.fn(),
  cloudGetBaseUrl: vi.fn(),
}));
vi.mock('@/api/system/gitlab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/system/gitlab')>()),
  gitlabListAgents: vi.fn(),
  gitlabDeploymentStatus: vi.fn(),
}));

import * as cloudApi from '@/api/system/cloud';
import * as gitlabApi from '@/api/system/gitlab';
// Driven through the real store (storeTypes -> systemStore import cycle).
import { useSystemStore } from '@/stores/systemStore';

const s = () => useSystemStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useSystemStore.setState({ cloudError: null, gitlabError: null });
});

/**
 * The dashboard attached `.catch(toastCatch)` to these fetches, but both actions
 * swallow into `*Error` and never reject, so a failed fetch settled into the
 * "No deployments" empty state. The action now REPORTS its outcome.
 */
describe('deployment fetch actions report their outcome', () => {
  it('cloudFetchDeployments resolves true on success and false on failure', async () => {
    vi.mocked(cloudApi.cloudListDeployments).mockResolvedValueOnce([]);
    vi.mocked(cloudApi.cloudGetBaseUrl).mockResolvedValueOnce('http://x');
    expect(await s().cloudFetchDeployments()).toBe(true);

    vi.mocked(cloudApi.cloudListDeployments).mockRejectedValueOnce(new Error('orchestrator 500'));
    vi.mocked(cloudApi.cloudGetBaseUrl).mockResolvedValueOnce('http://x');
    expect(await s().cloudFetchDeployments()).toBe(false);
    expect(s().cloudError).toBeTruthy();
  });

  it('gitlabFetchAgents resolves true on success and false on failure', async () => {
    vi.mocked(gitlabApi.gitlabListAgents).mockResolvedValueOnce([]);
    vi.mocked(gitlabApi.gitlabDeploymentStatus).mockResolvedValueOnce([]);
    expect(await s().gitlabFetchAgents(7)).toBe(true);

    vi.mocked(gitlabApi.gitlabListAgents).mockRejectedValueOnce({ error: 'GitLab error: 502', kind: 'network' });
    vi.mocked(gitlabApi.gitlabDeploymentStatus).mockResolvedValueOnce([]);
    expect(await s().gitlabFetchAgents(7)).toBe(false);
    expect(s().gitlabError).toBeTruthy();
  });
});
