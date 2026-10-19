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
  mirrorActiveWorkspace: vi.fn(async () => undefined),
  deleteWorkspace: vi.fn(async () => true),
}));

vi.mock('@/api/devTools/workspaces', () => ({
  listWorkspaces: api.listWorkspaces,
  assignProjectToWorkspace: api.assignProjectToWorkspace,
  createWorkspace: vi.fn(),
  deleteWorkspace: api.deleteWorkspace,
  updateWorkspace: vi.fn(),
  importLocalWorkspaces: vi.fn(),
  mirrorActiveWorkspace: api.mirrorActiveWorkspace,
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

describe('the active-workspace mirror', () => {
  // localStorage is the source of truth for the selection; the app setting is
  // a one-way mirror so Rust can read it. What is pinned here: it follows every
  // set and every clear, it never blocks the switch, and it does not rewrite
  // the same value on unrelated commits.
  it('writes on select, clears on deselect, and clears when the active workspace is deleted', async () => {
    serverRows('w1');
    const store = await freshStore();
    api.mirrorActiveWorkspace.mockClear();

    store.setActiveWorkspace('w2');
    expect(store.workspacesSnapshot().activeId).toBe('w2');
    await vi.waitFor(() => expect(api.mirrorActiveWorkspace).toHaveBeenCalledWith('w2'));

    // An unrelated mutation must not re-write the same value.
    api.mirrorActiveWorkspace.mockClear();
    store.assignProject('p2', 'w1');
    expect(api.mirrorActiveWorkspace).not.toHaveBeenCalled();

    store.setActiveWorkspace(null);
    await vi.waitFor(() => expect(api.mirrorActiveWorkspace).toHaveBeenCalledWith(null));

    // Deleting the active workspace clears the selection — and the mirror.
    store.setActiveWorkspace('w1');
    await vi.waitFor(() => expect(api.mirrorActiveWorkspace).toHaveBeenLastCalledWith('w1'));
    store.deleteWorkspace('w1');
    await vi.waitFor(() => expect(api.mirrorActiveWorkspace).toHaveBeenLastCalledWith(null));
  });

  it('a failed mirror write never reaches the user and is retried on the next switch', async () => {
    serverRows('w1');
    const store = await freshStore();
    api.mirrorActiveWorkspace.mockClear();
    api.mirrorActiveWorkspace.mockRejectedValueOnce(new Error('settings door closed'));

    store.setActiveWorkspace('w2');
    // The switch itself is unaffected — the mirror is fire-and-forget.
    expect(store.workspacesSnapshot().activeId).toBe('w2');
    await vi.waitFor(() => expect(api.mirrorActiveWorkspace).toHaveBeenCalledWith('w2'));

    store.setActiveWorkspace('w1');
    store.setActiveWorkspace('w2');
    await vi.waitFor(() => expect(api.mirrorActiveWorkspace).toHaveBeenLastCalledWith('w2'));
  });
});

describe('concurrent mutations and settlement re-reads', () => {
  // Bulk "Move to workspace" fires one assign per selected project. The first
  // write to settle re-read the server while the others were still in flight,
  // and that read landed on top of their optimistic paints.
  it('a settling move does not erase a sibling move that is still in flight', async () => {
    const server = { p1: null as string | null, p2: null as string | null };
    api.listWorkspaces.mockResolvedValue([
      { id: 'w1', name: 'Northwind', color: '#6366f1', adopt_default_skills: false },
      { id: 'w2', name: 'Southgate', color: '#06b6d4', adopt_default_skills: false },
    ]);
    api.listProjects.mockImplementation(async () => [
      { id: 'p1', name: 'Alpha', workspace_id: server.p1 },
      { id: 'p2', name: 'Beta', workspace_id: server.p2 },
    ]);
    let landP2!: () => void;
    api.assignProjectToWorkspace.mockImplementation((projectId: string, workspaceId: string | null) => {
      if (projectId === 'p1') { server.p1 = workspaceId; return Promise.resolve(); }
      return new Promise<void>((r) => { landP2 = () => { server.p2 = workspaceId; r(); }; });
    });
    const store = await freshStore();
    const w2 = () => store.workspacesSnapshot().workspaces.find((w) => w.id === 'w2')!.projectIds;
    const reads = api.listProjects.mock.calls.length;

    store.assignProject('p1', 'w2');
    store.assignProject('p2', 'w2');
    await new Promise((r) => setTimeout(r, 10)); // p1's write has settled

    expect([...w2()].sort()).toEqual(['p1', 'p2']);

    landP2();
    await vi.waitFor(() => expect(api.listProjects.mock.calls.length).toBeGreaterThan(reads));
    await vi.waitFor(() => expect([...w2()].sort()).toEqual(['p1', 'p2']));
    // One settlement re-read for the batch, after the last write landed.
    expect(api.listProjects.mock.calls.length - reads).toBe(1);
  });

  it('a read that was in flight when a move painted cannot publish over it', async () => {
    serverRows(null);
    const store = await freshStore();
    let landRead!: () => void;
    api.listProjects.mockImplementationOnce(() => new Promise((r) => {
      landRead = () => r([
        { id: 'p1', name: 'Alpha', workspace_id: null },
        { id: 'p2', name: 'Beta', workspace_id: null },
      ]);
    }));
    api.assignProjectToWorkspace.mockImplementation(() => new Promise(() => {})); // never settles

    const pending = store.refreshWorkspaces();
    store.assignProject('p1', 'w2');
    landRead();
    await pending;

    expect(store.workspacesSnapshot().workspaces.find((w) => w.id === 'w2')!.projectIds).toEqual(['p1']);
  });
});
