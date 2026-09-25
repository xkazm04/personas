// The store's two duties now that the wiring lives in SQLite: ADOPTING the
// browser blob exactly once, and presenting the table in the shape six
// `useSyncExternalStore` consumers already read.
//
// Worth testing on its own because both failures are invisible from the UI. A
// broken adoption shows an empty workspace panel to an operator whose wiring is
// still sitting in localStorage — indistinguishable from "you never linked
// one". And a snapshot whose shape drifted breaks `registryFor` / `workspacesOn`
// in every consumer at once, with nothing but blank sections to show for it.
//
// The knowledge-root rule this file used to test is gone from TypeScript: Rust
// computes it (`repos::dev_registries::knowledge_root`) and it arrives on the
// snapshot. Its tests moved there with it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@/api/fleet/fleet', () => ({ spawnSession: vi.fn(() => Promise.resolve('s1')) }));

/** A registry row as the backend returns it. */
function row(id: string, clonePath: string, over: Record<string, unknown> = {}) {
  return {
    id,
    fullName: id,
    url: null,
    defaultBranch: 'main',
    credentialId: null,
    clonePath,
    state: 'paired',
    sessionId: null,
    lanes: ['knowledge'],
    domains: [],
    sha: null,
    pairedAt: null,
    error: null,
    createdAt: '2026-09-23T00:00:00Z',
    updatedAt: '2026-09-23T00:00:00Z',
    ...over,
  };
}

const EMPTY_SNAPSHOT = { registries: [], links: [], knowledgeRoot: null };

/** Route every command to a handler, so a test says what the backend holds. */
function backend(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  invokeMock.mockImplementation((name: string, args: Record<string, unknown>) => {
    const h = handlers[name];
    if (!h) throw new Error(`unexpected command ${name}`);
    return Promise.resolve(h(args ?? {}));
  });
}

async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  invokeMock.mockReset();
  return import('./registryLinkStore');
}

/** Drive the lazy load the way React does — read, then let it settle. */
async function loaded(store: Awaited<ReturnType<typeof freshStore>>) {
  store.registryLinkSnapshot();
  await vi.waitFor(() => {
    expect(invokeMock).toHaveBeenCalledWith('dev_tools_registry_snapshot', expect.anything());
  });
  // One more turn for the publish that follows the resolved read.
  await Promise.resolve();
  await Promise.resolve();
  return store.registryLinkSnapshot();
}

describe('the view over the table', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keys registries by id and workspaces by the registry they hold', async () => {
    const store = await freshStore();
    backend({
      dev_tools_registry_snapshot: () => ({
        registries: [row('org/reg', 'C:/clones/reg'), row('org/other', 'C:/clones/other')],
        links: [
          { workspaceId: 'ws-1', registryId: 'org/reg', linkedAt: '2026-09-23T00:00:00Z' },
          { workspaceId: 'ws-2', registryId: 'org/reg', linkedAt: '2026-09-23T00:00:00Z' },
        ],
        knowledgeRoot: 'C:/clones/reg',
      }),
    });

    const snap = await loaded(store);
    // The shape every consumer reads. Asserted structurally rather than by
    // spot-check: a missing half of it breaks `registryFor` or `workspacesOn`
    // in six surfaces with no other symptom.
    expect(Object.keys(snap.registries).sort()).toEqual(['org/other', 'org/reg']);
    expect(snap.workspaceRegistry).toEqual({ 'ws-1': 'org/reg', 'ws-2': 'org/reg' });
    expect(snap.knowledgeRoot).toBe('C:/clones/reg');

    expect(store.registryFor('ws-1')?.clonePath).toBe('C:/clones/reg');
    expect(store.registryFor('ws-9')).toBeNull();
    expect(store.workspacesOn('org/reg')).toEqual(['ws-1', 'ws-2']);
    expect(store.workspacesOn('org/other')).toEqual([]);
  });

  it('reads the table once however many consumers ask', async () => {
    const store = await freshStore();
    backend({ dev_tools_registry_snapshot: () => EMPTY_SNAPSHOT });

    store.registryLinkSnapshot();
    store.registryLinkSnapshot();
    store.registryFor('ws-1');
    await loaded(store);
    expect(
      invokeMock.mock.calls.filter((c) => c[0] === 'dev_tools_registry_snapshot').length,
    ).toBe(1);
  });

  it('gives a stable empty snapshot before the read settles', async () => {
    // `registryLinkSnapshot` is also `getServerSnapshot`, so React compares the
    // reference: returning a fresh object each call is an infinite render loop.
    const store = await freshStore();
    backend({ dev_tools_registry_snapshot: () => EMPTY_SNAPSHOT });
    expect(store.registryLinkSnapshot()).toBe(store.registryLinkSnapshot());
  });

  it('notifies subscribers when the load lands', async () => {
    const store = await freshStore();
    backend({
      dev_tools_registry_snapshot: () => ({
        registries: [row('org/reg', 'C:/clones/reg')],
        links: [],
        knowledgeRoot: 'C:/clones/reg',
      }),
    });
    const listener = vi.fn();
    store.subscribeRegistryLinks(listener);
    await loaded(store);
    expect(listener).toHaveBeenCalled();
  });
});

