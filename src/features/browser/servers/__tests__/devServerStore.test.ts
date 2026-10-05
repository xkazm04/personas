import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevServerView } from '@/lib/bindings/DevServerView';

import { adoptServers, devServersSnapshot } from '../devServerStore';

const api = vi.hoisted(() => ({
  listDevServers: vi.fn(),
  listenDevServers: vi.fn(),
  startDevServer: vi.fn(),
  stopDevServer: vi.fn(),
  restartDevServer: vi.fn(),
}));
vi.mock('@/api/devServers', () => api);
// The store reads toast copy at failure time; the real i18n module is heavy to load per fresh import.
vi.mock('@/i18n/useTranslation', () => ({ getActiveTranslations: () => ({ browser: { servers: {} } }) }));

function server(projectId: string, patch: Partial<DevServerView> = {}): DevServerView {
  return {
    projectId,
    projectName: projectId,
    rootPath: `C:\\dev\\${projectId}`,
    workspaceId: null,
    techStack: null,
    devCommand: 'npm run dev',
    devPort: 3000,
    state: 'stopped',
    pid: null,
    externalPid: null,
    startedAt: null,
    url: 'http://localhost:3000',
    error: null,
    ...patch,
  };
}

/** A fresh module per test: the store is a module singleton. The first import is cold and slow. */
async function freshStore() {
  vi.resetModules();
  return import('../devServerStore');
}

describe('adoptServers', () => {
  it('adopts the whole list and indexes it by project', () => {
    const list = [server('a', { state: 'running' }), server('b', { devPort: 3001 })];
    const next = adoptServers({ ...devServersSnapshot(), loading: true, error: 'old' }, list);
    expect(next.servers).toBe(list);
    expect(next.loaded).toBe(true);
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.byProject.size).toBe(2);
    expect(next.byProject.get('a')?.state).toBe('running');
    expect(next.byProject.get('b')?.devPort).toBe(3001);
  });

  it('drops a project the next list no longer carries', () => {
    const first = adoptServers(devServersSnapshot(), [server('a'), server('b')]);
    const second = adoptServers(first, [server('b')]);
    expect(second.byProject.has('a')).toBe(false);
    expect([...second.byProject.keys()]).toEqual(['b']);
  });
});

describe('ensureDevServers', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
  });

  it('subscribes once, fetches once, and adopts what the event announces', async () => {
    let handler: ((servers: DevServerView[]) => void) | null = null;
    api.listenDevServers.mockImplementation((h: (servers: DevServerView[]) => void) => {
      handler = h;
      return Promise.resolve(() => {});
    });
    api.listDevServers.mockResolvedValue([server('a')]);
    const store = await freshStore();

    await store.ensureDevServers();
    await store.ensureDevServers();
    expect(api.listenDevServers).toHaveBeenCalledTimes(1);
    expect(api.listDevServers).toHaveBeenCalledTimes(1);
    expect(store.devServersSnapshot().byProject.get('a')?.state).toBe('stopped');

    handler!([server('a', { state: 'running', pid: 42 }), server('c')]);
    const snap = store.devServersSnapshot();
    expect(snap.servers).toHaveLength(2);
    expect(snap.byProject.get('a')?.pid).toBe(42);
    expect(snap.byProject.has('c')).toBe(true);
  }, 30_000);

  it('keeps a failed first list distinct from an empty one', async () => {
    api.listenDevServers.mockResolvedValue(() => {});
    api.listDevServers.mockRejectedValue(new Error('db locked'));
    const store = await freshStore();

    await store.ensureDevServers();
    const snap = store.devServersSnapshot();
    expect(snap.loaded).toBe(false);
    expect(snap.loading).toBe(false);
    expect(snap.error).toContain('db locked');
  }, 30_000);
});
