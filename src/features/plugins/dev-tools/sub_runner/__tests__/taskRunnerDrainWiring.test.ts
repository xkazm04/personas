import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Wiring of useTaskQueue's execution-event listeners to the activity dock.

const handlers = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>());
const tasksPage = vi.hoisted(() => vi.fn());
const processEnded = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  }),
}));
vi.mock('@/api/devTools/devTools', () => ({ tasksPage }));
vi.mock('@/hooks/utility/data/useLayeredList', () => ({
  useLayeredList: () => ({
    rows: [], reload: vi.fn(), loading: false, loadingMore: false, hasMore: false,
    error: null, sentinelRef: vi.fn(), loadMore: vi.fn(),
  }),
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: { getState: () => ({ processEnded }) },
}));
vi.mock('@/stores/systemStore', () => {
  // The loaded window: filtered, so it holds no running row.
  const state = {
    tasks: [] as unknown[],
    setTasks: vi.fn(), patchTask: vi.fn(), appendTaskOutput: vi.fn(), clearTaskOutput: vi.fn(),
  };
  const useSystemStore = (sel: (s: typeof state) => unknown) => sel(state);
  useSystemStore.getState = () => state;
  return { useSystemStore };
});

import { EventName } from '@/lib/eventRegistry';
import { useTaskQueue } from '../useTaskQueue';

function emit(name: string, payload: unknown) {
  handlers.get(name)!({ payload });
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  processEnded.mockReset();
  tasksPage.mockReset();
});
afterEach(() => vi.useRealTimers());

async function mountFiltered() {
  renderHook(() => useTaskQueue({ projectId: 'p1', statusFilter: 'failed' }));
  await act(async () => { await Promise.resolve(); });
}

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
}

describe('useTaskQueue -> task_runner activity', () => {
  it('ends the activity when the last running task FAILS', async () => {
    tasksPage.mockResolvedValue({ tasks: [], cursor: null, hasMore: false, counts: { failed: 3 } });
    await mountFiltered();
    emit(EventName.TASK_EXEC_STATUS, { job_id: 't1', status: 'failed', error: 'boom' });
    await flush();
    expect(processEnded).toHaveBeenCalledWith('task_runner', 'failed');
  });

  it('does not end it while a task still runs outside the filtered window', async () => {
    tasksPage.mockResolvedValue({ tasks: [], cursor: null, hasMore: false, counts: { running: 1, completed: 4 } });
    await mountFiltered();
    emit(EventName.TASK_EXEC_COMPLETE, { task_id: 't2', output_lines: 10 });
    await flush();
    expect(processEnded).not.toHaveBeenCalled();
  });
});
