import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The catalog is marked so every leaf is its own key path: a literal fails the assertions below,
// a catalog lookup passes them. interpolate stays real so placeholders are checked too.
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const mark = (node: unknown, path: string): unknown =>
    typeof node === 'string'
      ? path
      : Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, mark(v, path ? `${path}.${k}` : k)]));
  const t = mark(en, '');
  return { ...actual, getActiveTranslations: () => t };
});

vi.mock('@/api/system/gitlab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/system/gitlab')>()),
  gitlabRollbackPersona: vi.fn(),
  gitlabListPersonaVersions: vi.fn(),
  gitlabRollbackFromHistory: vi.fn(),
  gitlabListDeploymentHistory: vi.fn(),
  gitlabSetupPersonaBranches: vi.fn(),
}));

import * as gitlabApi from '@/api/system/gitlab';
import { storeBus } from '@/lib/storeBus';
import { useSystemStore } from '@/stores/systemStore';

const gl = () => useSystemStore.getState();
const D = 'deploy_errors.';

describe('GitLab and cloud deploy feedback speaks through the catalog', () => {
  const toasts: Array<{ message: string; type: string }> = [];
  let off: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    toasts.length = 0;
    off = storeBus.on('toast', (p) => toasts.push(p));
  });
  afterEach(() => off());

  it('rollback success toast names the catalog key and carries the persona and tag', async () => {
    vi.mocked(gitlabApi.gitlabRollbackPersona).mockResolvedValueOnce({} as never);
    vi.mocked(gitlabApi.gitlabListPersonaVersions).mockResolvedValueOnce([]);
    await gl().gitlabRollbackPersona(7, 'scout', 'v2');
    expect(toasts[0].message).toBe(`${D}gitlab_rolled_back`);
  });

  it('rollback from history', async () => {
    vi.mocked(gitlabApi.gitlabRollbackFromHistory).mockResolvedValueOnce({} as never);
    vi.mocked(gitlabApi.gitlabListDeploymentHistory).mockResolvedValueOnce([]);
    await gl().gitlabRollbackFromHistory(7, 'd1');
    expect(toasts[0].message).toBe(`${D}gitlab_rolled_back_previous`);
  });

  it('environment branches created', async () => {
    vi.mocked(gitlabApi.gitlabSetupPersonaBranches).mockResolvedValueOnce([] as never);
    await gl().gitlabSetupPersonaBranches(7, 'scout');
    expect(toasts[0].message).toBe(`${D}gitlab_branches_created`);
  });

  it('redeploy with no project leaves a catalog error, not English', async () => {
    useSystemStore.setState({ gitlabSelectedProjectId: null, gitlabDeploymentMeta: {} });
    await expect(gl().gitlabRedeployAgent('scout')).rejects.toThrow();
    expect(gl().gitlabError).toBe(`${D}gitlab_no_project`);
  });
});
