/**
 * One failed read must not strand the project matrix on its loading ghost.
 *
 * `listContextGroups` is the one read in the hook's first `Promise.all` with no
 * fallback, and `safeInvoke` rethrows every error but "command not found", so a
 * single rejected IPC rejected the whole batch inside a `void` IIFE: an
 * unhandled rejection, and `loading` stayed true for good. The fix settles the
 * wave instead of faking an empty group list (census read-failure-as-empty-value).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const listContextGroups = vi.fn();
const silentCatch = vi.fn();
const listSessions = vi.fn(() => Promise.resolve({ sessions: [] as unknown[] }));

vi.mock('@/api/devTools/devTools', () => ({
  getSkillUsageOverview: () => Promise.resolve([]),
  listContextGroups: (...a: unknown[]) => listContextGroups(...a),
  listContexts: () => Promise.resolve([{ id: 'c1', name: 'ctx', group_id: null }]),
  listSkills: () => Promise.resolve([{ name: 'perfect', description: null, category: null }]),
  memorySkillContexts: () => Promise.resolve([{ contextId: 'c1', name: 'ctx', freshNodes: 2, latestAt: null }]),
}));
vi.mock('@/api/fleet/fleet', () => ({ listSessions: () => listSessions() }));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: (scope: string) => (e: unknown) => silentCatch(scope, e),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ projects: [{ id: 'p1', name: 'personas', root_path: 'C:/repo' }] }),
}));

import { useProjectRegistry } from '../useProjectRegistry';

describe('useProjectRegistry - a failed context-group read', () => {
  beforeEach(() => {
    listContextGroups.mockReset();
    silentCatch.mockReset();
  });

  it('settles out of loading and reports the failure', async () => {
    listContextGroups.mockRejectedValue({ error: 'database is locked', kind: 'Database' });

    const { result } = renderHook(() => useProjectRegistry('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(silentCatch).toHaveBeenCalledWith('projectRegistry load', expect.anything());
  });

  it('a failed refresh keeps the rows the last good read painted', async () => {
    listContextGroups.mockResolvedValue([]);
    const { result, rerender } = renderHook(({ tick }) => useProjectRegistry('p1', tick), {
      initialProps: { tick: 0 },
    });
    await waitFor(() => expect(result.current.skills.map((s) => s.name)).toEqual(['perfect']));

    listContextGroups.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    rerender({ tick: 1 });

    await waitFor(() => expect(silentCatch).toHaveBeenCalledWith('projectRegistry load', expect.anything()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.skills.map((s) => s.name)).toEqual(['perfect']);
  });
});

describe('useProjectRegistry - a live run of the skill', () => {
  it('is running when /skill sits in a later arg (an Athena-dispatched session)', async () => {
    listContextGroups.mockResolvedValue([]);
    listSessions.mockResolvedValueOnce({
      sessions: [{ args: ['--append-system-prompt', 'steward', '/perfect run'], cwd: 'C:/Repo/', state: 'running' }],
    });

    const { result } = renderHook(() => useProjectRegistry('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cell('perfect', result.current.columns[0]!.id).running).toBe(true);
  });
});
