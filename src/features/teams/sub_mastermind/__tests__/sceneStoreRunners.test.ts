import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DevTask } from '@/lib/bindings/DevTask';

const tasksPageMock = vi.fn();
vi.mock('@/api/devTools/devTools', () => ({
  getCrossProjectMetadata: vi.fn(),
  listGoals: vi.fn(),
  listScans: vi.fn(),
  tasksPage: (...args: unknown[]) => tasksPageMock(...args),
}));

import { useSceneStore } from '../lib/sceneStore';

const task = (id: string, projectId: string, status: string): DevTask =>
  ({ id, project_id: projectId, status, title: id } as unknown as DevTask);

const defer = () => {
  let resolve!: (page: { tasks: DevTask[] }) => void;
  const promise = new Promise<{ tasks: DevTask[] }>((res) => { resolve = res; });
  return { promise, resolve };
};

/**
 * `loadRunners` ran exactly once, in Mastermind's mount batch, so a dev-runner
 * task that started after the canvas opened never docked on its island. The
 * page now reloads the family on TASK_EXEC_STATUS; these pin the store
 * contract that makes that reload correct rather than a no-op.
 */
describe('sceneStore — runners refresh', () => {
  beforeEach(() => {
    tasksPageMock.mockReset();
  });

  it('a post-mount task appears after a reload', async () => {
    tasksPageMock
      .mockResolvedValueOnce({ tasks: [] })
      .mockResolvedValueOnce({ tasks: [task('t1', 'p', 'running')] });

    await useSceneStore.getState().loadRunners();
    expect(useSceneStore.getState().runners.get('p')).toBeUndefined();

    await useSceneStore.getState().loadRunners({ fresh: true });
    expect(useSceneStore.getState().runners.get('p')!.map((t) => t.id)).toEqual(['t1']);
  });

  it('fresh REPLACES an in-flight request instead of joining it', async () => {
    // The whole point: the pending request was issued BEFORE the task event, so
    // its snapshot cannot contain the task that triggered the reload. Joining
    // it would settle the family with that blind snapshot.
    const stale = defer();
    const fresh = defer();
    tasksPageMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const store = useSceneStore.getState();
    const first = store.loadRunners();
    const second = store.loadRunners({ fresh: true });

    fresh.resolve({ tasks: [task('started-after', 'p', 'running')] });
    await second;
    stale.resolve({ tasks: [] });
    await first;

    expect(tasksPageMock).toHaveBeenCalledTimes(2);
    expect(useSceneStore.getState().runners.get('p')!.map((t) => t.id)).toEqual(['started-after']);
    expect(useSceneStore.getState().runnersStatus).toBe('loaded');
  });

  it('without fresh, concurrent callers still share ONE list call', async () => {
    const flight = defer();
    tasksPageMock.mockReturnValue(flight.promise);

    const store = useSceneStore.getState();
    const a = store.loadRunners();
    const b = store.loadRunners();

    flight.resolve({ tasks: [task('one', 'p', 'queued')] });
    await Promise.all([a, b]);

    expect(tasksPageMock).toHaveBeenCalledTimes(1);
    expect(useSceneStore.getState().runners.get('p')!.map((t) => t.id)).toEqual(['one']);
  });

  it('a task that left the live set is dropped from its island', async () => {
    tasksPageMock
      .mockResolvedValueOnce({ tasks: [task('t1', 'p', 'running')] })
      .mockResolvedValueOnce({ tasks: [task('t1', 'p', 'completed')] });

    await useSceneStore.getState().loadRunners();
    expect(useSceneStore.getState().runners.get('p')).toHaveLength(1);

    await useSceneStore.getState().loadRunners({ fresh: true });
    expect(useSceneStore.getState().runners.get('p')).toBeUndefined();
  });
});