describe('the one-time adoption of the browser blob', () => {
  const BLOB = {
    registries: {
      'org/reg': {
        id: 'org/reg',
        fullName: 'org/reg',
        url: 'https://github.com/org/reg',
        defaultBranch: 'main',
        credentialId: 'cred-1',
        clonePath: 'C:/clones/reg',
        state: 'paired',
        sessionId: null,
        lanes: ['knowledge', 'skills'],
        domains: ['software-engineering'],
        sha: 'abc123',
        pairedAt: '2026-09-01T00:00:00Z',
        error: null,
      },
    },
    workspaceRegistry: { 'ws-1': 'org/reg' },
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('imports what localStorage holds when the table is empty', async () => {
    const store = await freshStore();
    localStorage.setItem('devtools.registryLinks.v1', JSON.stringify(BLOB));
    const imported: Record<string, unknown>[] = [];
    backend({
      dev_tools_registry_snapshot: () => EMPTY_SNAPSHOT,
      dev_tools_registry_import: (args) => {
        imported.push(args);
        return {
          registries: [row('org/reg', 'C:/clones/reg')],
          links: [{ workspaceId: 'ws-1', registryId: 'org/reg', linkedAt: '2026-09-23T00:00:00Z' }],
          knowledgeRoot: 'C:/clones/reg',
        };
      },
    });

    const snap = await vi.waitUntil(async () => {
      const s = await loaded(store);
      return Object.keys(s.registries).length > 0 ? s : null;
    });

    expect(imported).toHaveLength(1);
    const sent = imported[0] as {
      registries: Record<string, unknown>[];
      links: Record<string, unknown>[];
    };
    // Every field travels, and the two timestamps the store mints do not.
    expect(sent.registries[0]).toEqual({
      id: 'org/reg',
      fullName: 'org/reg',
      url: 'https://github.com/org/reg',
      defaultBranch: 'main',
      credentialId: 'cred-1',
      clonePath: 'C:/clones/reg',
      state: 'paired',
      sessionId: null,
      lanes: ['knowledge', 'skills'],
      domains: ['software-engineering'],
      sha: 'abc123',
      pairedAt: '2026-09-01T00:00:00Z',
      error: null,
    });
    expect(sent.links[0]).toMatchObject({ workspaceId: 'ws-1', registryId: 'org/reg' });
    expect(snap?.workspaceRegistry).toEqual({ 'ws-1': 'org/reg' });

    // The blob is KEPT — an operator who rolls back to the previous build must
    // still find their wiring. It is read once and never written.
    expect(localStorage.getItem('devtools.registryLinks.v1')).toBe(JSON.stringify(BLOB));
  });

  it("imports the old build's empty remote and credential as ABSENT", async () => {
    // Every local checkout linked by the previous build wrote `''` into both,
    // because its type could not say "no remote". Carrying that through would
    // put the claim back into columns made nullable to stop making it.
    const store = await freshStore();
    localStorage.setItem(
      'devtools.registryLinks.v1',
      JSON.stringify({
        registries: {
          'local/checkout': {
            ...BLOB.registries['org/reg'],
            id: 'local/checkout',
            fullName: 'local/checkout',
            url: '',
            credentialId: '',
          },
        },
        workspaceRegistry: {},
      }),
    );
    let sent: { registries: Record<string, unknown>[] } | null = null;
    backend({
      dev_tools_registry_snapshot: () => EMPTY_SNAPSHOT,
      dev_tools_registry_import: (args) => {
        sent = args as { registries: Record<string, unknown>[] };
        return EMPTY_SNAPSHOT;
      },
    });

    await loaded(store);
    await vi.waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.registries[0]!.url).toBeNull();
    expect(sent!.registries[0]!.credentialId).toBeNull();
    // A real remote still travels intact.
    expect(sent!.registries[0]!.clonePath).toBe('C:/clones/reg');
  });

  it('does not import over a table that already holds the wiring', async () => {
    const store = await freshStore();
    localStorage.setItem('devtools.registryLinks.v1', JSON.stringify(BLOB));
    backend({
      dev_tools_registry_snapshot: () => ({
        registries: [row('org/db-one', 'C:/clones/db-one')],
        links: [],
        knowledgeRoot: 'C:/clones/db-one',
      }),
    });

    const snap = await loaded(store);
    expect(Object.keys(snap.registries)).toEqual(['org/db-one']);
    expect(invokeMock.mock.calls.some((c) => c[0] === 'dev_tools_registry_import')).toBe(false);
  });

  it('skips a hold whose registry the blob no longer carries', async () => {
    const store = await freshStore();
    localStorage.setItem(
      'devtools.registryLinks.v1',
      JSON.stringify({
        registries: BLOB.registries,
        workspaceRegistry: { 'ws-1': 'org/reg', 'ws-2': 'org/vanished' },
      }),
    );
    let sent: { links: Record<string, unknown>[] } | null = null;
    backend({
      dev_tools_registry_snapshot: () => EMPTY_SNAPSHOT,
      dev_tools_registry_import: (args) => {
        sent = args as { links: Record<string, unknown>[] };
        return EMPTY_SNAPSHOT;
      },
    });

    await loaded(store);
    await vi.waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.links).toHaveLength(1);
    expect(sent!.links[0]).toMatchObject({ registryId: 'org/reg' });
  });

  it('falls back to the table when the blob is corrupt', async () => {
    // A blob nobody can parse must not leave the store stuck pre-load — the
    // panel would render forever empty with no error anywhere.
    const store = await freshStore();
    localStorage.setItem('devtools.registryLinks.v1', '{not json');
    backend({ dev_tools_registry_snapshot: () => EMPTY_SNAPSHOT });

    const snap = await loaded(store);
    expect(snap.registries).toEqual({});
    expect(invokeMock.mock.calls.some((c) => c[0] === 'dev_tools_registry_import')).toBe(false);
  });
});

