import { beforeEach, describe, expect, it, vi } from 'vitest';

// Closing a tab deletes the runtime unconditionally, so a `webbuild_dev_stop`
// that REJECTS leaves a Bun process holding its port with nothing in Studio
// pointing at it — and freeing that port is a manual act. It used to go to
// silentCatch, which makes the one outcome the user must act on the one outcome
// they never see.

const webbuildDevStop = vi.fn();
const webbuildSessionStop = vi.fn();

vi.mock('@/api/webbuild', () => ({
  webbuildSessionSend: vi.fn(),
  webbuildListProjects: vi.fn(async () => []),
  webbuildStatus: vi.fn(async () => null),
  webbuildDevStart: vi.fn(async () => ({ healthy: false, url: '' })),
  webbuildDevStop: (...a: unknown[]) => webbuildDevStop(...a),
  webbuildNextReady: vi.fn(async (ids: string[]) => ids),
  webbuildRegisterExisting: vi.fn(),
  webbuildScaffold: vi.fn(),
  webbuildSessionStop: (...a: unknown[]) => webbuildSessionStop(...a),
}));

const toasted = vi.fn();
const swallowed = vi.fn();
vi.mock('@/lib/silentCatch', () => ({
  silentCatch: (ctx: string) => (e: unknown) => swallowed(ctx, e),
  toastCatch: (ctx: string) => (e: unknown) => toasted(ctx, e),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }));

vi.mock('@/features/plugins/companion/companionStore', () => ({
  useCompanionStore: {
    getState: () => ({ pulseForwardAck: vi.fn(), pulseMessageReaction: vi.fn() }),
  },
}));

const { useStudioStore } = await import('../studioStore');
type ProjectRuntime = import('../studioStore').ProjectRuntime;
const { useStudioHistory } = await import('../studioHistory');
const { MOCK_PHASES } = await import('../studioBuildModel');

const ID = 'p1';

function seed(patch: Partial<ProjectRuntime> = {}) {
  useStudioStore.setState({
    runtimes: {
      [ID]: {
        id: ID,
        name: 'Demo',
        phase: 'live',
        status: null,
        phases: MOCK_PHASES,
        busy: false,
        stream: '',
        reply: null,
        messages: [],
        question: null,
        autonomous: false,
        seedPending: null,
        autoTurns: 0,
        resumeAuto: false,
        effort: 'xhigh',
        style: 'balanced',
        options: [],
        decisionArea: null,
        decisionSelector: null,
        gatePlan: false,
        mcp: [],
        stopNoop: false,
        ...patch,
      },
    },
    tabOrder: [ID],
    activeId: ID,
  });
}

describe('closing a tab whose dev server refuses to stop', () => {
  beforeEach(() => {
    toasted.mockReset();
    swallowed.mockReset();
    webbuildDevStop.mockReset();
    webbuildSessionStop.mockReset();
    webbuildSessionStop.mockResolvedValue(true);
    useStudioHistory.setState({ byProject: {}, openTabIds: [], activeTabId: null });
    seed();
  });

  it('tells the user when the stop failed — the port stays held either way', async () => {
    webbuildDevStop.mockRejectedValue(new Error('failed to kill process tree'));

    useStudioStore.getState().closeTab(ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(toasted).toHaveBeenCalledTimes(1);
    expect(String(toasted.mock.calls[0]?.[1])).toContain('failed to kill process tree');
  });

  it('still closes the tab — a stop that cannot succeed must not trap the user', async () => {
    webbuildDevStop.mockRejectedValue(new Error('failed to kill process tree'));

    useStudioStore.getState().closeTab(ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(useStudioStore.getState().tabOrder).toEqual([]);
    expect(useStudioStore.getState().runtimes[ID]).toBeUndefined();
  });

  it('stays quiet when the server stopped cleanly', async () => {
    webbuildDevStop.mockResolvedValue(undefined);

    useStudioStore.getState().closeTab(ID);
    await Promise.resolve();
    await Promise.resolve();

    expect(toasted).not.toHaveBeenCalled();
    expect(useStudioStore.getState().tabOrder).toEqual([]);
  });
});
