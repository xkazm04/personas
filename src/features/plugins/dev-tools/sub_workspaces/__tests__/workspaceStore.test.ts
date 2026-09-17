import { describe, it, expect, vi, beforeEach } from 'vitest';

// The store publishes optimistically and lets the server arbitrate. The rule
// this file pins: EVERY mutation reconverges on both branches, because
// `ensureHydrated` reads the backend once per process — a rejected write that
// does not re-read leaves its optimistic value on screen until restart.

const api = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  assignProjectToWorkspace: vi.fn(),
  installSystemSkill: vi.fn(async () => undefined),
}));

vi.mock('@/api/devTools/workspaces', () => ({
  listWorkspaces: api.listWorkspaces,
  assignProjectToWorkspace: api.assignProjectToWorkspace,
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  importLocalWorkspaces: vi.fn(),
}));

vi.mock('@/api/devTools/devTools', () => ({
  listProjects: api.listProjects,
  installSystemSkill: api.installSystemSkill,
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
  toastCatch: () => () => undefined,
}));

/** Server truth: p1 in w1, p2 unassigned. */
function serverRows(p1Workspace: string | null = 'w1') {
  api.listWorkspaces.mockResolvedValue([
    { id: 'w1', name: 'Northwind', color: '#6366f1', adopt_default_skills: false },
    { id: 'w2', name: 'Southgate', color: '#06b6d4', adopt_default_skills: true },
  ]);
  api.listProjects.mockResolvedValue([
    { id: 'p1', name: 'Alpha', workspace_id: p1Workspace },
    { id: 'p2', name: 'Beta', workspace_id: null },
  ]);
}

async function freshStore() {
  vi.resetModules();
  const mod = await import('../workspaceStore');
  mod.workspacesSnapshot(); // triggers ensureHydrated
  await vi.waitFor(() => expect(mod.workspacesSnapshot().workspaces).toHaveLength(2));
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('assignProject reconciliation', () => {
  it('restores the real membership when the move is rejected', async () => {
    serverRows('w1');
    api.assignProjectToWorkspace.mockRejectedValue(new Error('nope'));
    const store = await freshStore();

    store.assignProject('p1', 'w2');
    // optimistic
    expect(store.workspacesSnapshot().workspaces.find((w) => w.id === 'w2')!.projectIds).toContain('p1');

    await vi.waitFor(() => {
      const ws = store.workspacesSnapshot().workspaces;
      expect(ws.find((w) => w.id === 'w1')!.projectIds).toEqual(['p1']);
      expect(ws.find((w) => w.id === 'w2')!.projectIds).toEqual([]);
    });
  });

  it('reconverges on success and still installs consented preset skills', async () => {
    serverRows('w1');
    api.assignProjectToWorkspace.mockImplementation(async () => {
      serverRows('w2'); // the server now agrees with the optimistic move
    });
    const store = await freshStore();

    store.assignProject('p1', 'w2');

    await vi.waitFor(() => {
      const ws = store.workspacesSnapshot().workspaces;
      expect(ws.find((w) => w.id === 'w2')!.projectIds).toEqual(['p1']);
    });
    await vi.waitFor(() => expect(api.installSystemSkill).toHaveBeenCalled());
  });
});
