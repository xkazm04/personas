import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The dev-server boot poll opened a 1500ms interval whose ONLY exit was
// `status.healthy`. A project whose server never binds — a port clash, Turbopack
// dying on the first compile, a broken package.json — polled for the entire life
// of the tab while the UI read "Starting the dev server…" indefinitely. The
// failure was never classified AS one, so nothing downstream could react to it.
//
// These pin both halves of the correction: the poll terminates, and termination
// means `error` rather than a silent stop that leaves the tab reading "Starting".

const webbuildStatus = vi.fn();
const webbuildDevStart = vi.fn();

vi.mock('@/api/webbuild', () => ({
  webbuildStatus: (id: string) => webbuildStatus(id),
  webbuildDevStart: (id: string) => webbuildDevStart(id),
  webbuildNextReady: vi.fn(async (ids: string[]) => ids),
  webbuildDevStop: vi.fn(),
  webbuildListProjects: vi.fn(async () => []),
  webbuildRegisterExisting: vi.fn(),
  webbuildScaffold: vi.fn(),
  webbuildSessionSend: vi.fn(),
  webbuildSessionStop: vi.fn(),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => vi.fn(),
  toastCatch: () => vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));

const { useStudioStore, POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS } = await import('../studioStore');

const ID = 'p1';
const wholeBudget = POLL_INTERVAL_MS * (POLL_MAX_ATTEMPTS + 2);

describe('the dev-server boot poll is bounded', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStudioStore.setState({ runtimes: {}, tabOrder: [], activeId: null });
    webbuildStatus.mockReset();
    webbuildDevStart.mockReset();
    webbuildDevStart.mockResolvedValue({ healthy: false, url: '' });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('gives up on a server that never becomes healthy, and calls it an error', async () => {
    webbuildStatus.mockResolvedValue({ healthy: false, url: '' });

    await useStudioStore.getState().openImportable(ID, 'Never boots');
    expect(useStudioStore.getState().runtimes[ID]?.phase).toBe('starting');

    await vi.advanceTimersByTimeAsync(wholeBudget);

    expect(useStudioStore.getState().runtimes[ID]?.phase).toBe('error');
  });

  it('stops polling once it has given up — the interval does not outlive the tab', async () => {
    webbuildStatus.mockResolvedValue({ healthy: false, url: '' });
    await useStudioStore.getState().openImportable(ID, 'Never boots');

    await vi.advanceTimersByTimeAsync(wholeBudget);
    const settled = webbuildStatus.mock.calls.length;

    // Another whole budget's worth of time must produce no further probes.
    await vi.advanceTimersByTimeAsync(wholeBudget);
    expect(webbuildStatus.mock.calls.length).toBe(settled);
    expect(settled).toBeLessThanOrEqual(POLL_MAX_ATTEMPTS);
  });

  it('gives up the same way when the status probe keeps THROWING', async () => {
    // A server that never binds often makes the status call fail rather than
    // return unhealthy. Both roads have to end somewhere.
    webbuildStatus.mockRejectedValue(new Error('connection refused'));

    await useStudioStore.getState().openImportable(ID, 'Never boots');
    await vi.advanceTimersByTimeAsync(wholeBudget);

    expect(useStudioStore.getState().runtimes[ID]?.phase).toBe('error');
  });

  it('still goes live — and stops polling — when the server does come up', async () => {
    // The bound must not clip a slow-but-healthy boot: stay unhealthy for a
    // while, then succeed, well inside the budget.
    let ticks = 0;
    webbuildStatus.mockImplementation(async () => {
      ticks += 1;
      return ticks < 20 ? { healthy: false, url: '' } : { healthy: true, url: 'http://localhost:3000' };
    });

    await useStudioStore.getState().openImportable(ID, 'Slow but fine');
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 25);

    expect(useStudioStore.getState().runtimes[ID]?.phase).toBe('live');
  });
});
