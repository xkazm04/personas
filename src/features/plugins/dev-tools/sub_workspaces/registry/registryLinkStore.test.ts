// The store's one cross-boundary duty: keeping `app_settings` pointed at the
// knowledge-lane clone so the RUNNER can find it.
//
// Worth testing on its own because the failure is invisible from the UI. The
// workspace panel reads localStorage and looks perfectly wired whether or not
// the setting was ever written — the only symptom of a broken mirror is
// executions that quietly never consult the registry, which is indistinguishable
// from a registry that had nothing relevant to say.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const setKnowledgeRegistryRoot = vi.fn(() => Promise.resolve());

vi.mock('@/api/devTools/devTools', () => ({
  setKnowledgeRegistryRoot: (...a: unknown[]) => setKnowledgeRegistryRoot(...(a as [])),
}));
vi.mock('@/api/fleet/fleet', () => ({ spawnSession: vi.fn(() => Promise.resolve('s1')) }));

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  setKnowledgeRegistryRoot.mockClear();
  return import('./registryLinkStore');
}

/** Link a registry and drive it to `paired` with the given lanes. */
async function wire(
  store: Awaited<ReturnType<typeof freshStore>>,
  id: string,
  clonePath: string,
  lanes: string[],
) {
  store.linkRegistry('ws-1', { fullName: id, defaultBranch: 'main' }, 'cred-1', clonePath);
  store.patchRegistry(id, { state: 'paired', lanes: lanes as never });
}

describe('knowledge-root mirror', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes the clone path once the registry is known to publish knowledge', async () => {
    const store = await freshStore();
    await wire(store, 'org/reg', 'C:/clones/reg', ['knowledge', 'skills']);
    expect(setKnowledgeRegistryRoot).toHaveBeenLastCalledWith('C:/clones/reg');
  });

  it('does NOT point the runner at a registry with no knowledge lane', async () => {
    // A skills-only registry has no `knowledge/` tree. Pointing the consult lane
    // at it would make every execution walk a directory that isn't there.
    const store = await freshStore();
    await wire(store, 'org/skills-only', 'C:/clones/skills', ['skills', 'usage']);
    expect(setKnowledgeRegistryRoot).toHaveBeenLastCalledWith(null);
  });

  it('clears the setting when the last knowledge registry is unlinked', async () => {
    // The stale-pointer case: unlinking in the UI while the backend keeps
    // consulting a repo the operator thinks they disconnected.
    const store = await freshStore();
    await wire(store, 'org/reg', 'C:/clones/reg', ['knowledge']);
    setKnowledgeRegistryRoot.mockClear();
    store.unlinkRegistry('ws-1');
    expect(setKnowledgeRegistryRoot).toHaveBeenLastCalledWith(null);
  });

  it('follows a corrected clone path', async () => {
    const store = await freshStore();
    await wire(store, 'org/reg', 'C:/wrong', ['knowledge']);
    store.patchRegistry('org/reg', { clonePath: 'C:/right' });
    expect(setKnowledgeRegistryRoot).toHaveBeenLastCalledWith('C:/right');
  });

  it('picks the same registry every time when several publish knowledge', async () => {
    // Deterministic, not insertion-ordered: two launches must not consult two
    // different corpora for the same wiring.
    const store = await freshStore();
    await wire(store, 'org/zeta', 'C:/z', ['knowledge']);
    await wire(store, 'org/alpha', 'C:/a', ['knowledge']);
    expect(setKnowledgeRegistryRoot).toHaveBeenLastCalledWith('C:/a');
  });

  it('survives a settings write that fails', async () => {
    // The mirror is best-effort — the consult lane going dark must never take
    // the workspace panel with it.
    const store = await freshStore();
    setKnowledgeRegistryRoot.mockImplementationOnce(() => Promise.reject(new Error('db locked')));
    await expect(
      (async () => wire(store, 'org/reg', 'C:/clones/reg', ['knowledge']))(),
    ).resolves.not.toThrow();
    expect(store.registryFor('ws-1')?.clonePath).toBe('C:/clones/reg');
  });
});
