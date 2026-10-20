import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/system/gitlab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/system/gitlab')>()),
  gitlabRollbackPersona: vi.fn(),
  gitlabListPersonaVersions: vi.fn(),
  gitlabRollbackFromHistory: vi.fn(),
  gitlabListDeploymentHistory: vi.fn(),
}));

import * as gitlabApi from '@/api/system/gitlab';
import type { GitLabPersonaVersion, GitLabDeploymentRecord } from '@/api/system/gitlab';
// Driven through the real store (storeTypes -> systemStore import cycle).
import { useSystemStore } from '@/stores/systemStore';

const gl = () => useSystemStore.getState();
const versionRow = { tag: 'v3' } as Partial<GitLabPersonaVersion> as GitLabPersonaVersion;
const historyRow = { id: 'd1' } as Partial<GitLabDeploymentRecord> as GitLabDeploymentRecord;

beforeEach(() => {
  vi.clearAllMocks();
  useSystemStore.setState({ gitlabPersonaVersions: [versionRow], gitlabDeploymentHistory: [historyRow] });
});

/**
 * After a rollback LANDS, the slice re-reads the version list / deployment
 * history. That re-read swallowed its failure as `[]` and wrote it, so a
 * successful rollback followed by a flaky read showed "no versions" / an empty
 * history: the trail the operator rolls back from vanished.
 */
describe('gitlabSlice — a failed refresh after a write keeps the last list', () => {
  it('rollback ok + versions re-read fails: versions are not blanked', async () => {
    vi.mocked(gitlabApi.gitlabRollbackPersona).mockResolvedValueOnce({} as never);
    vi.mocked(gitlabApi.gitlabListPersonaVersions).mockRejectedValueOnce({ error: 'GitLab error: 502', kind: 'network' });

    await gl().gitlabRollbackPersona(7, 'scout', 'v2');

    expect(gl().gitlabPersonaVersions).toEqual([versionRow]);
    expect(gl().gitlabRollingBack).toBe(false);
  });

  it('rollback-from-history ok + history re-read fails: history is not blanked', async () => {
    vi.mocked(gitlabApi.gitlabRollbackFromHistory).mockResolvedValueOnce({} as never);
    vi.mocked(gitlabApi.gitlabListDeploymentHistory).mockRejectedValueOnce({ error: 'GitLab error: 502', kind: 'network' });

    await gl().gitlabRollbackFromHistory(7, 'd1');

    expect(gl().gitlabDeploymentHistory).toEqual([historyRow]);
    expect(gl().gitlabRollingBackFromHistory).toBe(false);
  });
});