describe('mutations reach the table and re-read it', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('links a repo through upsert + link and republishes', async () => {
    const store = await freshStore();
    let linked = false;
    backend({
      dev_tools_registry_snapshot: () =>
        linked
          ? {
              registries: [row('org/reg', 'C:/clones/reg')],
              links: [
                { workspaceId: 'ws-1', registryId: 'org/reg', linkedAt: '2026-09-23T00:00:00Z' },
              ],
              knowledgeRoot: 'C:/clones/reg',
            }
          : EMPTY_SNAPSHOT,
      dev_tools_registry_upsert: (args) => (args as { registry: unknown }).registry,
      dev_tools_registry_link: () => {
        linked = true;
        return row('org/reg', 'C:/clones/reg');
      },
    });

    await loaded(store);
    const registry = await store.linkRegistry(
      'ws-1',
      { fullName: 'org/reg', defaultBranch: 'main' },
      'cred-1',
      'C:/clones/reg',
    );
    expect(registry.id).toBe('org/reg');
    expect(store.registryFor('ws-1')?.clonePath).toBe('C:/clones/reg');
  });

  it('unlinks through the command and republishes', async () => {
    const store = await freshStore();
    let held = true;
    backend({
      dev_tools_registry_snapshot: () =>
        held
          ? {
              registries: [row('org/reg', 'C:/clones/reg')],
              links: [
                { workspaceId: 'ws-1', registryId: 'org/reg', linkedAt: '2026-09-23T00:00:00Z' },
              ],
              knowledgeRoot: 'C:/clones/reg',
            }
          : EMPTY_SNAPSHOT,
      dev_tools_registry_unlink: () => {
        held = false;
        return true;
      },
    });

    await loaded(store);
    expect(store.registryFor('ws-1')).not.toBeNull();
    await store.unlinkRegistry('ws-1');
    expect(store.registryFor('ws-1')).toBeNull();
    expect(store.registryLinkSnapshot().knowledgeRoot).toBeNull();
  });

  it('merges a patch locally and writes the whole row back', async () => {
    const store = await freshStore();
    let stored = row('org/reg', 'C:/wrong', { state: 'unlinked', lanes: [] });
    backend({
      dev_tools_registry_snapshot: () => ({
        registries: [stored],
        links: [],
        knowledgeRoot: null,
      }),
      dev_tools_registry_upsert: (args) => {
        const sent = (args as { registry: Record<string, unknown> }).registry;
        // The whole row travels — a patch door would need its own rules about
        // which absent field means "leave alone".
        expect(sent).not.toHaveProperty('createdAt');
        expect(sent.url).toBeNull();
        stored = { ...stored, ...sent };
        return stored;
      },
    });

    await loaded(store);
    await store.patchRegistry('org/reg', { clonePath: 'C:/right', state: 'paired' });
    expect(stored.clonePath).toBe('C:/right');
    expect(stored.state).toBe('paired');
  });

  it('ignores a patch for a registry the view does not hold', async () => {
    const store = await freshStore();
    backend({ dev_tools_registry_snapshot: () => EMPTY_SNAPSHOT });
    await loaded(store);
    await store.patchRegistry('org/ghost', { state: 'paired' });
    expect(invokeMock.mock.calls.some((c) => c[0] === 'dev_tools_registry_upsert')).toBe(false);
  });
});
